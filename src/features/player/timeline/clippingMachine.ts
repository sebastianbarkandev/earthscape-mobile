import { MIN_CLIP_SEC } from './constants';

/**
 * Pure port of the web clipping reducers (eventSlice startDraggingClipmark /
 * dragClipmark / stopDraggingClipmark). The active side flips automatically when
 * the finger crosses the opposite edge.
 */
export type ClipSide = 'start' | 'end';
export interface ClipDrag {
  side: ClipSide;
  time_start: number;
  time_end: number;
  clipmarkId: number | null;
}

export function startDrag(c: { time_start: number; time_end: number }, side: ClipSide, clipmarkId: number | null = null): ClipDrag {
  return { side, time_start: c.time_start, time_end: c.time_end, clipmarkId };
}

export function dragClip(d: ClipDrag, t: number): ClipDrag {
  let { side, time_start, time_end } = d;
  if (t > time_end) {
    time_end = t;
    side = 'end';
  } else if (t < time_start) {
    time_start = t;
    side = 'start';
  } else if (side === 'start') {
    time_start = t;
  } else {
    time_end = t;
  }
  return { ...d, side, time_start, time_end };
}

/**
 * Web stopDraggingClipmark: below 1s the mark collapses to a timepoint. (The web
 * flips `type` at 0.05s but nulls `time_end` at 1s — one threshold here.)
 */
export function finalizeDrag(
  d: ClipDrag,
  minClipSec = MIN_CLIP_SEC,
): { time_start: number; time_end: number | null; type: 'clip' | 'timepoint' } {
  const dur = d.time_end - d.time_start;
  if (dur < minClipSec) return { time_start: d.time_start, time_end: null, type: 'timepoint' };
  return { time_start: d.time_start, time_end: d.time_end, type: 'clip' };
}
