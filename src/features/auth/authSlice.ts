import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError } from '@/common/api/client';
import { getLookupHost, setSubdomain } from '@/common/config';
import type { Bootstrap } from './bootstrap';

/**
 * Auth = Flask-Security 5.x SESSION COOKIE (CLAUDE.md rule 2).
 *
 * The website's login form takes only an email and a password because it is
 * already served from the org's subdomain. The app has no Host to inherit, so it
 * asks the backend which org the credentials belong to, then signs in there:
 *
 *   POST api.{baseDomain}/api/v1/auth/resolve_org  {email, password}
 *     -> {organizations: [{subdomain, name}]}
 *   POST {subdomain}.{baseDomain}/signin           {email, password}  -> cookie
 *
 * URLs come from Flask-Security's config, NOT its defaults: SECURITY_LOGIN_URL is
 * '/signin' and SECURITY_LOGOUT_URL is '/signout' (config/default.py).
 *
 * We persist only the subdomain + a logged-in flag; the cookie itself is managed
 * by iOS. The password is never put in Redux or secure-store.
 */

const KEY_SUBDOMAIN = 'earthscape.subdomain';
const KEY_LOGGED_IN = 'earthscape.loggedIn';

type AuthStatus = 'restoring' | 'loggedOut' | 'loggingIn' | 'choosingOrg' | 'loggedIn';

export interface Organization {
  subdomain: string;
  name: string;
}

interface AuthState {
  status: AuthStatus;
  subdomain: string;
  /** Populated only when one address matched several orgs and the user must pick. */
  organizations: Organization[];
  user: { email?: string } | null;
  bootstrap: Bootstrap | null; // /api/v1/bootstrap payload (features, settings, current_user)
  error: string | null;
}

const initialState: AuthState = {
  status: 'restoring',
  subdomain: '',
  organizations: [],
  user: null,
  bootstrap: null,
  error: null,
};

/** Best-effort bootstrap fetch; failures are non-fatal (feature gates then default to off). */
async function tryBootstrap(): Promise<Bootstrap | null> {
  try {
    return await api<Bootstrap>('/api/v1/bootstrap');
  } catch {
    return null;
  }
}

/** Establish the session on an already-resolved org and remember it. */
async function signIn(subdomain: string, email: string, password: string) {
  setSubdomain(subdomain);
  // A still-valid cookie (e.g. an offline logout never reached the server) makes
  // Flask-Security answer /signin with 400 "only when not logged in" — clear it first.
  await api('/signout').catch(() => undefined);
  // remember:true -> 1-year remember_token; without it the JSON form binds
  // remember=false and the eswsessid session dies after ~24.6h (verified).
  await api('/signin', { method: 'POST', body: { email, password, remember: true } });
  await SecureStore.setItemAsync(KEY_SUBDOMAIN, subdomain);
  await SecureStore.setItemAsync(KEY_LOGGED_IN, '1');
  const bootstrap = await tryBootstrap();
  return { subdomain, email, bootstrap };
}

function loginErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const body = e.body as any;
    // resolve_org answers {msg}; Flask-Security answers {response:{errors:[...]}}.
    return String(
      body?.msg ??
        body?.response?.errors?.[0] ??
        body?.response?.field_errors?.password?.[0] ??
        (e.status === 400 || e.status === 401
          ? 'Invalid email or password.'
          : `Login failed (HTTP ${e.status}).`),
    );
  }
  return 'Could not reach the server. Check your connection.';
}

export const restoreSession = createAsyncThunk('auth/restore', async () => {
  const [subdomain, loggedIn] = await Promise.all([
    SecureStore.getItemAsync(KEY_SUBDOMAIN),
    SecureStore.getItemAsync(KEY_LOGGED_IN),
  ]);

  // Apply the remembered org FIRST — a logged-out start still needs the host set,
  // or the next sign-in has no origin to build a URL against.
  if (subdomain) setSubdomain(subdomain);
  if (!loggedIn || !subdomain) {
    return { subdomain: subdomain ?? '', loggedIn: false, bootstrap: null };
  }

  // Verify the cookie survived (UNVERIFIED item in CLAUDE.md): any authed
  // endpoint works; the videos list is cheap and always present.
  try {
    await api('/api/v1/videos/list?page=1&per_page=1');
    const bootstrap = await tryBootstrap();
    return { subdomain, loggedIn: true, bootstrap };
  } catch {
    await SecureStore.deleteItemAsync(KEY_LOGGED_IN);
    return { subdomain, loggedIn: false, bootstrap: null };
  }
});

type LoginResult =
  | { kind: 'loggedIn'; subdomain: string; email: string; bootstrap: Bootstrap | null }
  | { kind: 'chooseOrg'; organizations: Organization[] };

export const login = createAsyncThunk<
  LoginResult,
  { email: string; password: string },
  { rejectValue: string }
>('auth/login', async ({ email, password }, { rejectWithValue }) => {
  try {
    const { organizations } = await api<{ organizations: Organization[] }>(
      '/api/v1/auth/resolve_org',
      { method: 'POST', body: { email, password }, host: getLookupHost() },
    );

    if (!organizations?.length) return rejectWithValue('Invalid email or password.');
    if (organizations.length > 1) return { kind: 'chooseOrg', organizations };

    return { kind: 'loggedIn', ...(await signIn(organizations[0].subdomain, email, password)) };
  } catch (e) {
    return rejectWithValue(loginErrorMessage(e));
  }
});

/** Second leg when one address matched several orgs. */
export const chooseOrg = createAsyncThunk<
  { subdomain: string; email: string; bootstrap: Bootstrap | null },
  { subdomain: string; email: string; password: string },
  { rejectValue: string }
>('auth/chooseOrg', async ({ subdomain, email, password }, { rejectWithValue }) => {
  try {
    return await signIn(subdomain, email, password);
  } catch (e) {
    return rejectWithValue(loginErrorMessage(e));
  }
});

/** The server rejected an authed call with 401 (session expired) — drop the flag, back to login. */
export const sessionExpired = createAsyncThunk(
  'auth/sessionExpired',
  async () => {
    await SecureStore.deleteItemAsync(KEY_LOGGED_IN);
  },
  { condition: (_, { getState }) => (getState() as { auth: AuthState }).auth.status === 'loggedIn' },
);

export const logout = createAsyncThunk('auth/logout', async () => {
  try {
    await api('/signout'); // Flask-Security logout; ignore failures
  } catch {
    /* session may already be gone */
  }
  // The subdomain deliberately survives logout — the next sign-in skips the lookup.
  await SecureStore.deleteItemAsync(KEY_LOGGED_IN);
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(restoreSession.fulfilled, (s, { payload }) => {
      s.subdomain = payload.subdomain;
      s.bootstrap = payload.bootstrap;
      s.status = payload.loggedIn ? 'loggedIn' : 'loggedOut';
    });
    b.addCase(restoreSession.rejected, (s) => {
      s.status = 'loggedOut';
    });

    b.addCase(login.pending, (s) => {
      s.status = 'loggingIn';
      s.error = null;
      s.organizations = [];
    });
    b.addCase(login.fulfilled, (s, { payload }) => {
      if (payload.kind === 'chooseOrg') {
        s.status = 'choosingOrg';
        s.organizations = payload.organizations;
        return;
      }
      s.status = 'loggedIn';
      s.subdomain = payload.subdomain;
      s.user = { email: payload.email };
      s.bootstrap = payload.bootstrap;
    });
    b.addCase(login.rejected, (s, { payload }) => {
      s.status = 'loggedOut';
      s.error = payload ?? 'Login failed.';
    });

    b.addCase(chooseOrg.pending, (s) => {
      s.status = 'loggingIn';
      s.error = null;
    });
    b.addCase(chooseOrg.fulfilled, (s, { payload }) => {
      s.status = 'loggedIn';
      s.subdomain = payload.subdomain;
      s.user = { email: payload.email };
      s.bootstrap = payload.bootstrap;
      s.organizations = [];
    });
    b.addCase(chooseOrg.rejected, (s, { payload }) => {
      // Keep the picker up so another org can be tried.
      s.status = 'choosingOrg';
      s.error = payload ?? 'Login failed.';
    });

    b.addCase(logout.fulfilled, (s) => {
      s.status = 'loggedOut';
      s.user = null;
      s.bootstrap = null;
      s.organizations = [];
    });
    b.addCase(sessionExpired.fulfilled, (s) => {
      s.status = 'loggedOut';
      s.user = null;
      s.bootstrap = null;
      s.error = 'Your session expired. Please sign in again.';
    });
  },
});

export default authSlice.reducer;
