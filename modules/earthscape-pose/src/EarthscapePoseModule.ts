import { Platform } from 'react-native';
import { EventEmitter, requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  CameraFieldOfView,
  CameraPosition,
  EarthscapePoseEvents,
  PoseErrorEvent,
  PoseSample,
  PoseStartOptions,
} from './EarthscapePose.types';

/** Native surface (Swift, iOS only). */
interface NativeEarthscapePose {
  isSupported: boolean;
  setCamera(position: CameraPosition): void;
  getFieldOfView(position?: CameraPosition): CameraFieldOfView | null;
  start(options: PoseStartOptions): Promise<void>;
  stop(): Promise<void>;
  addListener?(eventName: string): void;
  removeListeners?(count: number): void;
}

function loadNative(): NativeEarthscapePose | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return requireNativeModule<NativeEarthscapePose>('EarthscapePose');
  } catch {
    return null; // Expo Go, a binary built before the module, the Simulator without CoreMotion
  }
}

const native = loadNative();

export const EarthscapePose = {
  /** False on Android / Expo Go / the Simulator / a binary without the module. */
  isSupported: !!native?.isSupported,
  setCamera: (position: CameraPosition): void => native?.setCamera(position),
  getFieldOfView: (position: CameraPosition = 'back'): CameraFieldOfView | null =>
    native?.getFieldOfView(position) ?? null,
  start: (options: PoseStartOptions = {}): Promise<void> =>
    native?.isSupported ? native.start(options) : Promise.resolve(),
  stop: (): Promise<void> => (native ? native.stop() : Promise.resolve()),
};

const emitter = native ? new EventEmitter<EarthscapePoseEvents>(native as never) : null;

export function isPoseError(event: PoseSample | PoseErrorEvent): event is PoseErrorEvent {
  return typeof (event as PoseErrorEvent).error === 'string';
}

export function addPoseListener(listener: EarthscapePoseEvents['onPose']): EventSubscription {
  if (!emitter) return { remove: () => undefined } as EventSubscription;
  return emitter.addListener('onPose', listener as never);
}
