/**
 * Single source of truth for the API host.
 * RULE (CLAUDE.md #1): production host is the ORG SUBDOMAIN — never api.*
 * Dev: LAN IP of the machine running the earthscape Flask app.
 */
const DEV_API_HOST =
  process.env.EXPO_PUBLIC_API_URL && process.env.EXPO_PUBLIC_API_URL.length > 0
    ? process.env.EXPO_PUBLIC_API_URL
    : 'http://192.168.1.42:8000'; // ← change to your laptop's LAN IP

let currentHost: string = __DEV__ ? DEV_API_HOST : '';

export function setSubdomain(subdomain: string) {
  currentHost = __DEV__
    ? DEV_API_HOST
    : `https://${subdomain.trim().toLowerCase()}.earthscape.com`;
}

export function getApiHost(): string {
  return currentHost;
}

/**
 * Media URLs from the API are sometimes absolute (CloudFront) and sometimes
 * server-relative (e.g. live playlist '/live/5/playlist.m3u8' from url_for).
 * Always resolve through this before handing to the player.
 */
export function resolveMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `${getApiHost()}${url.startsWith('/') ? '' : '/'}${url}`;
}
