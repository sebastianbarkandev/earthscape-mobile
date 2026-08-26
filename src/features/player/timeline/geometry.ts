import { MIN_ZOOM_FRACTION } from './constants';

/**
 * Time <-> pixel mapping. The X axis is UTC seconds; [left,right] is the zoom
 * window inside the full extent [start,end] (web Timeline.jsx:288-305).
 */
export interface Window {
  left: number;
  right: number;
}
export interface Bounds {
  start: number;
  end: number;
  duration: number;
}
export interface Geometry {
  width: number;
  left: number;
  right: number;
  span: number;
  pxPerSec: number;
  /** clamp((t-left)/(right-left), 0, 1) * width — web offsetFromTimeStamp (its Math.min(100,…) was a no-op). */
  xFromUtc(t: number): number;
  /** Unclamped inverse — web timeStampFromEvent. */
  utcFromX(x: number): number;
}

export function createGeometry(width: number, left: number, right: number): Geometry {
  const span = right - left;
  const safeSpan = span > 0 ? span : 1;
  return {
    width,
    left,
    right,
    span,
    pxPerSec: width / safeSpan,
    xFromUtc: (t) => Math.min(1, Math.max(0, (t - left) / safeSpan)) * width,
    utcFromX: (x) => (x / (width || 1)) * safeSpan + left,
  };
}

/** Web setOnZoom: null when the span would be <= 10% of duration; else clamped to bounds. */
export function clampZoom(win: Window, b: Bounds): Window | null {
  if (!(win.right > win.left)) return null;
  if (b.duration > 0 && (win.right - win.left) / b.duration <= MIN_ZOOM_FRACTION) return null;
  return {
    left: Math.max(win.left, b.start),
    right: Math.min(win.right, b.end),
  };
}

/** Web setPan: the whole delta is rejected if either edge would leave [start,end]. */
export function panWindow(win: Window, deltaSec: number, b: Bounds): Window {
  if (win.left + deltaSec < b.start) return win;
  if (win.right + deltaSec > b.end) return win;
  return { left: win.left + deltaSec, right: win.right + deltaSec };
}

/** Pinch: keep the time under the initial focal point under the current focal point. */
export function pinchWindow(
  start: Window,
  g: { c0: number; d0: number; c: number; d: number },
  width: number,
  b: Bounds,
): Window {
  const span = start.right - start.left;
  if (!(span > 0) || !(width > 0) || !(g.d > 0) || !(g.d0 > 0)) return start;
  const scale = g.d0 / g.d; // fingers apart -> d grows -> scale < 1 -> zoom in
  const focalTime = start.left + (g.c0 / width) * span;
  const newSpan = span * scale;
  const newLeft = focalTime - (g.c / width) * newSpan;
  const candidate = { left: newLeft, right: newLeft + newSpan };
  const clamped = clampZoom(candidate, b);
  if (!clamped) return start;
  // A pinch that hits a bound must not shrink the span (that would look like a zoom-in).
  if (clamped.right - clamped.left < newSpan - 1e-9) {
    const shifted = { left: clamped.left, right: clamped.left + newSpan };
    if (shifted.right > b.end) return { left: Math.max(b.start, b.end - newSpan), right: b.end };
    return shifted;
  }
  return clamped;
}

/** Affine transform that maps content drawn for `base` onto the `view` window: x' = x*sx + tx. */
export function transformFor(base: Window, view: Window, width: number): { tx: number; sx: number } {
  const vSpan = view.right - view.left || 1;
  return {
    sx: (base.right - base.left) / vSpan,
    tx: (width * (base.left - view.left)) / vSpan,
  };
}

/** Whether a window equals the full extent (then Redux stores `null` and follows live growth). */
export function isFullWindow(win: Window, b: Bounds, eps = 1e-6): boolean {
  return Math.abs(win.left - b.start) < eps && Math.abs(win.right - b.end) < eps;
}
