// Contract tests for the verbatim port src/common/lib/timeSeries.js.
// These tests DEFINE the port's behaviour (CLAUDE.md rule 5): never edit the lib
// to make one pass. Series are arrays of [utc, value] pairs, ascending by utc.

import {
  getClosestPointOrNull,
  getClosestPointValueOrNull,
  getLastValueOrNull,
} from '../timeSeries';

// Shaped like a flight_data heading series: [utc, value] ascending.
const HEADINGS = [
  [1000, 10],
  [1010, 20],
  [1020, 30],
  [1030, 40],
];

// Shaped like flight_data `loc`: value is a [lat, lon] pair (backend ST_FlipCoordinates).
const LOC = [
  [1000, [40.1, -75.1]],
  [1010, [40.2, -75.2]],
  [1020, [40.3, -75.3]],
];

describe('getClosestPointValueOrNull', () => {
  it('returns the value at an exact timestamp', () => {
    expect(getClosestPointValueOrNull(HEADINGS, 1000)).toBe(10);
    expect(getClosestPointValueOrNull(HEADINGS, 1020)).toBe(30);
    expect(getClosestPointValueOrNull(HEADINGS, 1030)).toBe(40);
  });

  it('returns the preceding sample between two points (floor, not nearest)', () => {
    expect(getClosestPointValueOrNull(HEADINGS, 1001)).toBe(10);
    expect(getClosestPointValueOrNull(HEADINGS, 1009.999)).toBe(10);
    expect(getClosestPointValueOrNull(HEADINGS, 1015)).toBe(20);
    expect(getClosestPointValueOrNull(HEADINGS, 1029)).toBe(30);
  });

  it('clamps to the first value before the series starts', () => {
    // Keeps the aircraft marker pinned at the start of the path instead of vanishing.
    expect(getClosestPointValueOrNull(HEADINGS, 999.999)).toBe(10);
    expect(getClosestPointValueOrNull(HEADINGS, 0)).toBe(10);
    expect(getClosestPointValueOrNull(HEADINGS, -1e9)).toBe(10);
  });

  it('clamps to the last value after the series ends', () => {
    expect(getClosestPointValueOrNull(HEADINGS, 1030.001)).toBe(40);
    expect(getClosestPointValueOrNull(HEADINGS, 99999)).toBe(40);
  });

  it('clamps in both directions for a single-point series', () => {
    const one = [[1000, 'only']];
    expect(getClosestPointValueOrNull(one, 500)).toBe('only');
    expect(getClosestPointValueOrNull(one, 1000)).toBe('only');
    expect(getClosestPointValueOrNull(one, 5000)).toBe('only');
  });

  it('returns null for an empty or missing series', () => {
    expect(getClosestPointValueOrNull([], 1000)).toBeNull();
    expect(getClosestPointValueOrNull(null, 1000)).toBeNull();
    expect(getClosestPointValueOrNull(undefined, 1000)).toBeNull();
  });

  it('preserves falsy values instead of collapsing them to null', () => {
    // heading 0 (due north) must survive — a truthiness check here would be a bug.
    const withZero = [
      [1000, 0],
      [1010, 90],
    ];
    expect(getClosestPointValueOrNull(withZero, 1005)).toBe(0);
    expect(getClosestPointValueOrNull(withZero, 900)).toBe(0);
    expect(getClosestPointValueOrNull([[1000, false]], 1000)).toBe(false);
  });

  it('returns [lat, lon] pairs unchanged for the loc series', () => {
    expect(getClosestPointValueOrNull(LOC, 1015)).toEqual([40.2, -75.2]);
    expect(getClosestPointValueOrNull(LOC, 900)).toEqual([40.1, -75.1]);
    expect(getClosestPointValueOrNull(LOC, 9000)).toEqual([40.3, -75.3]);
  });

  it('returns null when the matched point has no value', () => {
    // Both entries still have a numeric timestamp, so this exercises the
    // length-check guard, NOT the `continue` branch below.
    const malformed = [[1000], [1010, 'b']];
    expect(getClosestPointValueOrNull(malformed, 1005)).toBeNull();
  });

  // KNOWN HAZARD, deliberately untested: bisect (timeSeries.js:28-30) hits
  // `continue` when the midpoint element has a non-numeric [0], without
  // narrowing lo/hi — so a malformed element at a repeatedly-chosen midpoint
  // spins forever. A test for it would hang the suite rather than fail, and the
  // lib is a verbatim port that must not be patched (CLAUDE.md rule 5). The
  // real guard is upstream: flight_data series must be numeric-keyed before
  // they reach these helpers.
  // eslint-disable-next-line jest/no-disabled-tests
  test.todo('bisect: malformed interior element infinite-loops — fix upstream, not in the port');

  it('binary-searches a long series correctly', () => {
    const big = Array.from({ length: 5000 }, (_, i) => [i * 10, i]);
    expect(getClosestPointValueOrNull(big, 0)).toBe(0);
    expect(getClosestPointValueOrNull(big, 9)).toBe(0);
    expect(getClosestPointValueOrNull(big, 10)).toBe(1);
    expect(getClosestPointValueOrNull(big, 25555)).toBe(2555);
    expect(getClosestPointValueOrNull(big, 49990)).toBe(4999);
    expect(getClosestPointValueOrNull(big, 60000)).toBe(4999);
    for (let i = 0; i < 5000; i += 137) {
      expect(getClosestPointValueOrNull(big, i * 10 + 5)).toBe(i);
    }
  });
});

describe('getClosestPointOrNull', () => {
  it('returns the whole [utc, value] pair at or before the timestamp', () => {
    expect(getClosestPointOrNull(HEADINGS, 1015)).toEqual([1010, 20]);
    expect(getClosestPointOrNull(HEADINGS, 1020)).toEqual([1020, 30]);
  });

  it('returns the first point for a timestamp before the series', () => {
    expect(getClosestPointOrNull(HEADINGS, 0)).toEqual([1000, 10]);
  });

  it('returns null for an empty or missing series', () => {
    expect(getClosestPointOrNull([], 1000)).toBeNull();
    expect(getClosestPointOrNull(null, 1000)).toBeNull();
  });
});

describe('getLastValueOrNull', () => {
  it('returns the newest value — the live-follow case', () => {
    expect(getLastValueOrNull(HEADINGS)).toBe(40);
    expect(getLastValueOrNull(LOC)).toEqual([40.3, -75.3]);
  });

  it('preserves a falsy newest value', () => {
    expect(getLastValueOrNull([[1000, 90], [1010, 0]])).toBe(0);
  });

  it('returns null for an empty, missing, or malformed series', () => {
    expect(getLastValueOrNull([])).toBeNull();
    expect(getLastValueOrNull(null)).toBeNull();
    expect(getLastValueOrNull(undefined)).toBeNull();
    expect(getLastValueOrNull([[1000, 'a'], [1010]])).toBeNull();
  });
});
