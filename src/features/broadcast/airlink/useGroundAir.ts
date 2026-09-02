import { useEffect, useMemo, useState } from 'react';
import { poseSource, POSE_MAX_AGE_MS, type PoseStatus } from '../pose/poseSource';
import { computeGroundAir, type AircraftFix, type GroundAir } from './groundAir';
import type { PhoneFix } from './usePhonePosition';

/** Recompute cadence for the age/stale readout when nothing else changes. */
const CLOCK_MS = 1000;

export interface GroundAirState extends GroundAir {
  /** Where the phone camera points (true heading), null when no sensor answers. */
  phoneHeading: number | null;
  needsCalibration: boolean;
}

/**
 * Ground↔air relationship for the overlay: holds the pose sensors while mounted (shared with
 * telemetry through `poseSource.acquire`), and folds the phone position, the camera heading and
 * the aircraft's latest fix into distances/bearings/in-frame, once a second and on every input.
 */
export function useGroundAir(me: PhoneFix | null, aircraft: AircraftFix | null, enabled = true): GroundAirState {
  const [pose, setPose] = useState<PoseStatus>(poseSource.status);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return;
    const release = poseSource.acquire();
    const unsubscribe = poseSource.subscribe(setPose);
    setPose(poseSource.status);
    const t = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => {
      clearInterval(t);
      unsubscribe();
      release();
    };
  }, [enabled]);

  return useMemo(() => {
    const fresh = pose.sample && now - pose.updatedAt <= POSE_MAX_AGE_MS + CLOCK_MS;
    const phoneHeading = fresh && pose.sample && Number.isFinite(pose.sample.heading) ? pose.sample.heading : null;
    const ga = enabled ? computeGroundAir(me?.loc ?? null, phoneHeading, aircraft, now) : computeGroundAir(null, null, null, now);
    return { ...ga, phoneHeading, needsCalibration: !!fresh && pose.needsCalibration };
  }, [enabled, me, aircraft, pose, now]);
}
