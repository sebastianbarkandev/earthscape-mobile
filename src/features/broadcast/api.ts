import { api } from '@/common/api/client';

/**
 * Mobile live-streaming endpoints (earthscape-mobile backend branch,
 * app/api/live_mobile_api.py). Session-authed; ingest is SRT caller.
 */
export interface SrtIngest {
  protocol: 'srt';
  host: string;
  port: number;
  passphrase: string;
  pbkeylen: number;
  latency_ms: number;
  url: string;
}

export interface MobileStream {
  id: number;
  status: 'starting' | 'started' | 'ending' | 'ended' | string;
  video_id: number | null;
  event_id: number | null;
  is_primary: boolean | null;
  program_type: string | null;
  title: string | null;
  created_at: string | null;
  ended_at: string | null;
  /** True once the live-server has written the first HLS segment (viewers can watch). */
  playlist_ready: boolean;
  playlist_url: string;
  server_latency_ms: number;
  ingest: SrtIngest;
  telemetry_url: string;
}

export interface CreateStreamBody {
  stream_name?: string;
  /** Join an existing LIVE event as an additional program instead of creating a new event. */
  event_id?: number;
  program_type?: string;
  /** SRT latency the phone will use (ms, clamped server-side to 120..4000). */
  latency_ms?: number;
}

export function createMobileStream(body: CreateStreamBody) {
  return api<MobileStream>('/api/v1/live/streams', { method: 'POST', body });
}

/**
 * REG-008: this is the poll the "wait for the SRT listener" gate and the 4 s status loop run on,
 * so a stalled request is what makes Go Live sit on "Ready" with no error. Bounded well under the
 * gate's 20 s budget; a timed-out poll is just "not yet".
 */
const STATUS_POLL_TIMEOUT_MS = 8000;

export function getMobileStream(id: number, latencyMs?: number) {
  const q = latencyMs ? `?latency_ms=${latencyMs}` : '';
  return api<MobileStream>(`/api/v1/live/streams/${id}${q}`, { timeoutMs: STATUS_POLL_TIMEOUT_MS });
}

export function endMobileStream(id: number) {
  return api<{ success: boolean; status: string }>(`/api/v1/live/streams/${id}/end`, { method: 'POST', body: {} });
}

/** A GPS fix as the backend converts it into MISB KLV (Sensor Lat/Lon/Alt, heading, Timestamp GPS). */
export interface TelemetryFix {
  lat: number;
  lon: number;
  alt?: number | null;
  heading?: number | null;
  /** Unix epoch milliseconds of the fix. */
  timestamp_ms: number;
  /** Seconds into the stream (optional; the server derives it from video.start when absent). */
  pts?: number;
  tail?: string;
  /**
   * Camera pose (all optional). With `heading` + `hfov` the server projects the frame onto
   * the ground (app/utils/phone_pose.py) and the phone gets a footprint + target like an
   * aircraft. Degrees; pitch + = up, roll + = right side down.
   */
  pitch?: number;
  roll?: number;
  hfov?: number;
  vfov?: number;
  camera_height_m?: number;
}

export function postTelemetry(id: number, fixes: TelemetryFix[]) {
  return api<{ accepted: number; status: string }>(`/api/v1/live/streams/${id}/telemetry`, { method: 'POST', body: { fixes } });
}
