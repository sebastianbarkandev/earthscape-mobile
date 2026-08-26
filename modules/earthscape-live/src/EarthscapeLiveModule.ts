import { Platform } from 'react-native';
import { EventEmitter, requireNativeModule, type EventSubscription } from 'expo-modules-core';
import type {
  EarthscapeLiveEvents,
  PermissionStatus,
  PreviewOptions,
  PublishOptions,
  PublisherState,
  PublisherStats,
} from './EarthscapeLive.types';

/** Native surface (Swift). Only iOS is implemented; Android gets an honest stub below. */
interface NativeEarthscapeLive {
  isSupported: boolean;
  getState(): PublisherState;
  requestPermissions(): Promise<PermissionStatus>;
  getPermissions(): Promise<PermissionStatus>;
  startPreview(options: PreviewOptions): Promise<void>;
  stopPreview(): Promise<void>;
  startPublish(options: PublishOptions): Promise<void>;
  stopPublish(): Promise<void>;
  setVideoBitrate(kbps: number): Promise<void>;
  setMaxVideoBitrate(kbps: number): Promise<void>;
  switchCamera(): Promise<'back' | 'front'>;
  setTorch(enabled: boolean): Promise<void>;
  setMuted(muted: boolean): Promise<void>;
  setOrientation(orientation: 'landscape' | 'portrait' | 'auto'): Promise<void>;
  getStats(): Promise<PublisherStats | null>;
  addListener?(eventName: string): void;
  removeListeners?(count: number): void;
}

function loadNative(): NativeEarthscapeLive | null {
  if (Platform.OS !== 'ios') return null;
  try {
    return requireNativeModule<NativeEarthscapeLive>('EarthscapeLive');
  } catch {
    return null; // e.g. running in a build that predates the module (Expo Go, stale binary)
  }
}

const native = loadNative();
const unsupported = (): never => {
  throw new Error(
    Platform.OS === 'ios'
      ? 'EarthscapeLive native module is not in this build — run `npx expo prebuild -p ios && npx expo run:ios`.'
      : 'Live publishing from this device is not supported yet (iOS only).',
  );
};

export const EarthscapeLive = {
  /** False on Android / Expo Go / a binary built without the module. */
  isSupported: !!native?.isSupported,
  getState: (): PublisherState => native?.getState() ?? 'idle',
  requestPermissions: (): Promise<PermissionStatus> => (native ? native.requestPermissions() : unsupported()),
  getPermissions: (): Promise<PermissionStatus> => (native ? native.getPermissions() : unsupported()),
  startPreview: (options: PreviewOptions = {}) => (native ? native.startPreview(options) : unsupported()),
  stopPreview: () => (native ? native.stopPreview() : Promise.resolve()),
  startPublish: (options: PublishOptions) => (native ? native.startPublish(options) : unsupported()),
  stopPublish: () => (native ? native.stopPublish() : Promise.resolve()),
  setVideoBitrate: (kbps: number) => (native ? native.setVideoBitrate(kbps) : unsupported()),
  setMaxVideoBitrate: (kbps: number) => (native ? native.setMaxVideoBitrate(kbps) : unsupported()),
  switchCamera: () => (native ? native.switchCamera() : unsupported()),
  setTorch: (enabled: boolean) => (native ? native.setTorch(enabled) : unsupported()),
  setMuted: (muted: boolean) => (native ? native.setMuted(muted) : unsupported()),
  setOrientation: (o: 'landscape' | 'portrait' | 'auto') => (native ? native.setOrientation(o) : unsupported()),
  getStats: (): Promise<PublisherStats | null> => (native ? native.getStats() : Promise.resolve(null)),
};

const emitter = native ? new EventEmitter<EarthscapeLiveEvents>(native as never) : null;

export function addLiveListener<K extends keyof EarthscapeLiveEvents>(
  event: K,
  listener: EarthscapeLiveEvents[K],
): EventSubscription {
  if (!emitter) return { remove: () => undefined } as EventSubscription;
  return emitter.addListener(event, listener as never);
}
