import { api } from '@/common/api/client';
import type { GraphData } from '@/common/lib/mergeGraphData';

/**
 * Player-feature endpoints (mirrors the web repo's per-feature API usage).
 * Every shape below was traced to the Flask source; see CLAUDE.md "API contracts".
 */

export interface TimeMapEntryApi {
  video_start: number;
  video_end: number;
  utc_start: number;
  utc_end: number;
}

/** User.as_dict() — note first/last name (no `name`/`avatar_url`; the web reads those by mistake). */
export interface ApiUser {
  id: number;
  email?: string;
  username?: string;
  first_name?: string | null;
  last_name?: string | null;
  profile_img_url?: string | null;
}

/** Clipmark.as_dict(). time_* are epoch seconds. */
export interface Clipmark {
  id: number;
  video_id?: number;
  type: string | null; // 'timepoint' | 'clip' | 'coordinates' | 'tak' | 'tak_chat' | 'plate' | ...
  text: string | null;
  description?: string | null;
  time_start: number | null;
  time_end: number | null;
  video_position?: number | null; // seconds into the video (present on ingest-generated marks)
  latitude?: number | null;
  longitude?: number | null;
  thumbnail_url?: string | null;
  the_geom?: unknown;
  the_json?: {
    stream?: string;
    pts?: number;
    data?: {
      command?: string;
      name?: string;
      markerCat?: string;
      layer?: string;
      label?: string;
      notes?: string;
      kind?: string;
      sender?: string;
      chatroom?: string;
      message?: string;
      [k: string]: unknown;
    };
    [k: string]: unknown;
  } | null;
  user?: ApiUser | null;
}

/** DrawnObject.as_dict(). */
export interface DrawnObject {
  id: number;
  video_id: number;
  text: string | null;
  color: string | null;
  time: number | null;
  the_geom: { type: string; coordinates: unknown } | null;
  user: ApiUser | null;
}

export interface EventTag {
  id?: number;
  tag: { id: number; title?: string; slug?: string; [k: string]: unknown } | null;
  value: string;
}

export interface EventVideo {
  id: number;
  event_id: number;
  title: string;
  description: string;
  duration: number | null;
  start: number | null; // epoch float
  end: number | null; // epoch float
  date_posted?: string | null; // epoch SECONDS as a string (strftime('%s'))
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
  thumbnails_vtt_url?: string | null;
  subtitles_vtt_url?: string | null;
  download_url?: string | null;
  uploaded_filesize?: number | null;
  time_mapping: TimeMapEntryApi[] | null;
  clipmarks: Clipmark[];
  drawn_objects?: DrawnObject[];
  tail: string | null;
  has_audio: boolean;
  has_video: boolean;
  has_map?: boolean;
  audio_enabled?: boolean | null;
  transcript?: unknown;
  user?: ApiUser | null;
  platform?: { type: string; data: Partial<FlightData> | null } | null;
}

export interface EventPayload {
  events: Array<{
    id: number;
    tags: EventTag[];
    custom_field_values: Record<string, unknown> | null;
    videos: EventVideo[];
  }>;
}

export function getEvent(eventId: number | string) {
  // Route params are validated in app/video/[eventId].tsx; encoding here is defence in depth.
  return api<EventPayload>(`/api/v1/events/${encodeURIComponent(String(eventId))}.json`);
}

/** GET /api/v1/videos/{id}/event_id (video_shell_config_api) — per-video permissions. */
export interface VideoPermissions {
  videos: {
    update: boolean;
    delete: boolean;
    download: boolean;
    share: boolean;
    suggest_deletion: boolean;
    draw: boolean;
  };
  tags: { create: boolean; delete: boolean };
}
export function getVideoPermissions(videoId: number) {
  return api<{ event_id: number; video_id: number; permissions: VideoPermissions }>(
    `/api/v1/videos/${videoId}/event_id`,
  );
}

export interface FlightData {
  loc: Array<[number, [number, number]]>; // [utc, [lat, lon]]
  target: Array<[number, [number, number]]>;
  footprint: Array<[number, Array<[number, number]>]>; // [utc, ring of [lat,lon]]
  acft_hdg: Array<[number, number]>;
  graphs?: GraphData | null; // {category: {name: [[utc, value], ...]}}
  first_flight_point_utc: number | null;
  last_flight_point_utc: number | null;
}

/** `own` = the requested video's own points (a phone program's GPS + camera footprint) instead of the event primary's. */
export function getFlightData(videoId: number, after?: number, own = false) {
  const params: string[] = [];
  if (own) params.push('own=1');
  if (after !== undefined) params.push(`after=${after}`);
  const q = params.length ? `?${params.join('&')}` : '';
  return api<{ flight_data: FlightData }>(`/api/v1/videos/${videoId}/flight_data.json${q}`);
}

/** 5s heartbeat; returns the live-state signal used for live<->VOD transitions. */
export function postViewing(videoId: number, paused: boolean) {
  return api<{ liveStreamState: string | null; loggedIn: boolean }>(
    `/api/v1/videos/${videoId}/viewing`,
    { method: 'POST', body: { paused } },
  );
}

// ── Event / video info (web PlayerActionRow + PlayerDescription) ───────────────

/**
 * PUT /api/v1/events/{id} — EventSchema requires `tags` (many) and
 * `videos[].title` (min 1) + `videos[].description`; unknown keys are EXCLUDEd.
 * The web always sends the whole event (there is no per-video PATCH).
 */
export interface EventUpdateBody {
  tags: EventTag[];
  videos: Array<{ id?: number; title: string; description: string }>;
  custom_field_values?: Record<string, unknown> | null;
}
export function putEvent(eventId: number, body: EventUpdateBody) {
  return api<{ id: number; tags: EventTag[]; videos: Array<{ id: number; title: string; description: string }> }>(
    `/api/v1/events/${eventId}`,
    { method: 'PUT', body },
  );
}

export function postSuggestDelete(videoId: number, reason: string) {
  return api<unknown>(`/api/v1/videos/${videoId}/suggest_delete`, { method: 'POST', body: { reason } });
}

/** POST /api/v1/videos/{id}/screenshot {video_time} — image is rendered async by Celery. */
export interface ScreenshotResponse {
  links: Array<{ self: string }>;
  data: Array<
    | { type: 'videos'; video_id: number; utc: number | null; video_position: number }
    | { type: 'images'; url: string; filename: string }
  >;
}
export function postScreenshot(videoId: number, videoTime: number) {
  return api<ScreenshotResponse>(`/api/v1/videos/${videoId}/screenshot`, {
    method: 'POST',
    body: { video_time: videoTime },
  });
}

export function getTails() {
  return api<{ tails: string[] }>('/api/v1/videos/tails');
}
export function postTail(videoId: number, tail: string | null) {
  return api<{ tail: string | null }>(`/api/v1/videos/${videoId}/tail`, { method: 'POST', body: { tail } });
}

/** POST /api/v1/events/{id}/make_public → {share_token:{token, expires_at, can_download, ...}} */
export interface ShareToken {
  token: string;
  expires_at?: number | string | null;
  can_download?: boolean;
  shared_with?: string | null;
  [k: string]: unknown;
}
export function postMakePublic(
  eventId: number,
  body: { expires_at: number | null; can_download: boolean; shared_with: string },
) {
  return api<{ share_token: ShareToken }>(`/api/v1/events/${eventId}/make_public`, { method: 'POST', body });
}

// ── Clipmarks (web eventSlice addClipmark/updateClipmark/removeClipmark/clipClipmark/...) ──

export interface ClipmarkCreateBody {
  event_id: number;
  time_start: number;
  time_end: number | null; // key must be present (backend subscripts it)
  type: 'clip' | 'timepoint';
  text: string;
}
export function postClipmark(videoId: number, body: ClipmarkCreateBody) {
  return api<Clipmark>(`/api/v1/videos/${videoId}/clipmarks`, { method: 'POST', body });
}
export function postClipmarkUpdate(
  videoId: number,
  clipmarkId: number,
  body: { event_id: number; time_start?: number | null; time_end?: number | null; text?: string; description?: string; type?: string },
) {
  return api<Clipmark>(`/api/v1/videos/${videoId}/clipmarks/${clipmarkId}`, { method: 'POST', body });
}
export function deleteClipmarkApi(videoId: number, clipmarkId: number) {
  return api<unknown>(`/api/v1/videos/${videoId}/clipmarks/${clipmarkId}`, { method: 'DELETE' });
}
/** Server-side render of a clip into a NEW Video (Celery chain); returns the new video dict. */
export function postClipToVideo(videoId: number, clipmarkId: number, body: { title: string; description: string }) {
  return api<{ video: { id: number; [k: string]: unknown } }>(`/api/v1/videos/${videoId}/clipmarks/${clipmarkId}/clip`, {
    method: 'POST',
    body,
  });
}
export function getClipFormats(videoId: number, clipmarkId: number) {
  return api<{ formats: string[] }>(`/api/v1/videos/${videoId}/clipmarks/${clipmarkId}/formats`);
}
/** Download URL; readiness is signalled by header `X-Status: File ready for download` (web polls). */
export function clipDownloadUrl(host: string, videoId: number, clipmarkId: number, format: string) {
  return `${host}/api/v1/videos/${videoId}/clipmarks/${clipmarkId}/download?format=${encodeURIComponent(format)}&${Date.now()}`;
}

// ── Side panel / info card (web PlayerSidePanel, PlayerDescription) ─────────────

export interface TranscriptWord {
  word: string;
  start: number;
  end: number;
}
export interface TranscriptStatus {
  status: string; // not_started | queued | loading | processing | complete | failed ...
  video_id: number;
  transcript: { text?: string; words?: TranscriptWord[] } | null;
}
export function getTranscriptStatus(videoId: number) {
  return api<TranscriptStatus>(`/api/v1/transcription/status/${videoId}`);
}
export function postStartTranscription(videoId: number) {
  return api<{ status: string; message?: string }>('/api/v1/transcription/start', { method: 'POST', body: { video_id: videoId } });
}

export interface TagDef {
  id: number;
  title: string;
  slug: string;
  [k: string]: unknown;
}
/** 404 when the org has TAGS_ENABLED off — callers treat that as "no tags". */
export function getTags() {
  return api<TagDef[]>('/api/v1/tags/');
}
export function postCreateTag(body: { title: string; slug: string; value?: string; eventId?: number }) {
  return api<{ message: string; tag: TagDef }>('/api/v1/tags/create', { method: 'POST', body });
}

export function postDrawnObjectUpdate(videoId: number, drawnObjectId: number, body: { text?: string; color: string }) {
  return api<DrawnObject>(`/api/v1/videos/${videoId}/drawn_objects/${drawnObjectId}`, { method: 'POST', body });
}

export function getUsers() {
  return api<Array<{ id: number; username: string; name: string }>>('/api/v1/users/');
}
