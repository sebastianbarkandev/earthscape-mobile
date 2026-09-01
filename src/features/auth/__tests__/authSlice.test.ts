/**
 * SEC-002: a hostile/misconfigured lookup host (or a bad persisted value) must never
 * become the origin that receives the password. SEC-009: an offline sign-out must be
 * finished on a later launch (the 1-year remember cookie stays valid until then).
 */
import { configureStore } from '@reduxjs/toolkit';

const mockStore: Record<string, string> = {};
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockStore[k] ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockStore[k] = v;
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    delete mockStore[k];
  }),
}));

const mockApi = jest.fn();
jest.mock('@/common/api/client', () => {
  class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, body: unknown, message?: string) {
      super(message ?? `HTTP ${status}`);
      this.status = status;
      this.body = body;
    }
  }
  return { api: (...args: unknown[]) => mockApi(...args), ApiError };
});

import * as config from '@/common/config';
import authReducer, { login, logout, restoreSession, chooseOrg } from '../authSlice';
import { ApiError } from '@/common/api/client';

const makeStore = () => configureStore({ reducer: { auth: authReducer } });
const calls = () => mockApi.mock.calls.map((c) => `${(c[1] as any)?.method ?? 'GET'} ${c[0]}`);
/** `host` option of the i-th call (the org a pending sign-out is pinned to), or undefined for the current org. */
const hostOf = (i: number) => (mockApi.mock.calls[i]?.[1] as any)?.host;
/** Orgs still owed a sign-out (the flag is a JSON list since SEC-020), or undefined when the flag is gone. */
const pending = (): string[] | undefined => {
  const raw = mockStore['earthscape.pendingSignout'];
  return raw === undefined ? undefined : JSON.parse(raw);
};
/** Request body of the (first) call to `path` — `remember: true` is a documented contract. */
const bodyOf = (path: string): unknown => (mockApi.mock.calls.find((c) => c[0] === path)?.[1] as any)?.body;
/** Hosts of every /signout retry pinned to an org (in call order). */
const signoutHosts = () => mockApi.mock.calls.filter((c) => c[0] === '/signout' && (c[1] as any)?.host).map((c) => (c[1] as any).host);

beforeEach(() => {
  for (const k of Object.keys(mockStore)) delete mockStore[k];
  config.clearSubdomain();
  mockApi.mockReset();
});

describe('SEC-002 lookup answers are validated before the password is posted anywhere', () => {
  it('rejects a hostile subdomain and never calls /signin', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/resolve_org') return { organizations: [{ subdomain: 'evil.example/#', name: 'Demo' }] };
      throw new Error(`unexpected call ${path}`);
    });
    const s = makeStore();
    await s.dispatch(login({ email: 'a@b.c', password: 'pw' }));
    expect(s.getState().auth.status).toBe('loggedOut');
    expect(s.getState().auth.error).toBe('Invalid email or password.');
    expect(calls()).toEqual(['POST /api/v1/auth/resolve_org']);
    expect(config.getApiHost()).toBe('');
    expect(mockStore['earthscape.subdomain']).toBeUndefined();
  });

  it('filters bad entries out of a multi-org answer and signs in on the remaining one', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/resolve_org') return { organizations: [{ subdomain: 'a:b', name: 'X' }, { subdomain: 'Demo', name: 'Demo' }] };
      if (path === '/signout') throw new ApiError(400, null);
      if (path === '/signin') return { meta: { code: 200 } };
      if (path === '/api/v1/bootstrap') return { is_admin: false };
      throw new Error(`unexpected call ${path}`);
    });
    const s = makeStore();
    await s.dispatch(login({ email: 'a@b.c', password: 'pw' }));
    expect(s.getState().auth.status).toBe('loggedIn');
    expect(config.getApiHost()).toBe('http://demo.earthscape.localdocker');
    expect(mockStore['earthscape.subdomain']).toBe('demo');
  });

  /**
   * TEST-006: `calls()` reports method + path only, so `remember: false` used to pass. CLAUDE.md:
   * "`remember:true` (NOT defaulted for JSON bodies) additionally sets a 1-year `remember_token`
   * cookie — send it, or users re-login daily." The pre-`/signin` `/signout` (the stale-cookie
   * 400 workaround) is pinned here too, in order.
   */
  it('POST /signin carries exactly {email, password, remember:true}, after a stale-cookie /signout', async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/resolve_org') return { organizations: [{ subdomain: 'demo', name: 'Demo' }] };
      if (path === '/signout') throw new ApiError(400, null); // already-signed-out is the normal answer
      if (path === '/signin') return { meta: { code: 200 } };
      if (path === '/api/v1/bootstrap') return { is_admin: false };
      throw new Error(`unexpected call ${path}`);
    });
    const s = makeStore();
    await s.dispatch(login({ email: 'a@b.c', password: 'pw' }));
    expect(s.getState().auth.status).toBe('loggedIn');
    expect(calls()).toEqual(['POST /api/v1/auth/resolve_org', 'GET /signout', 'POST /signin', 'GET /api/v1/bootstrap']);
    expect(bodyOf('/signin')).toEqual({ email: 'a@b.c', password: 'pw', remember: true });
    // The password must never be persisted, and never reach the org-less lookup twice.
    expect(bodyOf('/api/v1/auth/resolve_org')).toEqual({ email: 'a@b.c', password: 'pw' });
    expect(Object.values(mockStore)).not.toContain('pw');
  });

  it('chooseOrg refuses a tampered picker value', async () => {
    mockApi.mockImplementation(async () => {
      throw new Error('must not be called');
    });
    const s = makeStore();
    await s.dispatch(chooseOrg({ subdomain: 'x y', email: 'a@b.c', password: 'pw' }));
    expect(s.getState().auth.status).toBe('choosingOrg');
    expect(s.getState().auth.error).toBe('Invalid email or password.');
    expect(mockApi).not.toHaveBeenCalled();
  });

  it('restoreSession discards an invalid persisted subdomain without touching the network', async () => {
    mockStore['earthscape.subdomain'] = 'evil.example/';
    mockStore['earthscape.loggedIn'] = '1';
    const s = makeStore();
    await s.dispatch(restoreSession());
    expect(s.getState().auth.status).toBe('loggedOut');
    expect(s.getState().auth.subdomain).toBe('');
    expect(config.isHostConfigured()).toBe(false);
    expect(mockStore['earthscape.subdomain']).toBeUndefined();
    expect(mockStore['earthscape.loggedIn']).toBeUndefined();
    expect(mockApi).not.toHaveBeenCalled();
  });
});

describe('SEC-009 offline sign-out is retried', () => {
  it('remembers a failed /signout and finishes it on the next launch', async () => {
    config.setSubdomain('demo');
    mockStore['earthscape.subdomain'] = 'demo';
    mockStore['earthscape.loggedIn'] = '1';
    mockApi.mockRejectedValue(new TypeError('Network request failed'));
    const s = makeStore();
    await s.dispatch(logout());
    expect(s.getState().auth.status).toBe('loggedOut');
    expect(pending()).toEqual(['demo']); // SEC-015: the flag names the org it is owed to
    expect(mockStore['earthscape.loggedIn']).toBeUndefined();

    mockApi.mockReset();
    mockApi.mockResolvedValue({});
    const s2 = makeStore();
    await s2.dispatch(restoreSession());
    expect(calls()[0]).toBe('GET /signout');
    expect(hostOf(0)).toBe('http://demo.earthscape.localdocker');
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
    expect(s2.getState().auth.status).toBe('loggedOut');
  });

  it('a 401 on /signout means the session is already gone — no retry flag', async () => {
    config.setSubdomain('demo');
    mockApi.mockRejectedValue(new ApiError(401, null));
    const s = makeStore();
    await s.dispatch(logout());
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
  });

  it('keeps the flag while still offline (legacy value "1" = the persisted org)', async () => {
    config.setSubdomain('demo');
    mockStore['earthscape.subdomain'] = 'demo';
    mockStore['earthscape.pendingSignout'] = '1';
    mockApi.mockRejectedValue(new TypeError('Network request failed'));
    const s = makeStore();
    await s.dispatch(restoreSession());
    expect(calls()).toEqual(['GET /signout']);
    expect(hostOf(0)).toBe('http://demo.earthscape.localdocker');
    expect(pending()).toEqual(['demo']); // legacy '1' is migrated to the list form, still owed
  });
});

describe('SEC-015 a pending sign-out is bound to the org it was requested on', () => {
  const betaLogin = (alphaSignout: () => Promise<unknown>) =>
    mockApi.mockImplementation(async (path: string, opts?: { host?: string; method?: string }) => {
      if (path === '/api/v1/auth/resolve_org') return { organizations: [{ subdomain: 'beta', name: 'Beta' }] };
      if (path === '/signout' && opts?.host === 'http://alpha.earthscape.localdocker') return alphaSignout();
      if (path === '/signout') throw new ApiError(400, null); // beta has no cookie
      if (path === '/signin') return { meta: { code: 200 } };
      if (path === '/api/v1/bootstrap') return { is_admin: false };
      throw new Error(`unexpected call ${path} ${JSON.stringify(opts ?? {})}`);
    });

  it('signing in to ANOTHER org first finishes the pending sign-out on the org that owns the cookie', async () => {
    config.setSubdomain('alpha');
    mockStore['earthscape.subdomain'] = 'alpha';
    mockApi.mockRejectedValue(new TypeError('Network request failed'));
    await makeStore().dispatch(logout());
    expect(pending()).toEqual(['alpha']);

    mockApi.mockReset();
    betaLogin(async () => ({}));
    const s = makeStore();
    await s.dispatch(login({ email: 'a@b.c', password: 'pw' }));
    expect(s.getState().auth.status).toBe('loggedIn');
    expect(config.getApiHost()).toBe('http://beta.earthscape.localdocker');
    const alphaIdx = mockApi.mock.calls.findIndex((c) => c[0] === '/signout' && (c[1] as any)?.host === 'http://alpha.earthscape.localdocker');
    const signinIdx = mockApi.mock.calls.findIndex((c) => c[0] === '/signin');
    expect(alphaIdx).toBeGreaterThan(-1);
    expect(alphaIdx).toBeLessThan(signinIdx);
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
    expect(mockStore['earthscape.subdomain']).toBe('beta');
  });

  it("another org's successful sign-in / sign-out never clears a flag it did not settle", async () => {
    mockStore['earthscape.pendingSignout'] = 'alpha';
    mockStore['earthscape.subdomain'] = 'alpha';
    config.setSubdomain('alpha');
    betaLogin(async () => {
      throw new TypeError('Network request failed'); // alpha still unreachable
    });
    const s = makeStore();
    await s.dispatch(login({ email: 'a@b.c', password: 'pw' }));
    expect(s.getState().auth.status).toBe('loggedIn');
    expect(pending()).toEqual(['alpha']);

    // Signing out of beta (online) settles beta only.
    mockApi.mockReset();
    mockApi.mockResolvedValue({});
    await s.dispatch(logout());
    expect(hostOf(0)).toBeUndefined();
    expect(pending()).toEqual(['alpha']);
  });

  it('restoreSession retries against the org in the flag, not the org persisted now', async () => {
    mockStore['earthscape.subdomain'] = 'beta';
    mockStore['earthscape.pendingSignout'] = 'alpha';
    mockApi.mockResolvedValue({});
    const s = makeStore();
    await s.dispatch(restoreSession());
    expect(calls()[0]).toBe('GET /signout');
    expect(hostOf(0)).toBe('http://alpha.earthscape.localdocker');
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
    expect(config.getApiHost()).toBe('http://beta.earthscape.localdocker');
  });

  it('a 401 from the owning org means that session is already gone; a hostile flag value is dropped unused', async () => {
    mockStore['earthscape.pendingSignout'] = 'alpha';
    mockApi.mockRejectedValue(new ApiError(401, null));
    await makeStore().dispatch(restoreSession());
    expect(hostOf(0)).toBe('http://alpha.earthscape.localdocker');
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();

    mockApi.mockReset();
    mockStore['earthscape.pendingSignout'] = 'evil.example/';
    await makeStore().dispatch(restoreSession());
    expect(mockApi).not.toHaveBeenCalled();
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
  });
});

describe('SEC-020 several orgs can be owed a sign-out at once (shared device)', () => {
  const offline = () => mockApi.mockRejectedValue(new TypeError('Network request failed'));

  it("an offline sign-out on a second org is ADDED to the list — the first org's flag survives", async () => {
    mockStore['earthscape.pendingSignout'] = 'alpha'; // legacy single-label form, alpha's /signout still owed
    mockStore['earthscape.subdomain'] = 'beta';
    config.setSubdomain('beta');
    offline();
    await makeStore().dispatch(logout());
    expect(pending()).toEqual(['alpha', 'beta']);

    // Next launch: BOTH orgs are retried, each on its own host, and the list is cleared once both succeed.
    mockApi.mockReset();
    mockApi.mockResolvedValue({});
    const s = makeStore();
    await s.dispatch(restoreSession());
    expect(signoutHosts()).toEqual(['http://alpha.earthscape.localdocker', 'http://beta.earthscape.localdocker']);
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
    expect(s.getState().auth.status).toBe('loggedOut');
  });

  it('only the orgs that answered are removed; the one still unreachable stays owed', async () => {
    mockStore['earthscape.pendingSignout'] = JSON.stringify(['alpha', 'beta']);
    mockApi.mockImplementation(async (path: string, opts?: { host?: string }) => {
      if (path === '/signout' && opts?.host === 'http://alpha.earthscape.localdocker') return {};
      if (path === '/signout' && opts?.host === 'http://beta.earthscape.localdocker') throw new TypeError('Network request failed');
      throw new Error(`unexpected call ${path}`);
    });
    await makeStore().dispatch(restoreSession());
    expect(signoutHosts()).toHaveLength(2);
    expect(pending()).toEqual(['beta']);

    // A 401 from the remaining org = that session is already gone -> list emptied, flag removed.
    mockApi.mockReset();
    mockApi.mockRejectedValue(new ApiError(401, null));
    await makeStore().dispatch(restoreSession());
    expect(signoutHosts()).toEqual(['http://beta.earthscape.localdocker']);
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
  });

  it('signing out of one org online settles ONLY that org; a repeat offline sign-out is not duplicated', async () => {
    mockStore['earthscape.pendingSignout'] = JSON.stringify(['alpha', 'beta']);
    config.setSubdomain('beta');
    mockApi.mockResolvedValue({});
    await makeStore().dispatch(logout());
    expect(hostOf(0)).toBeUndefined(); // the current org's own /signout, no pinned retry
    expect(pending()).toEqual(['alpha']);

    mockApi.mockReset();
    offline();
    await makeStore().dispatch(logout());
    await makeStore().dispatch(logout());
    expect(pending()).toEqual(['alpha', 'beta']);
  });

  it('the list is bounded: beyond 8 orgs the OLDEST entry is dropped, the newest kept', async () => {
    const eight = Array.from({ length: 8 }, (_, i) => `org${i}`);
    mockStore['earthscape.pendingSignout'] = JSON.stringify(eight);
    config.setSubdomain('org8');
    offline();
    await makeStore().dispatch(logout());
    expect(pending()).toHaveLength(8);
    expect(pending()).toEqual([...eight.slice(1), 'org8']);
  });

  /**
   * TEST-017: the bound is applied on the WRITE side (`logout`, pinned above) AND on the READ
   * side, for a list that was already oversized on disk. Only the write side was pinned, so
   * `readPendingSignouts` returning `labels` unbounded left the suite green — and every cold
   * launch would then fire one `/signout` per remembered org, forever.
   */
  it('an already-oversized persisted list is trimmed to the newest 8 before any /signout is fired', async () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `org${i}`);
    mockStore['earthscape.pendingSignout'] = JSON.stringify(twelve);
    mockApi.mockResolvedValue({});
    await makeStore().dispatch(restoreSession());
    // Exactly 8 retries, and they are the LAST 8 labels in order — org0..org3 are forgotten.
    expect(signoutHosts()).toEqual(twelve.slice(-8).map((l) => `http://${l}.earthscape.localdocker`));
    expect(pending()).toBeUndefined(); // all answered -> flag gone
  });

  it('hostile or malformed entries never become an origin; valid siblings are still retried', async () => {
    mockStore['earthscape.pendingSignout'] = JSON.stringify(['evil.example/', 'alpha', 42, 'a b', 'alpha']);
    mockApi.mockRejectedValue(new TypeError('Network request failed'));
    await makeStore().dispatch(restoreSession());
    expect(signoutHosts()).toEqual(['http://alpha.earthscape.localdocker']);
    expect(pending()).toEqual(['alpha']); // rewritten without the junk, de-duplicated

    mockApi.mockReset();
    mockStore['earthscape.pendingSignout'] = '[not json';
    await makeStore().dispatch(restoreSession());
    expect(mockApi).not.toHaveBeenCalled();
    expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
  });
});

/**
 * REG-001: `app/_layout.tsx` renders ONLY a spinner while `auth.status === 'restoring'`, and
 * `restoreSession` settles the offline sign-out debt (SEC-009/015/020) before it returns. A
 * captive portal accepts the connect and then answers nothing, so those retries must be bounded
 * — otherwise the login screen is unreachable for ~60 s per owed org, at EVERY launch.
 */
describe('REG-001 a hung /signout never holds the cold start behind the spinner', () => {
  it('restoreSession fulfils while the retry is still in flight, and the detached retry finishes the job', async () => {
    jest.useFakeTimers();
    try {
      mockStore['earthscape.pendingSignout'] = 'alpha';
      mockStore['earthscape.subdomain'] = 'beta'; // logged out; the only network call owed is alpha's /signout
      let release!: () => void;
      mockApi.mockImplementation(
        (path: string) =>
          new Promise((resolve) => {
            if (path === '/signout') release = () => resolve({});
          }),
      );

      const s = makeStore();
      let settled = false;
      void s.dispatch(restoreSession()).then(() => {
        settled = true;
      });
      // Nothing on the network answers: only the gate may end the wait.
      await jest.advanceTimersByTimeAsync(3000);
      expect(settled).toBe(true);
      expect(s.getState().auth.status).toBe('loggedOut'); // the login screen is reachable
      expect(config.getApiHost()).toBe('http://beta.earthscape.localdocker');
      // The debt was still attempted, still pinned to the org that owns the cookie (SEC-015),
      // and is still owed while unanswered.
      expect(signoutHosts()).toEqual(['http://alpha.earthscape.localdocker']);
      expect(mockStore['earthscape.pendingSignout']).toBe('alpha'); // unanswered -> untouched, still owed

      // The retry kept running detached: when the network finally answers, the debt is cleared.
      release();
      await jest.advanceTimersByTimeAsync(0);
      expect(mockStore['earthscape.pendingSignout']).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('each retry carries a request timeout (iOS URLSession would otherwise wait ~60 s per org)', async () => {
    mockStore['earthscape.pendingSignout'] = JSON.stringify(['alpha', 'beta']);
    mockApi.mockResolvedValue({});
    await makeStore().dispatch(restoreSession());
    const timeouts = mockApi.mock.calls.filter((c) => c[0] === '/signout').map((c) => (c[1] as any)?.timeoutMs);
    expect(timeouts).toHaveLength(2);
    for (const t of timeouts) expect(typeof t === 'number' && t > 0 && t <= 10000).toBe(true);
  });
});
