import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError } from '@/common/api/client';
import { setSubdomain } from '@/common/config';

/**
 * Auth = Flask-Security 5.x SESSION COOKIE (CLAUDE.md rule 2).
 * POST /login with JSON + Accept: application/json → cookie set by URLSession.
 * We persist only the subdomain + a logged-in flag; the cookie itself is
 * managed by iOS. On restore we verify the session with a cheap API call.
 */

const KEY_SUBDOMAIN = 'earthscape.subdomain';
const KEY_LOGGED_IN = 'earthscape.loggedIn';

type AuthStatus = 'restoring' | 'loggedOut' | 'loggingIn' | 'loggedIn';

interface AuthState {
  status: AuthStatus;
  subdomain: string;
  user: { email?: string } | null;
  bootstrap: unknown | null; // /api/v1/bootstrap payload — shape UNVERIFIED, stored loosely
  error: string | null;
}

const initialState: AuthState = {
  status: 'restoring',
  subdomain: '',
  user: null,
  bootstrap: null,
  error: null,
};

/** Best-effort bootstrap fetch; shape is UNVERIFIED so failures are non-fatal. */
async function tryBootstrap(): Promise<unknown | null> {
  try {
    return await api('/api/v1/bootstrap');
  } catch {
    return null;
  }
}

export const restoreSession = createAsyncThunk('auth/restore', async () => {
  const [subdomain, loggedIn] = await Promise.all([
    SecureStore.getItemAsync(KEY_SUBDOMAIN),
    SecureStore.getItemAsync(KEY_LOGGED_IN),
  ]);
  if (!loggedIn) return { subdomain: subdomain ?? '', loggedIn: false, bootstrap: null };

  if (subdomain) setSubdomain(subdomain);
  // Verify the session cookie survived (UNVERIFIED item in CLAUDE.md):
  // any authed endpoint works; the videos list is cheap and always present.
  try {
    await api('/api/v1/videos/list?page=1&per_page=1');
    const bootstrap = await tryBootstrap();
    return { subdomain: subdomain ?? '', loggedIn: true, bootstrap };
  } catch {
    await SecureStore.deleteItemAsync(KEY_LOGGED_IN);
    return { subdomain: subdomain ?? '', loggedIn: false, bootstrap: null };
  }
});

export const login = createAsyncThunk(
  'auth/login',
  async (
    args: { subdomain: string; email: string; password: string },
    { rejectWithValue },
  ) => {
    setSubdomain(args.subdomain);
    try {
      // Flask-Security 5.x JSON login. Response shape verified at runtime —
      // we rely only on the 2xx + Set-Cookie behavior, not the body.
      await api('/login', {
        method: 'POST',
        body: { email: args.email, password: args.password },
      });
      await SecureStore.setItemAsync(KEY_SUBDOMAIN, args.subdomain);
      await SecureStore.setItemAsync(KEY_LOGGED_IN, '1');
      const bootstrap = await tryBootstrap();
      return { subdomain: args.subdomain, email: args.email, bootstrap };
    } catch (e) {
      if (e instanceof ApiError) {
        // Flask-Security JSON errors: { response: { errors: [...] } } (loose parse)
        const body = e.body as any;
        const msg =
          body?.response?.errors?.[0] ??
          body?.response?.field_errors?.password?.[0] ??
          (e.status === 400 || e.status === 401
            ? 'Invalid email or password.'
            : `Login failed (HTTP ${e.status}).`);
        return rejectWithValue(String(msg));
      }
      return rejectWithValue('Could not reach the server. Check the subdomain and your connection.');
    }
  },
);

export const logout = createAsyncThunk('auth/logout', async () => {
  try {
    await api('/logout'); // Flask-Security logout; ignore failures
  } catch {
    /* session may already be gone */
  }
  await SecureStore.deleteItemAsync(KEY_LOGGED_IN);
});

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    setSubdomainField(state, { payload }: PayloadAction<string>) {
      state.subdomain = payload;
    },
  },
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
    });
    b.addCase(login.fulfilled, (s, { payload }) => {
      s.status = 'loggedIn';
      s.subdomain = payload.subdomain;
      s.user = { email: payload.email };
      s.bootstrap = payload.bootstrap;
    });
    b.addCase(login.rejected, (s, { payload }) => {
      s.status = 'loggedOut';
      s.error = (payload as string) ?? 'Login failed.';
    });
    b.addCase(logout.fulfilled, (s) => {
      s.status = 'loggedOut';
      s.user = null;
      s.bootstrap = null;
    });
  },
});

export const { setSubdomainField } = authSlice.actions;
export default authSlice.reducer;
