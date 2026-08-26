import { calculateMarkerLength, computeTicks } from '../tickMarkers';

describe('calculateMarkerLength (web ladder)', () => {
  it.each([
    [1, 1], [2, 2], [4, 5], [10, 5], [20, 15], [45, 30], [100, 60], [200, 120], [500, 300], [1000, 600], [3000, 1800], [99999, 3600],
  ])('deltaT %d -> %d', (dt, expected) => {
    expect(calculateMarkerLength(dt, 1)).toBe(expected);
  });
});

describe('computeTicks', () => {
  it('returns nothing without a duration', () => {
    expect(computeTicks({ start: 0, end: 0, left: 0, right: 0, width: 300 })).toEqual([]);
  });
  it('places ticks relative to start inside the visible window with h:mm:ss labels', () => {
    const ticks = computeTicks({ start: 1000, end: 1120, left: 1000, right: 1120, width: 300 });
    expect(ticks.length).toBeGreaterThan(0);
    ticks.forEach((t) => {
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(300);
    });
    expect(ticks[0].label).toMatch(/^\d+:\d\d:\d\d$/);
  });
  it('skips ticks left of the zoom window', () => {
    const ticks = computeTicks({ start: 1000, end: 1120, left: 1060, right: 1120, width: 300 });
    ticks.forEach((t) => expect(t.seconds).toBeGreaterThan(60));
  });
});
