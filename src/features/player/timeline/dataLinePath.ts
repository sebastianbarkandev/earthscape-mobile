import type { FlightPointFieldMeta } from '@/common/lib/formatFlightPointValue';
import { DATALINE_PAD_BOTTOM, DATALINE_PAD_TOP } from './constants';

export type Series = Array<[number, unknown]>;

/** First index with series[i][0] > t (series sorted by utc). */
export function lowerBound(series: Series, t: number): number {
  let lo = 0;
  let hi = series.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const p = series[mid];
    const v = Array.isArray(p) ? p[0] : NaN;
    if (Number.isFinite(v) && (v as number) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Exact port of the web DataLine path builder: window-clip (left < utc < right),
 * drop non-finite values, apply valid_range [min,max), decimate to ~1 point/px
 * (stride when round(n/width) > 2), autoscale to the VISIBLE window (log if
 * y_scale==='log'), closed area path `M x0 h+5 L x y, ... lastx h+5 Z`.
 * Returns null when nothing is drawable (web returns null / no <path>).
 */
export function buildDataLinePath(
  series: Series | null | undefined,
  opts: { left: number; right: number; width: number; height: number; meta: FlightPointFieldMeta | null | undefined },
): string | null {
  const { left, right, width, height, meta } = opts;
  if (!series || series.length === 0 || !(width > 0) || !(right > left)) return null;

  // Visible slice via binary search (series are utc-sorted), then the web's filters.
  const from = lowerBound(series, left);
  let ret: Array<[number, number]> = [];
  for (let i = from; i < series.length; i++) {
    const p = series[i];
    if (!Array.isArray(p) || p.length < 2) continue;
    const t = p[0];
    if (!Number.isFinite(t)) continue;
    if (t >= right) break;
    if (t <= left) continue;
    const v = p[1];
    if (v === undefined || v === null || typeof v !== 'number' || !Number.isFinite(v)) continue;
    ret.push([t, v]);
  }
  if (ret.length === 0) return null;

  if (meta?.valid_range) {
    const { min, max } = meta.valid_range;
    ret = ret.filter((p) => p[1] < max && p[1] >= min);
    if (ret.length === 0) return null;
  }

  const mod = Math.round(ret.length / width);
  if (mod > 2) ret = ret.filter((_, i) => i % mod === 0);
  if (ret.length === 0) return null;

  const duration = right - left;
  const isLog = meta?.y_scale === 'log';
  let globalMax = -Infinity;
  let globalMin = Infinity;
  for (const p of ret) {
    if (p[1] > globalMax) globalMax = p[1];
    if (p[1] < globalMin) globalMin = p[1];
  }
  if (isLog) {
    globalMax = Math.log(globalMax);
    globalMin = Math.log(globalMin);
  }
  let globalDiff = globalMax - globalMin;
  if (globalDiff === 0 || !Number.isFinite(globalDiff)) globalDiff = 1;

  const padding = height - (DATALINE_PAD_TOP + DATALINE_PAD_BOTTOM);
  const firstX = ((ret[0][0] - left) / duration) * width;
  const path: string[] = [`M${firstX} ${height + 5} L`];
  let lastx = 0;
  for (const v of ret) {
    const x = ((v[0] - left) / duration) * width;
    const yv = isLog ? Math.log(v[1]) : v[1];
    let y = padding - ((yv - globalMin) / globalDiff) * padding;
    if (!Number.isFinite(y)) y = padding;
    lastx = x;
    path.push(`${x} ${y + DATALINE_PAD_TOP},`);
  }
  path.push(`${lastx} ${height + 5}`);
  path.push(' Z');
  return path.join(' ');
}
