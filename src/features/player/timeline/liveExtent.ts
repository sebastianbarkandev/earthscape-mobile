import type { PlayerState } from '../playerSlice';

/**
 * LIVE-022 — how far the timeline reaches while a program is LIVE.
 *
 * A live Video has `end`/`duration` NULL (the backend fills them in when the recording is
 * transcoded), so the naive extent `[start, end]` is a sub-second ruler: the playhead, the
 * clipmarks and the metadata graphs all land off-canvas and zoom/pan cannot recover.
 * While live the right edge is the LIVE EDGE instead — the newest flight point (7 s poll) or
 * the playhead's UTC, which PlayerScreen derives through the video's TimeMapper (never
 * `start + seconds`) — with a minimum span so a stream that just started is still readable.
 *
 * The edge is quantized so the 2 Hz clock cannot recompute the canvas geometry on every
 * tick (RESP-002): it only moves once per LIVE_EDGE_STEP_SEC.
 */
export const LIVE_MIN_WINDOW_SEC = 120;
export const LIVE_EDGE_STEP_SEC = 10;

/**
 * Quantized live edge, or null when the program has a real recording length (VOD extent rules).
 *
 * LIVE-027: the rolling edge must outlast `isLive`. A stream that has just ended is
 * `live_stream_state === 'processing'` with `duration`/`end` still NULL for the whole transcode
 * window (backend models/video.py — both are filled in when the recording is ready), so keying
 * only on `isLive` snapped the ruler back to `[start, start + 1s]` for minutes, with the
 * playhead, the clipmarks (TAK chat keeps arriving) and the graphs off-canvas and zoom/pan
 * clamped to the same degenerate extent. `duration > 0` is the same rule the Screenshot gate
 * uses (LIVE-021): no usable duration means no usable VOD extent either.
 */
export function liveEdgeOf(p: Pick<PlayerState, 'isLive' | 'mapData' | 'time'>): number | null {
  if (!p.isLive && (p.time.duration ?? 0) > 0) return null;
  const utc = Math.max(p.mapData.lastUtc ?? 0, p.time.currentUtc ?? 0);
  return utc > 0 ? Math.ceil(utc / LIVE_EDGE_STEP_SEC) * LIVE_EDGE_STEP_SEC : 0;
}

/** Rolling right edge: `end` for VOD, the (floored) live edge while live. */
export function extentRight(start: number, end: number | null, liveEdge: number | null): number {
  const base = end != null && end > start ? end : start;
  if (liveEdge == null) return base;
  return Math.max(base, liveEdge, start + LIVE_MIN_WINDOW_SEC);
}

/**
 * The extent every timeline consumer clamps against (selectors + the zoom/pan reducers).
 * Scalar arguments on purpose: selectors feed them as memoization inputs, and `liveEdge` is
 * quantized, so a 2 Hz playhead tick does not produce a new extent object (RESP-002).
 */
export function extentFrom(
  start: number | null,
  end: number | null,
  duration: number | null,
  liveEdge: number | null,
): { start: number; end: number; duration: number } {
  const l = start ?? 0;
  if (liveEdge != null) {
    const r = extentRight(l, end, liveEdge);
    return { start: l, end: r, duration: r - l };
  }
  const r = end ?? l + 1;
  return { start: l, end: r, duration: duration ?? Math.max(0, r - l) };
}

/** Convenience for reducers, which hold the whole player state. */
export function extentOf(p: Pick<PlayerState, 'isLive' | 'mapData' | 'time'>) {
  return extentFrom(p.time.start, p.time.end, p.time.duration, liveEdgeOf(p));
}
