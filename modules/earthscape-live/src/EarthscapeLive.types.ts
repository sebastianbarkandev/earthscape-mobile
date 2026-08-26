/**
 * Public TypeScript API of the native Earthscape live publisher module.
 * Mirrors ios/EarthscapeLiveModule.swift — keep the two in sync.
 */

export type PublisherState =
  | 'idle' // engine created, no camera session
  | 'preview' // camera + mic running, not publishing
  | 'connecting' // SRT handshake in progress
  | 'publishing' // media flowing to the server
  | 'reconnecting' // link lost; retrying with backoff
  | 'stopping';

export type CameraPosition = 'back' | 'front';
export type CaptureOrientation = 'landscape' | 'portrait' | 'auto';

export interface VideoPreset {
  /** Encoded frame size (landscape orientation; swapped automatically for portrait). */
  width: number;
  height: number;
  fps: number;
  /** Starting video bitrate in kbps. */
  bitrateKbps: number;
  /** ABR ceiling in kbps (adaptive bitrate never exceeds this). */
  maxBitrateKbps: number;
  /** ABR floor in kbps. */
  minBitrateKbps: number;
}

export interface PreviewOptions {
  camera?: CameraPosition;
  orientation?: CaptureOrientation;
  preset?: Partial<VideoPreset>;
  /** Mirror the front camera preview (default true). */
  mirrorFront?: boolean;
}

export interface PublishOptions {
  /** Full SRT URL from the backend: srt://host:port?mode=caller&passphrase=…&pbkeylen=16&latency=… */
  url: string;
  preset?: Partial<VideoPreset>;
  /** Audio bitrate in kbps (default 96). */
  audioBitrateKbps?: number;
  /** Keyframe interval in seconds (default 2 — matches the OBS guidance for this backend). */
  keyframeIntervalSec?: number;
  /** Enable the native adaptive-bitrate controller (default true). */
  adaptiveBitrate?: boolean;
  /** Auto-reconnect with exponential backoff when the link drops (default true). */
  autoReconnect?: boolean;
  /** Give up after this many consecutive failed reconnects (default 0 = never). */
  maxReconnectAttempts?: number;
}

export interface PublisherStats {
  /** Seconds since the first successful connect of this publish session. */
  elapsedSec: number;
  /** Current encoder target bitrate (kbps). */
  videoBitrateKbps: number;
  /** Measured SRT send rate over the last interval (kbps). */
  sendRateKbps: number;
  /** Smoothed round-trip time (ms). */
  rttMs: number;
  /** Packets retransmitted during the last interval. */
  retransmitted: number;
  /** Packets dropped as too-late-to-send during the last interval. */
  dropped: number;
  /** Sender-side loss during the last interval. */
  lost: number;
  /** Send buffer occupancy in ms (how far behind the link is). */
  sendBufferMs: number;
  /** libsrt's bandwidth estimate (kbps). */
  bandwidthKbps: number;
  /** 0..1 congestion estimate produced by the ABR controller. */
  congestion: number;
  /** Total bytes sent this session. */
  bytesSentTotal: number;
  /** ABR tier label (e.g. "1200 kbps"). */
  tier: string;
  /** iOS thermal state: nominal | fair | serious | critical */
  thermalState: string;
}

export interface StateChangeEvent {
  state: PublisherState;
  previous: PublisherState;
  /** Human-readable reason (e.g. "connection lost", "background", "user"). */
  reason?: string;
  /** Reconnect attempt number when state === 'reconnecting'. */
  attempt?: number;
  /** Milliseconds until the next reconnect attempt. */
  nextRetryMs?: number;
}

export interface PublisherErrorEvent {
  code: string;
  message: string;
  fatal: boolean;
}

export interface NetworkPathEvent {
  status: 'satisfied' | 'unsatisfied' | 'requiresConnection';
  interface: 'wifi' | 'cellular' | 'wired' | 'other' | 'none';
  expensive: boolean;
  constrained: boolean;
}

export interface PermissionStatus {
  camera: 'granted' | 'denied' | 'undetermined';
  microphone: 'granted' | 'denied' | 'undetermined';
}

export type EarthscapeLiveEvents = {
  onStateChange(event: StateChangeEvent): void;
  onStats(event: PublisherStats): void;
  onError(event: PublisherErrorEvent): void;
  onNetworkPath(event: NetworkPathEvent): void;
};

/** Sensible defaults for a phone on cellular: 720p30, 2.5 Mbps start, 0.5–4 Mbps ABR window. */
export const DEFAULT_PRESET: VideoPreset = {
  width: 1280,
  height: 720,
  fps: 30,
  bitrateKbps: 2500,
  maxBitrateKbps: 4000,
  minBitrateKbps: 500,
};

export const PRESETS: Record<'auto' | '1080p' | '720p' | '480p', VideoPreset> = {
  auto: DEFAULT_PRESET,
  '1080p': { width: 1920, height: 1080, fps: 30, bitrateKbps: 4500, maxBitrateKbps: 6000, minBitrateKbps: 800 },
  '720p': DEFAULT_PRESET,
  '480p': { width: 854, height: 480, fps: 30, bitrateKbps: 1200, maxBitrateKbps: 1800, minBitrateKbps: 300 },
};
