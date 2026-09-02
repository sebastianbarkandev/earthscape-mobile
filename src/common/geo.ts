/**
 * Small WGS-84 helpers for the ground↔air overlay. Everything works on `[lat, lon]` pairs —
 * the order the backend's series arrive in (ST_FlipCoordinates) — and degrees.
 */
export type LatLon = [number, number];

/** IUGG mean Earth radius (m). */
export const EARTH_RADIUS_M = 6371008.8;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function isLatLon(v: unknown): v is LatLon {
  return Array.isArray(v) && v.length >= 2 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Math.abs(v[0]) <= 90 && Math.abs(v[1]) <= 180;
}

/** Wrap to [0, 360). */
export function normalizeDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed turn from `heading` to `bearing`, in (-180, 180]: negative = turn left. */
export function relativeBearingDeg(bearingDeg: number, headingDeg: number): number {
  const d = normalizeDeg(bearingDeg - headingDeg);
  return d > 180 ? d - 360 : d;
}

/** Great-circle (haversine) distance in metres. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from `a` to `b`, degrees clockwise from true north in [0, 360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const φ1 = toRad(a[0]);
  const φ2 = toRad(b[0]);
  const dλ = toRad(b[1] - a[1]);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

/** Point reached from `from` after `distance` metres along `bearing`. */
export function destination(from: LatLon, bearing: number, distance: number): LatLon {
  const δ = distance / EARTH_RADIUS_M;
  const θ = toRad(bearing);
  const φ1 = toRad(from[0]);
  const λ1 = toRad(from[1]);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [toDeg(φ2), normalizeLon(toDeg(λ2))];
}

function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/**
 * Even-odd ray casting on the (lat, lon) plane. Fine for sensor footprints (a few hundred
 * metres to a few kilometres across); a ring is accepted open or closed, and anything with
 * fewer than three usable vertices is "outside".
 */
export function pointInRing(p: LatLon, ring: ReadonlyArray<LatLon>): boolean {
  const pts = ring.filter(isLatLon);
  if (pts.length < 3) return false;
  let inside = false;
  const [py, px] = p;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [yi, xi] = pts[i];
    const [yj, xj] = pts[j];
    const crosses = yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** "850 m" / "1.2 km" / "12 km". */
export function formatDistance(m: number): string {
  if (!Number.isFinite(m) || m < 0) return '—';
  if (m < 1000) return `${Math.round(m)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}

/** Eight-wind compass label for a bearing. */
export function compassLabel(bearing: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(normalizeDeg(bearing) / 45) % 8];
}
