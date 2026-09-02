import { bearingDeg, compassLabel, destination, distanceM, formatDistance, isLatLon, normalizeDeg, pointInRing, relativeBearingDeg, type LatLon } from '../geo';

const DENVER: LatLon = [39.7392, -104.9903];

describe('geo', () => {
  it('distance + bearing agree with destination() round trips', () => {
    const there = destination(DENVER, 60, 1500);
    expect(distanceM(DENVER, there)).toBeCloseTo(1500, 0);
    expect(bearingDeg(DENVER, there)).toBeCloseTo(60, 2);
    expect(distanceM(DENVER, DENVER)).toBe(0);
  });

  it('bearing: due north / east / south / west', () => {
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(0, 6);
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(90, 6);
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(180, 6);
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(270, 6);
  });

  it('relative bearing is the signed turn from the heading, in (-180, 180]', () => {
    expect(relativeBearingDeg(90, 0)).toBe(90);
    expect(relativeBearingDeg(350, 10)).toBe(-20);
    expect(relativeBearingDeg(10, 350)).toBe(20);
    expect(relativeBearingDeg(180, 0)).toBe(180);
    expect(normalizeDeg(-90)).toBe(270);
    expect(normalizeDeg(720)).toBe(0);
  });

  it('point in ring: inside, outside, degenerate, open or closed ring', () => {
    const ring: LatLon[] = [
      [39.74, -105.0],
      [39.74, -104.98],
      [39.72, -104.98],
      [39.72, -105.0],
    ];
    expect(pointInRing([39.73, -104.99], ring)).toBe(true);
    expect(pointInRing([39.75, -104.99], ring)).toBe(false);
    expect(pointInRing([39.73, -104.97], ring)).toBe(false);
    expect(pointInRing([39.73, -104.99], [...ring, ring[0]])).toBe(true);
    expect(pointInRing([39.73, -104.99], ring.slice(0, 2))).toBe(false);
    // Garbage vertices (the backend serialises nulls for missing corners) are skipped, not thrown on.
    expect(pointInRing([39.73, -104.99], [...ring, null as unknown as LatLon])).toBe(true);
  });

  it('a real MISB-style wedge: the phone is in frame when the footprint covers it', () => {
    const aircraft: LatLon = [39.75, -104.99];
    const near = destination(aircraft, 180, 400);
    const far = destination(aircraft, 180, 1200);
    const ring: LatLon[] = [destination(near, 270, 100), destination(near, 90, 100), destination(far, 90, 300), destination(far, 270, 300)];
    expect(pointInRing(destination(aircraft, 180, 800), ring)).toBe(true);
    expect(pointInRing(destination(aircraft, 0, 800), ring)).toBe(false);
  });

  it('formats distances for a glance and validates pairs', () => {
    expect(formatDistance(42.4)).toBe('42 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12_600)).toBe('13 km');
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(359)).toBe('N');
    expect(compassLabel(226)).toBe('SW');
    expect(isLatLon([39.5, -104.9])).toBe(true);
    expect(isLatLon([91, 0])).toBe(false);
    expect(isLatLon(null)).toBe(false);
    expect(isLatLon([Number.NaN, 1])).toBe(false);
  });
});
