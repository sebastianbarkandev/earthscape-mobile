import * as Location from 'expo-location';
import { EarthscapePose, addPoseListener, isPoseError, type CameraPosition, type PoseSample } from '../../../../modules/earthscape-pose';
import type { TelemetryFix } from '../api';

/**
 * Where the camera points, for the telemetry fixes. The native module (CoreMotion +
 * AVFoundation) gives heading/pitch/roll + field of view; when it is missing (Android,
 * Simulator, old binary) the compass alone gives a heading, and the server projects a
 * level wedge from it. The latest sample is pulled by `withPose` at each GPS fix, so the
 * publisher's 1 Hz telemetry cadence is unchanged — the pose just rides along.
 *
 * Module-level singleton on purpose: the Go Live screen tells it which camera is active
 * (`setCamera`) and `useBroadcast` reads it, without either knowing about the other's hooks.
 */
export type PoseSource = 'motion' | 'compass' | 'none';

export interface PoseStatus {
  source: PoseSource;
  sample: PoseSample | null;
  /** Unix ms of the last sample, 0 when none yet. */
  updatedAt: number;
  /** Compass needs a figure-8 (CoreMotion magneticAccuracy -1/0). */
  needsCalibration: boolean;
}

/** A sample older than this is not trusted — the phone may have been pocketed. */
export const POSE_MAX_AGE_MS = 3000;
/** Default camera height above ground for a handheld phone (m). */
export const CAMERA_HEIGHT_M = 1.5;
/** Compass fallback: assume a portrait iPhone wide camera when the module cannot tell. */
export const FALLBACK_HFOV_DEG = 42;
export const FALLBACK_VFOV_DEG = 69;

type Listener = (status: PoseStatus) => void;

let status: PoseStatus = { source: 'none', sample: null, updatedAt: 0, needsCalibration: false };
let camera: CameraPosition = 'back';
let running = false;
/** Telemetry (`start`/`stop`) and UI readers (`acquire`) share the sensors: the last one out stops them. */
let telemetryWants = false;
let holds = 0;
let nativeSub: { remove(): void } | null = null;
let compassSub: { remove(): void } | null = null;
const listeners = new Set<Listener>();

function publish(next: PoseStatus) {
  status = next;
  listeners.forEach((l) => l(status));
}

async function stopSensors(): Promise<void> {
  running = false;
  nativeSub?.remove();
  nativeSub = null;
  compassSub?.remove();
  compassSub = null;
  if (EarthscapePose.isSupported) await EarthscapePose.stop().catch(() => undefined);
  publish({ source: 'none', sample: null, updatedAt: 0, needsCalibration: false });
}

export const poseSource = {
  get status(): PoseStatus {
    return status;
  },
  get camera(): CameraPosition {
    return camera;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Which camera is publishing — decides the field of view and the look direction (front looks at the user). */
  setCamera(position: CameraPosition): void {
    camera = position;
    if (running && EarthscapePose.isSupported) EarthscapePose.setCamera(position);
  },
  /** Telemetry owner: keep the sensors running until `stop()`. */
  async start(): Promise<PoseSource> {
    telemetryWants = true;
    return startSensors();
  },
  /**
   * A UI reader (the ground↔air overlay) wants headings while it is mounted, whether or not
   * telemetry runs. Returns the release; releasing is idempotent.
   */
  acquire(): () => void {
    holds += 1;
    startSensors().catch(() => undefined);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      holds = Math.max(0, holds - 1);
      if (!telemetryWants && holds === 0) stopSensors().catch(() => undefined);
    };
  },
  async stop(): Promise<void> {
    telemetryWants = false;
    if (holds > 0) return; // an overlay still reads the heading
    await stopSensors();
  },
  /** Test hook. */
  _reset(): void {
    running = false;
    telemetryWants = false;
    holds = 0;
    nativeSub = null;
    compassSub = null;
    camera = 'back';
    listeners.clear();
    status = { source: 'none', sample: null, updatedAt: 0, needsCalibration: false };
  },
};

async function startSensors(): Promise<PoseSource> {
  if (running) return status.source;
  running = true;
  if (EarthscapePose.isSupported) {
    nativeSub = addPoseListener((event) => {
      if (!running) return;
      if (isPoseError(event)) return;
      publish({
        source: 'motion',
        sample: event,
        updatedAt: event.timestamp,
        needsCalibration: event.magneticAccuracy <= 0,
      });
    });
    try {
      await EarthscapePose.start({ camera, intervalMs: 250 });
      publish({ ...status, source: 'motion' });
      return 'motion';
    } catch {
      nativeSub.remove();
      nativeSub = null;
    }
  }
  // Compass only: CoreLocation tilt-compensates, so with the phone held up in portrait the
  // heading is the direction the back camera faces. No pitch/roll — the server keeps them 0.
  try {
    compassSub = await Location.watchHeadingAsync((h) => {
      if (!running) return;
      const heading = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!(heading >= 0)) return;
      publish({
        source: 'compass',
        sample: {
          heading,
          pitch: 0,
          roll: 0,
          landscape: false,
          camera,
          // expo: 0 none, 1 low, 2 medium, 3 high -> CoreMotion's -1..2
          magneticAccuracy: h.accuracy <= 0 ? -1 : h.accuracy === 1 ? 0 : h.accuracy === 2 ? 1 : 2,
          hfov: FALLBACK_HFOV_DEG,
          vfov: FALLBACK_VFOV_DEG,
          timestamp: Date.now(),
        },
        updatedAt: Date.now(),
        needsCalibration: h.accuracy <= 0,
      });
    });
    publish({ ...status, source: 'compass' });
    return 'compass';
  } catch {
    running = false;
    publish({ source: 'none', sample: null, updatedAt: 0, needsCalibration: false });
    return 'none';
  }
}

/**
 * Attach the camera pose to a GPS fix. The camera heading replaces the GPS course (a
 * standing officer has no course; the camera always has a heading). A stale or missing
 * sample leaves the fix as it was, so the server sees a plain GPS point.
 */
export function withPose(fix: TelemetryFix, pose: PoseStatus, now: number = Date.now()): TelemetryFix {
  const sample = pose.sample;
  if (!sample || now - pose.updatedAt > POSE_MAX_AGE_MS) return fix;
  if (!Number.isFinite(sample.heading)) return fix;
  const out: TelemetryFix = { ...fix, heading: sample.heading };
  if (pose.source === 'motion') {
    if (Number.isFinite(sample.pitch)) out.pitch = round1(sample.pitch);
    if (Number.isFinite(sample.roll)) out.roll = round1(sample.roll);
  }
  if (sample.hfov != null && Number.isFinite(sample.hfov)) {
    out.hfov = round1(sample.hfov);
    if (sample.vfov != null && Number.isFinite(sample.vfov)) out.vfov = round1(sample.vfov);
    out.camera_height_m = CAMERA_HEIGHT_M;
  }
  out.heading = round1(out.heading as number);
  return out;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
