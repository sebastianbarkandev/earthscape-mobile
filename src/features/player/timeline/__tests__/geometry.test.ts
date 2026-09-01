import { clampToCanvas, clampZoom, createGeometry, isFullWindow, labelPlacement, labelWidth, panWindow, pinchWindow, transformFor } from '../geometry';

const b = { start: 1000, end: 1100, duration: 100 };

describe('createGeometry', () => {
  const g = createGeometry(300, 1000, 1100);
  it('maps time to clamped pixels and back', () => {
    expect(g.xFromUtc(1000)).toBe(0);
    expect(g.xFromUtc(1050)).toBe(150);
    expect(g.xFromUtc(1100)).toBe(300);
    expect(g.xFromUtc(900)).toBe(0);
    expect(g.xFromUtc(2000)).toBe(300);
    expect(g.utcFromX(g.xFromUtc(1037))).toBeCloseTo(1037, 9);
    expect(g.utcFromX(-30)).toBeCloseTo(990, 9); // unclamped inverse
  });
});

describe('clampZoom (web setOnZoom)', () => {
  it('rejects spans at or below 10% of duration', () => {
    expect(clampZoom({ left: 1000, right: 1010 }, b)).toBeNull();
    expect(clampZoom({ left: 1000, right: 1010.5 }, b)).not.toBeNull();
  });
  it('clamps to the extent', () => {
    expect(clampZoom({ left: 900, right: 1200 }, b)).toEqual({ left: 1000, right: 1100 });
  });
  it('rejects inverted windows', () => {
    expect(clampZoom({ left: 1050, right: 1040 }, b)).toBeNull();
  });
});

describe('panWindow (web setPan)', () => {
  it('is a no-op when either edge would leave the extent', () => {
    const w = { left: 1000, right: 1050 };
    expect(panWindow(w, -1, b)).toBe(w);
    expect(panWindow({ left: 1050, right: 1100 }, 1, b)).toEqual({ left: 1050, right: 1100 });
  });
  it('shifts both edges otherwise', () => {
    expect(panWindow({ left: 1000, right: 1050 }, 20, b)).toEqual({ left: 1020, right: 1070 });
  });
});

describe('pinchWindow', () => {
  it('keeps the focal time fixed while zooming in', () => {
    const start = { left: 1000, right: 1100 };
    const width = 300;
    const focalX = 150; // 1050
    const out = pinchWindow(start, { c0: focalX, d0: 100, c: focalX, d: 200 }, width, b);
    expect(out.right - out.left).toBeCloseTo(50, 6);
    const g = createGeometry(width, out.left, out.right);
    expect(g.utcFromX(focalX)).toBeCloseTo(1050, 6);
  });
  it('falls back to the start window when zooming past the limit', () => {
    const start = { left: 1000, right: 1020 };
    expect(pinchWindow(start, { c0: 10, d0: 10, c: 10, d: 1000 }, 300, b)).toEqual(start);
  });
  it('does not shrink the span when a zoom-out hits the bounds', () => {
    const start = { left: 1000, right: 1050 };
    const out = pinchWindow(start, { c0: 0, d0: 200, c: 0, d: 100 }, 300, b); // zoom out 2x anchored at left edge
    expect(out).toEqual({ left: 1000, right: 1100 });
  });
});

describe('transformFor', () => {
  it('is the identity for equal windows and maps times consistently otherwise', () => {
    expect(transformFor({ left: 0, right: 10 }, { left: 0, right: 10 }, 100)).toEqual({ tx: 0, sx: 1 });
    const base = { left: 1000, right: 1100 };
    const view = { left: 1025, right: 1075 };
    const { tx, sx } = transformFor(base, view, 300);
    const gb = createGeometry(300, base.left, base.right);
    const gv = createGeometry(300, view.left, view.right);
    expect(gb.xFromUtc(1050) * sx + tx).toBeCloseTo(gv.xFromUtc(1050), 6);
  });
});

describe('isFullWindow', () => {
  it('detects the full extent', () => {
    expect(isFullWindow({ left: 1000, right: 1100 }, b)).toBe(true);
    expect(isFullWindow({ left: 1001, right: 1100 }, b)).toBe(false);
  });
});

describe('labelPlacement / clampToCanvas (UI-016)', () => {
  it('anchors the label to the right of the marker when it fits', () => {
    expect(labelPlacement(100, 400, '1:23', 10)).toEqual({ x: 104, anchor: 'start' });
  });
  it('flips it to the left at the right edge — where a live playhead lives', () => {
    // width 300, x 298, "12:34:56" ~ 48pt: start-anchored it would be cut off.
    const p = labelPlacement(298, 300, '12:34:56', 10);
    expect(p.anchor).toBe('end');
    expect(p.x).toBe(294);
    expect(p.x - labelWidth('12:34:56', 10)).toBeGreaterThanOrEqual(0);
  });
  it('keeps the label inside the canvas even when neither side fits', () => {
    const p = labelPlacement(10, 20, '12:34:56', 10);
    expect(p.anchor).toBe('end');
    expect(p.x).toBeLessThanOrEqual(20);
    expect(p.x).toBeGreaterThan(0);
  });
  it('a label at the very left stays start-anchored', () => {
    expect(labelPlacement(0, 400, '0:00', 10)).toEqual({ x: 4, anchor: 'start' });
  });
  it('labelWidth grows with the text and the font size', () => {
    expect(labelWidth('', 10)).toBe(0);
    expect(labelWidth('0:00', 10)).toBeCloseTo(24);
    expect(labelWidth('0:00', 20)).toBeCloseTo(48);
  });
  it('clampToCanvas keeps a grip fully inside the drawing area', () => {
    expect(clampToCanvas(0, 300, 2.5)).toBe(2.5);
    expect(clampToCanvas(300, 300, 2.5)).toBe(297.5);
    expect(clampToCanvas(150, 300, 2.5)).toBe(150);
    expect(clampToCanvas(NaN, 300, 2.5)).toBe(2.5);
    expect(clampToCanvas(5, 0, 2.5)).toBe(2.5); // canvas not measured yet
  });
});
