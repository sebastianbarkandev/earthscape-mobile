import { buildDataLinePath, lowerBound } from '../dataLinePath';

const series = Array.from({ length: 1000 }, (_, i) => [1000 + i, Math.sin(i / 20) * 10 + 20] as [number, number]);
const opts = { left: 1000, right: 2000, width: 300, height: 100, meta: { color: '#f00' } };

describe('lowerBound', () => {
  it('finds the first point after t', () => {
    expect(lowerBound(series, 999)).toBe(0);
    expect(lowerBound(series, 1000)).toBe(1);
    expect(lowerBound(series, 1499.5)).toBe(500);
    expect(lowerBound(series, 5000)).toBe(1000);
  });
});

describe('buildDataLinePath (web DataLine port)', () => {
  it('returns null for empty / out-of-window / invalid data', () => {
    expect(buildDataLinePath([], opts)).toBeNull();
    expect(buildDataLinePath(series, { ...opts, left: 5000, right: 6000 })).toBeNull();
    expect(buildDataLinePath([[1500, null], [1501, 'x']], opts)).toBeNull();
  });
  it('applies valid_range [min, max)', () => {
    const s: Array<[number, number]> = [[1100, 5], [1200, 50], [1300, 100]];
    expect(buildDataLinePath(s, { ...opts, meta: { color: '#f00', valid_range: { min: 0, max: 50 } } })).toMatch(/^M/);
    expect(buildDataLinePath(s, { ...opts, meta: { color: '#f00', valid_range: { min: 200, max: 300 } } })).toBeNull();
  });
  it('builds a closed area path decimated to about one point per pixel', () => {
    const d = buildDataLinePath(series, opts)!;
    expect(d.startsWith('M')).toBe(true);
    expect(d.trim().endsWith('Z')).toBe(true);
    const points = d.split(',').length - 1;
    expect(points).toBeLessThanOrEqual(opts.width * 1.5 + 2); // web rule: stride = round(n/width) leaves up to 1.5 pts/px
    expect(points).toBeGreaterThan(opts.width / 4);
    // Baseline at height + 5 both ends
    expect(d).toContain(`${opts.height + 5} L`);
    expect(d).toMatch(new RegExp(`${opts.height + 5}\\s+Z$`));
  });
  it('keeps y inside the padded band and does not NaN on flat series', () => {
    const flat: Array<[number, number]> = [[1100, 7], [1200, 7], [1300, 7]];
    const d = buildDataLinePath(flat, opts)!;
    expect(d).not.toMatch(/NaN/);
    const ys = [...d.matchAll(/ (-?[\d.]+),/g)].map((m) => Number(m[1]));
    ys.forEach((y) => {
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(opts.height - 8 + 1e-9);
    });
  });
  it('log scale is monotonic for increasing values', () => {
    const inc: Array<[number, number]> = [[1100, 1], [1200, 10], [1300, 100]];
    const d = buildDataLinePath(inc, { ...opts, meta: { color: '#f00', y_scale: 'log' } })!;
    const ys = [...d.matchAll(/ (-?[\d.]+),/g)].map((m) => Number(m[1]));
    expect(ys[0]).toBeGreaterThan(ys[1]);
    expect(ys[1]).toBeGreaterThan(ys[2]);
  });
});
