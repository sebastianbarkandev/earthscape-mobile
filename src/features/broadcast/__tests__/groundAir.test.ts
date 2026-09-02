import { AIRCRAFT_STALE_S, computeGroundAir, EMPTY_GROUND_AIR, latestAircraftFix, type AircraftFix } from '../airlink/groundAir';
import { destination, type LatLon } from '@/common/geo';

const T = 1_700_000_000;
const A: LatLon = [39.5, -104.9];
// A MISB-style footprint: a wedge on the ground ~1 km south of the aircraft.
const ring: LatLon[] = [destination(A, 160, 900), destination(A, 200, 900), destination(A, 195, 1400), destination(A, 165, 1400)];
const centre = destination(A, 180, 1150);
/** Bearings a hair under 360 are "north" too. */
const north = (deg: number | undefined) => (deg == null ? NaN : deg > 180 ? deg - 360 : deg);

function page(over: Record<string, unknown> = {}) {
  return {
    loc: [[T, A], [T + 1, [39.501, -104.9]]] as [number, LatLon][],
    acft_hdg: [[T, 90], [T + 1, 95]] as [number, number][],
    target: [] as [number, LatLon][],
    footprint: [] as [number, LatLon[]][],
    graphs: {},
    first_flight_point_utc: T,
    last_flight_point_utc: T + 1,
    ...over,
  };
}

describe('latestAircraftFix', () => {
  it('reduces a page to its newest loc/heading and carries the sensor series when present', () => {
    const fix = latestAircraftFix(page({ target: [[T, centre]], footprint: [[T, ring]] }), null);
    expect(fix).toEqual({ utc: T + 1, loc: [39.501, -104.9], heading: 95, target: centre, footprint: ring });
  });

  it('a tail without target/footprint keeps the previous sensor values (series are compressed independently)', () => {
    const first = latestAircraftFix(page({ target: [[T, centre]], footprint: [[T, ring]] }), null) as AircraftFix;
    const tail = latestAircraftFix(page({ loc: [[T + 5, [39.51, -104.9]]], acft_hdg: [], last_flight_point_utc: T + 5 }), first);
    expect(tail).toEqual({ utc: T + 5, loc: [39.51, -104.9], heading: 95, target: centre, footprint: ring });
  });

  it('an empty page or the `[]` a point-less video answers leaves the previous fix alone', () => {
    const prev: AircraftFix = { utc: T, loc: A, heading: 90, target: null, footprint: null };
    expect(latestAircraftFix(page({ loc: [], acft_hdg: [], last_flight_point_utc: null }), prev)).toEqual(prev);
    expect(latestAircraftFix(undefined, prev)).toBe(prev);
    expect(latestAircraftFix(undefined, null)).toBeNull();
    expect(latestAircraftFix(page({ loc: [] }), null)).toBeNull();
  });

  it('never moves backwards in time and ignores junk sensor values', () => {
    const prev: AircraftFix = { utc: T + 50, loc: A, heading: 90, target: centre, footprint: ring };
    const fix = latestAircraftFix(page({ target: [[T + 1, [999, 0]]], footprint: [[T + 1, [[1, 2], null, 'x']]] }), prev);
    expect(fix?.utc).toBe(T + 50);
    expect(fix?.target).toEqual(centre);
    expect(fix?.footprint).toEqual(ring);
  });
});

describe('computeGroundAir', () => {
  const fix: AircraftFix = { utc: T, loc: A, heading: 90, target: centre, footprint: ring };
  const now = (T + 5) * 1000;

  it('is empty without a fix', () => {
    expect(computeGroundAir(A, 0, null, now)).toBe(EMPTY_GROUND_AIR);
  });

  it('knows the age of the fix even before the phone has a position', () => {
    const ga = computeGroundAir(null, null, fix, now);
    expect(ga).toEqual({ inFrame: null, target: null, aircraft: null, ageS: 5, stale: false });
    expect(computeGroundAir(null, null, fix, (T + AIRCRAFT_STALE_S + 1) * 1000).stale).toBe(true);
  });

  it('flags the phone in frame when it stands inside the footprint, out otherwise', () => {
    const inside = destination(A, 180, 1100);
    const outside = destination(A, 0, 1100);
    expect(computeGroundAir(inside, null, fix, now).inFrame).toBe(true);
    expect(computeGroundAir(outside, null, fix, now).inFrame).toBe(false);
    expect(computeGroundAir(inside, null, { ...fix, footprint: null }, now).inFrame).toBeNull();
  });

  it('gives distance, true bearing and the turn relative to the camera heading', () => {
    const me = destination(A, 180, 2000); // 2 km due south of the aircraft
    const ga = computeGroundAir(me, 90, fix, now);
    expect(ga.aircraft?.distanceM).toBeCloseTo(2000, -1);
    expect(north(ga.aircraft?.bearingDeg)).toBeCloseTo(0, 0);
    expect(ga.aircraft?.relativeDeg).toBeCloseTo(-90, 0); // facing east, the aircraft is to the left
    expect(ga.target?.distanceM).toBeCloseTo(850, -1);
    expect(north(ga.target?.bearingDeg)).toBeCloseTo(0, 0);
    // No compass: absolute bearings still work, the relative turn is unknown.
    expect(computeGroundAir(me, null, fix, now).aircraft?.relativeDeg).toBeNull();
    // No target on the aircraft: only the aircraft vector.
    expect(computeGroundAir(me, 90, { ...fix, target: null }, now).target).toBeNull();
  });
});
