/**
 * Deep-link / route parameter hygiene. expo-router URL-decodes dynamic segments
 * (`%2F` -> `/`), so a raw segment interpolated into an API path lets an outside
 * link drive arbitrary authenticated GETs on the org host (e.g.
 * `earthscape:///video/..%2F..%2F..%2Fsignout`). Every id that reaches an API
 * path must come through here first.
 */
const ID_RE = /^\d{1,12}$/;

/** Positive integer id from a route param, or null for anything else (`''`, `'1e3'`, `'6?x=1'`, `'../signout'`, `'1.json'`). */
export function parseId(raw: string | string[] | null | undefined): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== 'string' || !ID_RE.test(s)) return null;
  const n = Number(s);
  return n > 0 && Number.isSafeInteger(n) ? n : null;
}
