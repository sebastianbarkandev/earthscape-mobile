import { computeViewportSize, programTileWidth, PROGRAM_TILE_MAX_W, STICKY_MAX_SHARE, type ViewportInput } from '../viewportLayout';

describe('programTileWidth (RESP-010)', () => {
  it('is a fixed share of narrow windows and capped on wide ones', () => {
    expect(programTileWidth(320)).toBe(122);
    expect(programTileWidth(375)).toBe(143);
    expect(programTileWidth(430)).toBe(PROGRAM_TILE_MAX_W);
    expect(programTileWidth(1024)).toBe(PROGRAM_TILE_MAX_W);
  });
  it('never depends on the number of tiles and survives a degenerate width', () => {
    expect(programTileWidth(0)).toBe(programTileWidth(375));
    expect(programTileWidth(NaN)).toBe(programTileWidth(375));
    // 4 tiles on an SE used to be (375-12-18)/4 ≈ 86pt; now each is 143pt and the strip scrolls.
    expect(programTileWidth(375)).toBeGreaterThan(120);
  });
});

const dev = (name: string, width: number, height: number, insets: Partial<ViewportInput['insets']>, isPad = false) => ({
  name,
  width,
  height,
  insets: { top: 0, bottom: 0, left: 0, right: 0, ...insets },
  isPad,
});

// Reviewer's device matrix (pt). Landscape phones carry the notch on the sides.
const MATRIX = [
  dev('iPhone SE', 375, 667, { top: 20 }),
  dev('iPhone 13 mini', 375, 812, { top: 50, bottom: 34 }),
  dev('iPhone 13 mini landscape', 812, 375, { bottom: 21, left: 50, right: 50 }),
  dev('iPhone 15', 393, 852, { top: 59, bottom: 34 }),
  dev('iPhone 15 Pro Max', 430, 932, { top: 59, bottom: 34 }),
  dev('iPhone 15 Pro Max landscape', 932, 430, { bottom: 21, left: 59, right: 59 }),
  dev('iPad 10.2', 768, 1024, { top: 24, bottom: 20 }, true),
  dev('iPad 12.9', 1024, 1366, { top: 24, bottom: 20 }, true),
  dev('iPad 12.9 landscape', 1366, 1024, { top: 24, bottom: 20 }, true),
  dev('iPad Split View', 320, 768, { top: 24, bottom: 20 }, true),
];
const LAYOUTS = ['video', 'split', 'map'] as const;

describe('computeViewportSize', () => {
  for (const d of MATRIX) {
    for (const layout of LAYOUTS) {
      const r = computeViewportSize({ ...d, layout });
      const visible = d.height - d.insets.top - d.insets.bottom - (d.isPad ? 50 : d.width > d.height ? 32 : 44);

      it(`${d.name} / ${layout}: every pane fits on screen`, () => {
        expect(r.videoH).toBeLessThanOrEqual(visible);
        expect(r.mapH).toBeLessThanOrEqual(visible);
        expect(r.videoH + (r.sideBySide ? 0 : r.mapH)).toBeLessThanOrEqual(visible);
      });

      it(`${d.name} / ${layout}: a pinned viewport leaves room for the page`, () => {
        if (r.sticky) expect(r.videoH + r.mapH).toBeLessThanOrEqual(Math.round(visible * 0.6));
      });

      it(`${d.name} / ${layout}: hidden panes get no height, shown panes do`, () => {
        expect(r.videoH > 0).toBe(layout !== 'map');
        expect(r.mapH > 0).toBe(layout !== 'video');
      });
    }
  }

  it('landscape is never sticky and video+map go side by side', () => {
    const r = computeViewportSize({ ...MATRIX[2], layout: 'split' });
    expect(r.landscape).toBe(true);
    expect(r.sticky).toBe(false);
    expect(r.sideBySide).toBe(true);
    // The old width-only math gave 457pt on a 375pt-tall screen.
    expect(r.videoH).toBeLessThan(375);
    expect(computeViewportSize({ ...MATRIX[2], layout: 'video' }).sideBySide).toBe(false);
  });

  it('portrait phones keep the natural 16:9 video when it fits the cap', () => {
    const r = computeViewportSize({ ...MATRIX[3], layout: 'split' }); // iPhone 15
    expect(r.videoH).toBe(Math.round(393 * 9 / 16));
    expect(r.sticky).toBe(true);
    expect(r.videoH + r.mapH).toBeLessThanOrEqual(Math.round(r.avail * STICKY_MAX_SHARE));
  });

  it('iPad portrait caps the video below a full-width 16:9 (576pt)', () => {
    const r = computeViewportSize({ ...MATRIX[7], layout: 'video' });
    expect(r.videoH).toBeLessThan(576);
  });

  it('content bottom padding follows the home indicator', () => {
    expect(computeViewportSize({ ...MATRIX[0], layout: 'split' }).contentPaddingBottom).toBe(16);
    expect(computeViewportSize({ ...MATRIX[3], layout: 'split' }).contentPaddingBottom).toBe(50);
  });

  it('degenerate windows never produce negative or NaN sizes', () => {
    const r = computeViewportSize({ width: 0, height: 0, insets: { top: 0, bottom: 0, left: 0, right: 0 }, layout: 'split' });
    expect(r.videoH).toBeGreaterThanOrEqual(0);
    expect(r.mapH).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(r.avail)).toBe(true);
  });
});
