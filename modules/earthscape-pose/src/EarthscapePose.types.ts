export type CameraPosition = 'back' | 'front';

/**
 * One camera-pose sample. Conventions match the backend's `app/utils/phone_pose.py`:
 * heading clockwise from true north, pitch positive = looking up, roll positive = the
 * camera's right side dips. `hfov`/`vfov` are the field of view of the PUBLISHED picture
 * (already swapped for landscape) and are absent when the camera format is unknown.
 */
export interface PoseSample {
  heading: number;
  pitch: number;
  roll: number;
  landscape: boolean;
  camera: CameraPosition;
  /** CMMagneticFieldCalibrationAccuracy: -1 uncalibrated, 0 low, 1 medium, 2 high. */
  magneticAccuracy: -1 | 0 | 1 | 2;
  hfov?: number;
  vfov?: number;
  zoom?: number;
  /** Unix ms. */
  timestamp: number;
}

export interface PoseErrorEvent {
  error: string;
  timestamp: number;
}

export interface PoseStartOptions {
  camera?: CameraPosition;
  /** Emit at most one sample per interval (100–2000, default 250). */
  intervalMs?: number;
}

export interface CameraFieldOfView {
  longSideDeg: number;
  shortSideDeg: number;
  zoom: number;
}

export type EarthscapePoseEvents = {
  onPose: (event: PoseSample | PoseErrorEvent) => void;
};
