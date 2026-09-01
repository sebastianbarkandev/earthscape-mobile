/**
 * Single source of truth for the API host.
 *
 * RULE (CLAUDE.md #1): an org's endpoints live on its OWN subdomain — the backend
 * reads the org from the Host header (`get_settings()` in app/__init__.py) and
 * redirects to shotover.com if the first label doesn't match an Organization.
 * A bare IP or a two-label host therefore CANNOT work: '192.168.10.184:8000'
 * splits to subdomain '192', matches no org, and 302s away.
 *
 * So the host is composed, never hardcoded: {scheme}://{subdomain}.{baseDomain}.
 * The subdomain is learned at login from POST api.{baseDomain}/api/v1/auth/resolve_org;
 * `api.` is the one label the backend deliberately loads no org for, which is why
 * the credentials lookup can live there.
 *
 * Dev default matches the backend repo's own convention
 * (docs/wiki/Development-Environment.md): 'demo.earthscape.localdocker' in /etc/hosts.
 * The iOS Simulator uses the Mac's resolver so that works as-is; a physical device
 * does not, so point EXPO_PUBLIC_API_BASE_DOMAIN at wildcard DNS instead, e.g.
 * '192-168-10-184.nip.io' — still 3+ labels, so the org label survives.
 *
 * AWS stage is NOT a separate base domain: stage orgs are 'stage', 'stage-acl',
 * 'stage-public', … directly under 'earthscape.com' (backend
 * docs/aws_cloud_naming_conventions.md), with their own DB. There is no
 * 'api-stage' host, and 'api.earthscape.com' is PRODUCTION — so the credentials
 * lookup needs its own knob: EXPO_PUBLIC_API_LOOKUP_HOST (e.g. 'stage.earthscape.com').
 * That works because `resolve_org` (app/api/auth_api.py) deliberately ignores the
 * org loaded from Host; the `api.` label is just the org-less default.
 */
const DEV_BASE_DOMAIN = 'earthscape.localdocker'; // docker-compose nginx proxy on :80 (API itself is :5001)
const PROD_BASE_DOMAIN = 'earthscape.com';

function envValue(raw: string | undefined): string | null {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : null;
}

/** e.g. 'earthscape.com' or 'earthscape.localdocker:8000' — never includes a scheme. */
const baseDomain =
  envValue(process.env.EXPO_PUBLIC_API_BASE_DOMAIN) ??
  (__DEV__ ? DEV_BASE_DOMAIN : PROD_BASE_DOMAIN);

/** Dev talks plain http by default; prod is always https unless told otherwise. */
const insecure = envValue(process.env.EXPO_PUBLIC_API_INSECURE)
  ? process.env.EXPO_PUBLIC_API_INSECURE?.trim() === '1'
  : __DEV__;

const scheme = insecure ? 'http' : 'https';

/**
 * Optional host (no scheme, may carry a :port) for the org-less credentials lookup.
 * Unset → `api.{baseDomain}`. Set it wherever `api.{baseDomain}` is not the same
 * deployment as the orgs you're targeting (stage: 'stage.earthscape.com').
 */
const lookupHostOverride = envValue(process.env.EXPO_PUBLIC_API_LOOKUP_HOST);

/** Pure composition of the lookup origin — exported so the rule is unit-testable. */
export function composeLookupHost(
  hostScheme: string,
  domain: string,
  override: string | null | undefined,
): string {
  const host = override?.trim().toLowerCase();
  return `${hostScheme}://${host ? host : `api.${domain}`}`;
}

let currentSubdomain = '';

/**
 * One RFC 1123 hostname label (the backend's own Organization.subdomain rule,
 * app/forms/superadmin/organizations.py). The subdomain becomes part of the origin
 * that receives the user's PASSWORD, so anything that could smuggle a path, port,
 * userinfo or another host (`evil.com/`, `a:b`, `x?y`) must never be accepted.
 */
export const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Trim + lowercase, then validate. Returns null when the value is not a safe label. */
export function normalizeSubdomain(subdomain: string | null | undefined): string | null {
  const s = (subdomain ?? '').trim().toLowerCase();
  return SUBDOMAIN_RE.test(s) ? s : null;
}

/**
 * Set the org label. Returns false — and leaves the current value UNCHANGED — for
 * anything that is not a single valid hostname label (SEC-002).
 */
export function setSubdomain(subdomain: string): boolean {
  const s = normalizeSubdomain(subdomain);
  if (s == null) return false;
  currentSubdomain = s;
  return true;
}

/** Forget the org (bad persisted value) — the next login runs the lookup again. */
export function clearSubdomain() {
  currentSubdomain = '';
}

export function getSubdomain(): string {
  return currentSubdomain;
}

/**
 * Pure composition of an org origin for a given label — the same rule getApiHost
 * applies to the CURRENT org. Used to finish an offline sign-out against the org it
 * was requested on even after the device has moved to another org (SEC-015).
 * Callers must pass a label that already passed normalizeSubdomain.
 */
export function composeApiHost(label: string): string {
  return `${scheme}://${label}.${baseDomain}`;
}

/** The org's API origin. Empty until an org has been resolved — callers must check. */
export function getApiHost(): string {
  return currentSubdomain ? composeApiHost(currentSubdomain) : '';
}

/**
 * Origin for org-less calls (the credentials → org lookup). By default the 'api'
 * label, for which the backend's `get_settings()` loads no org; overridable per
 * build via EXPO_PUBLIC_API_LOOKUP_HOST when `api.{baseDomain}` is a different
 * deployment (stage). Same scheme as the org host.
 */
export function getLookupHost(): string {
  return composeLookupHost(scheme, baseDomain, lookupHostOverride);
}

export function isHostConfigured(): boolean {
  return currentSubdomain.length > 0;
}

/** Host without the scheme, for showing the operator which backend they're on. */
export function getHostLabel(): string {
  return currentSubdomain ? `${currentSubdomain}.${baseDomain}` : baseDomain;
}

/**
 * Media URLs from the API are sometimes absolute (CloudFront) and sometimes
 * server-relative (e.g. live playlist '/live/5/playlist.m3u8' from url_for).
 * Always resolve through this before handing to the player.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return normalizeMediaScheme(url, insecure);
  return `${getApiHost()}${url.startsWith('/') ? '' : '/'}${url}`;
}

/**
 * Absolute media URLs are only allowed in the clear when the build itself talks
 * plain http (dev). An https build upgrades `http://` to `https://` so a payload
 * (or a wide ATS exception) can never make AVPlayer/Image/downloadAsync fetch in
 * the clear (SEC-006). Pure, so the rule is unit-testable for both build modes.
 */
export function normalizeMediaScheme(url: string, allowInsecure: boolean): string {
  if (!allowInsecure && url.startsWith('http://')) return `https://${url.slice('http://'.length)}`;
  return url;
}
