import { api } from '@/common/api/client';

/** Player-feature endpoints (mirrors the web repo's per-feature API usage). */

export interface TimeMapEntryApi {
  video_start: number;
  video_end: number;
  utc_start: number;
  utc_end: number;
}

export interface Clipmark {
  id: number;
  type: string | null;
  text: string | null;
  description?: string | null;
  time_start: number | null; // epoch float
  time_end: number | null; // epoch float
}

export interface EventVideo {
  id: number;
  event_id: number;
  title: string;
  description: string;
  duration: number | null;
  start: number | null; // epoch float
  end: number | null; // epoch float
  is_primary: boolean;
  program_type: string | null;
  status: string;
  live_stream_state: null | 'live' | 'processing' | 'recording_ready';
  live_stream_id?: number;
  live_start?: number | null;
  hls_stream_url: string | null;
  mp4_url: string | null;
  stream_url: string | null;
  thumbnail_url: string | null;
  time_mapping: TimeMapEntryApi[] | null;
  clipmarks: Clipmark[];
  tail: string | null;
  has_audio: boolean;
  has_video: boolean;
}

export interface EventPayload {
  events: Array<{
    id: number;
    tags: unknown[];
    videos: EventVideo[];
  }>;
}

export function getEvent(eventId: number | string) {
  return api<EventPayload>(`/api/v1/events/${eventId}.json`);
}

export interface FlightData {
  loc: Array<[number, [number, number]]>; // [utc, [lat, lon]]
  target: Array<[number, [number, number]]>;
  footprint: Array<[number, Array<[number, number]>]>; // [utc, ring of [lat,lon]]
  acft_hdg: Array<[number, number]>;
  graphs?: unknown;
  first_flight_point_utc: number | null;
  last_flight_point_utc: number | null;
}

export function getFlightData(videoId: number, after?: number) {
  const q = after !== undefined ? `?after=${after}` : '';
  return api<{ flight_data: FlightData }>(`/api/v1/videos/${videoId}/flight_data.json${q}`);
}

/** 5s heartbeat; returns the live-state signal used for live<->VOD transitions. */
export function postViewing(videoId: number, paused: boolean) {
  return api<{ liveStreamState: string | null; loggedIn: boolean }>(
    `/api/v1/videos/${videoId}/viewing`,
    { method: 'POST', body: { paused } },
  );
}
