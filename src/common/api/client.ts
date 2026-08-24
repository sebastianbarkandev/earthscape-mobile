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

type Options = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
};

export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const { method = 'GET', body, headers = {} } = opts;
  const res = await fetch(`${getApiHost()}${path}`, {
    method,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text; // non-JSON body (e.g. HTML error page) — keep raw for debugging
  }

  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}
