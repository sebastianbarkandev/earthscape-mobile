import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as SecureStore from 'expo-secure-store';
import { api, ApiError } from '@/common/api/client';
import { clearSubdomain, composeApiHost, getLookupHost, getSubdomain, normalizeSubdomain, setSubdomain } from '@/common/config';
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
/**
 * Set when "Sign out" could not reach the server (offline) — the 1-year remember cookie is
 * still valid (SEC-009). Value = JSON list of the subdomains a sign-out is owed to (cookies
 * are host-scoped, so only THAT org's /signout can invalidate it — SEC-015; several orgs can
 * be owed at once on a shared device — SEC-020). Older values are still read: a bare label,
 * or the legacy '1' meaning "the persisted subdomain".
 */
const KEY_PENDING_SIGNOUT = 'earthscape.pendingSignout';
/** Upper bound on remembered orgs (a device rarely sees more); the OLDEST entry is dropped beyond it. */
const PENDING_SIGNOUT_MAX = 8;
/**
 * REG-001. The sign-out debt is settled with real network calls, and a cold start renders
 * nothing but a spinner until `restoreSession` fulfils. So it is bounded twice:
 *  - each retry aborts after PENDING_SIGNOUT_TIMEOUT_MS (a captive portal accepts the connect
 *    and then answers nothing — iOS would wait ~60 s per org, sequentially);
 *  - the caller waits at most PENDING_SIGNOUT_GATE_MS for the whole set and the rest finishes
 *    DETACHED, so the login screen always appears.
 * The debt itself is never given up on: the remember_token it invalidates lives a year.
 */
const PENDING_SIGNOUT_TIMEOUT_MS = 5000;
const PENDING_SIGNOUT_GATE_MS = 1500;

/** The lookup answered with something that is not a hostname label — never build an origin from it (SEC-002). */
class InvalidOrgError extends Error {
  constructor() {
    super('Invalid email or password.');
  }
}

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

/**
 * Orgs a sign-out is still owed to, from the stored flag: a JSON list, a bare label, or the
 * legacy '1' (= `legacyLabel`, the persisted subdomain). Every entry goes through
 * `normalizeSubdomain` — anything else is dropped, never used as an origin (SEC-002).
 */
function parsePendingSignouts(flag: string | null, legacyLabel: string | null): string[] {
  if (!flag) return [];
  let entries: unknown[] = [flag];
  if (flag.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(flag);
      entries = Array.isArray(parsed) ? parsed : [];
    } catch {
      entries = [];
    }
  }
  const labels: string[] = [];
  for (const entry of entries) {
    const label = normalizeSubdomain(entry === '1' ? legacyLabel : typeof entry === 'string' ? entry : null);
    if (label != null && !labels.includes(label)) labels.push(label);
  }
  return labels.slice(-PENDING_SIGNOUT_MAX);
}

async function writePendingSignouts(labels: string[]): Promise<void> {
  if (labels.length) await SecureStore.setItemAsync(KEY_PENDING_SIGNOUT, JSON.stringify(labels));
  else await SecureStore.deleteItemAsync(KEY_PENDING_SIGNOUT);
}

/**
 * Finish every sign-out that never reached the server, each against the org it was
 * requested on — NOT whatever org the device is on now (SEC-015). An org stays listed
 * while offline; it is removed on success, on 401 (that session is already gone) or when
 * its label is unusable. `legacyLabel` resolves the pre-SEC-015 value '1'.
 */
async function finishPendingSignout(flag: string | null, legacyLabel: string | null): Promise<void> {
  if (!flag) return;
  const owed = parsePendingSignouts(flag, legacyLabel);
  const remaining: string[] = [];
  for (const label of owed) {
    try {
      // `host` pins the call to that org and keeps client.ts from treating a 401 as "session expired".
      await api('/signout', { host: composeApiHost(label), timeoutMs: PENDING_SIGNOUT_TIMEOUT_MS });
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) remaining.push(label); // still offline — retry at the next launch / sign-in
    }
  }
  await writePendingSignouts(remaining);
}

/**
 * At most one settlement run at a time: a run left going in the background by the gate below
 * must not interleave its `writePendingSignouts` with a second run's (REG-001).
 */
let signoutDebt: Promise<void> | null = null;

function settlePendingSignout(flag: string | null, legacyLabel: string | null): Promise<void> {
  if (!signoutDebt) {
    signoutDebt = finishPendingSignout(flag, legacyLabel)
      .catch(() => undefined)
      .finally(() => {
        signoutDebt = null;
      });
  }
  return signoutDebt;
}

/**
 * Settle the debt, but never let it gate the UI for longer than the grace period: whatever is
 * left keeps running detached and the orgs that did not answer stay listed for the next launch
 * (REG-001). Nothing downstream reads the result.
 */
async function settlePendingSignoutBounded(flag: string | null, legacyLabel: string | null): Promise<void> {
  if (!flag) return;
  const work = settlePendingSignout(flag, legacyLabel);
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, PENDING_SIGNOUT_GATE_MS);
      }),
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
  }
}

/** Establish the session on an already-resolved org and remember it. */
async function signIn(rawSubdomain: string, email: string, password: string) {
  // The subdomain becomes the origin that receives the password: refuse anything
  // that is not a plain hostname label (path, port, userinfo, another host).
  const subdomain = normalizeSubdomain(rawSubdomain);
  if (subdomain == null) throw new InvalidOrgError();
  // An offline "Sign out" may still be owed to ANOTHER org: settle it on that org's host
  // before this device moves on, or its remember_token outlives the user (SEC-015).
  await settlePendingSignoutBounded(await SecureStore.getItemAsync(KEY_PENDING_SIGNOUT), getSubdomain() || null);
  if (!setSubdomain(subdomain)) throw new InvalidOrgError();
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
  if (e instanceof InvalidOrgError) return e.message;
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
  const [stored, loggedIn, pendingSignout] = await Promise.all([
    SecureStore.getItemAsync(KEY_SUBDOMAIN),
    SecureStore.getItemAsync(KEY_LOGGED_IN),
    SecureStore.getItemAsync(KEY_PENDING_SIGNOUT),
  ]);

  const subdomain = stored ? normalizeSubdomain(stored) : null;

  // An offline "Sign out" left a valid remember_token on the org it was requested on:
  // finish it THERE — independent of the org persisted now — and keep trying on later
  // launches (SEC-009, SEC-015). BOUNDED: the root layout shows only a spinner until this
  // thunk fulfils, so a debt owed to an unreachable org must not hold the login screen (REG-001).
  await settlePendingSignoutBounded(pendingSignout, subdomain);

  // A persisted value that is not a valid label is never used as an origin: drop
  // it (and the flag that depends on it) and start over from the lookup (SEC-002).
  if (stored && subdomain == null) {
    clearSubdomain();
    await Promise.all([
      SecureStore.deleteItemAsync(KEY_SUBDOMAIN),
      SecureStore.deleteItemAsync(KEY_LOGGED_IN),
    ]);
    return { subdomain: '', loggedIn: false, bootstrap: null };
  }

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

    // Only well-formed hostname labels may become the origin the password is posted to (SEC-002).
    const valid = (organizations ?? []).filter((o) => normalizeSubdomain(o?.subdomain) != null);
    if (!valid.length) return rejectWithValue('Invalid email or password.');
    if (valid.length > 1) return { kind: 'chooseOrg', organizations: valid };

    return { kind: 'loggedIn', ...(await signIn(valid[0].subdomain, email, password)) };
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
  const org = getSubdomain();
  const pending = await SecureStore.getItemAsync(KEY_PENDING_SIGNOUT);
  const owed = parsePendingSignouts(pending, org || null);
  try {
    await api('/signout'); // Flask-Security logout
    // Only THIS org's pending entry is settled by this call (other orgs' stay owed — SEC-015/SEC-020).
    if (pending) await writePendingSignouts(owed.filter((l) => l !== org));
  } catch (e) {
    // A 401 means the session is already gone. Anything else (offline, 5xx) leaves a
    // valid 1-year remember_token on THIS org's host — add it to the orgs to retry, without
    // forgetting any other org still owed one (SEC-009/SEC-015/SEC-020).
    if (!(e instanceof ApiError && e.status === 401) && org && !owed.includes(org)) {
      await writePendingSignouts([...owed, org].slice(-PENDING_SIGNOUT_MAX));
    }
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
