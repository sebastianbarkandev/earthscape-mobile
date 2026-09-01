import { getApiHost } from '../config';

/**
 * The one fetch wrapper (CLAUDE.md conventions: no raw fetch in components).
 * Mirrors the web repo's EventsApi/TagApi: credentials included on every call
 * (Flask-Security session cookie), JSON in/out, normalized errors.
 * CSRF: server exempts JSON content-type and /api paths — send no tokens.
 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

/**
 * Called when an authed org-host request answers 401 (session expired / signed
 * out elsewhere). Registered by the root layout; client.ts cannot import the
 * store without a cycle. Not fired for the org-less lookup (`host` override),
 * where 401 means bad credentials.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Override the origin — the org-less lookup on api.{baseDomain}, or a pending sign-out owed to another org (SEC-015). */
  host?: string;
  /**
   * Fail (and abort) the request after this many ms. Off by default — iOS URLSession then
   * runs to its own ~60 s. Pass it wherever a stalled request would hold something the user
   * is waiting behind: a captive portal answers the TCP connect and then nothing at all
   * (REG-001).
   */
  timeoutMs?: number;
};

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, headers = {}, host, timeoutMs } = opts;
  const origin = host ?? getApiHost();
  if (!origin) {
    // Would otherwise fetch a relative URL and fail somewhere less obvious.
    throw new ApiError(0, null, 'No organization resolved yet — cannot build a request URL.');
  }
  // A timeout both aborts the request (frees the socket) and rejects here, so a caller
  // that must stay responsive is never left waiting on a promise fetch may never settle.
  const controller = timeoutMs != null ? new AbortController() : null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const pending = fetch(`${origin}${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      // Flask-WTF's WTF_CSRF_SSL_STRICT rejects secure POSTs whose Referer isn't
      // same-origin ("The referrer header is missing."). Browsers send it
      // implicitly; RN fetch doesn't, so send it on every request. Must match
      // the request host, hence derived from the origin, and never seen by
      // plain-http dev (the check only runs over https).
      Referer: `${origin}/`,
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: controller?.signal,
  });

  let res: Response;
  try {
    res =
      timeoutMs == null
        ? await pending
        : await new Promise<Response>((resolve, reject) => {
            timer = setTimeout(() => {
              controller?.abort();
              reject(new Error(`Request timed out after ${timeoutMs} ms: ${method} ${path}`));
            }, timeoutMs);
            pending.then(resolve, reject);
          });
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text; // non-JSON body (e.g. HTML error page) — keep raw for debugging
  }

  if (res.status === 401 && !host) onUnauthorized?.();
  if (!res.ok) throw new ApiError(res.status, json);
  // fetch follows redirects silently: an unknown org 302s to shotover.com and an
  // unauthenticated browser-style request 302s to /signin — both land here as a
  // 200 HTML page. Never let that masquerade as a successful JSON response.
  if (typeof json === 'string' && /text\/html/i.test(res.headers.get('content-type') ?? '')) {
    throw new ApiError(res.status, json, 'Expected JSON but received an HTML page (redirected?).');
  }
  return json as T;
}
