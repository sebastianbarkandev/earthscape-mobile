import { getLastValueOrNull } from '@/common/lib/timeSeries';
import { bearingDeg, distanceM, isLatLon, pointInRing, relativeBearingDeg, type LatLon } from '@/common/geo';
import type { FlightData } from '@/features/player/api';

/** The aircraft's latest known state, reduced from the flight_data series tail. */
export interface AircraftFix {
  /** Epoch seconds of the newest point that contributed. */
  utc: number;
  loc: LatLon;
  heading: number | null;
  /** Sensor frame centre on the ground (MISB Frame Center). */
  target: LatLon | null;
  /** Sensor footprint ring (MISB corner points 1..4). */
  footprint: LatLon[] | null;
}

/** Over this the aircraft data is shown as stale (the plane may have lost its link, or landed). */
export const AIRCRAFT_STALE_S = 20;

/**
 * Fold a flight_data page (a full read or an `?after=` tail) into the last known fix. The
 * series are compressed independently, so a tail can advance `loc` without repeating an
 * unchanged `target`/`footprint` — previous values are kept unless the page brings newer ones.
 */
export function latestAircraftFix(page: Partial<FlightData> | null | undefined, prev: AircraftFix | null): AircraftFix | null {
  if (!page) return prev;
  const loc = getLastValueOrNull(page.loc ?? []);
  const utcOf = (series: ReadonlyArray<[number, unknown]> | undefined) => (series && series.length ? series[series.length - 1][0] : null);
  const locUtc = utcOf(page.loc);
  if (!isLatLon(loc) || locUtc == null) {
    if (!prev) return null;
    return { ...prev, ...sensorPart(page, prev) };
  }
  const hdg = getLastValueOrNull(page.acft_hdg ?? []);
  const base: AircraftFix = {
    utc: Math.max(locUtc, prev?.utc ?? 0, page.last_flight_point_utc ?? 0),
    loc,
    heading: typeof hdg === 'number' && Number.isFinite(hdg) ? hdg : prev?.heading ?? null,
    target: prev?.target ?? null,
    footprint: prev?.footprint ?? null,
  };
  return { ...base, ...sensorPart(page, base) };
}

function sensorPart(page: Partial<FlightData>, prev: AircraftFix): Pick<AircraftFix, 'target' | 'footprint'> {
  const target = getLastValueOrNull(page.target ?? []);
  const ring = getLastValueOrNull(page.footprint ?? []);
  const footprint = Array.isArray(ring) ? (ring as unknown[]).filter(isLatLon) : null;
  return {
    target: isLatLon(target) ? target : prev.target,
    footprint: footprint && footprint.length >= 3 ? footprint : prev.footprint,
  };
}

export interface Vector {
  distanceM: number;
  /** True bearing from the phone. */
  bearingDeg: number;
  /** Turn relative to where the phone camera points; null without a phone heading. */
  relativeDeg: number | null;
}

export interface GroundAir {
  /** null = the aircraft has no footprint yet (no sensor metadata, or no fix). */
  inFrame: boolean | null;
  target: Vector | null;
  aircraft: Vector | null;
  /** Seconds since the aircraft's newest point; null without a fix. */
  ageS: number | null;
  stale: boolean;
}

export const EMPTY_GROUND_AIR: GroundAir = { inFrame: null, target: null, aircraft: null, ageS: null, stale: false };

/** Where the aircraft and its camera are relative to the phone. Pure; called on every tick. */
export function computeGroundAir(me: LatLon | null, phoneHeading: number | null, fix: AircraftFix | null, nowMs: number = Date.now()): GroundAir {
  if (!fix) return EMPTY_GROUND_AIR;
  const ageS = Math.max(0, nowMs / 1000 - fix.utc);
  const stale = ageS > AIRCRAFT_STALE_S;
  if (!me) return { inFrame: null, target: null, aircraft: null, ageS, stale };
  const vec = (to: LatLon | null): Vector | null => {
    if (!to) return null;
    const b = bearingDeg(me, to);
    return { distanceM: distanceM(me, to), bearingDeg: b, relativeDeg: phoneHeading == null ? null : relativeBearingDeg(b, phoneHeading) };
  };
  return {
    inFrame: fix.footprint ? pointInRing(me, fix.footprint) : null,
    target: vec(fix.target),
    aircraft: vec(fix.loc),
    ageS,
    stale,
  };
}
