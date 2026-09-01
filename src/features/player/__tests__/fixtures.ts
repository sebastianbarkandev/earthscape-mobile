import { configureStore } from '@reduxjs/toolkit';
import authReducer from '@/features/auth/authSlice';
import libraryReducer from '@/features/library/librarySlice';
import broadcastReducer from '@/features/broadcast/broadcastSlice';
import playerReducer from '@/features/player/playerSlice';
import graphReducer from '@/features/player/graphSlice';
import type { EventPayload, EventVideo, VideoPermissions } from '../api';

/**
 * Shared fixtures for the player render tests (react-test-renderer + a fresh store).
 * Shapes follow the API contracts in CLAUDE.md (events/{id}.json videoDict).
 */

export const START_UTC = 1_700_000_000;

export const primaryVideo: EventVideo = {
  id: 6,
  event_id: 1,
  title: 'falls_1.ts',
  description: '<p>Aerial survey</p>',
  duration: 300,
  start: START_UTC,
  end: START_UTC + 300,
  is_primary: true,
  program_type: null,
  status: 'ready',
  live_stream_state: null,
  hls_stream_url: 'https://cdn.example.com/6/index.m3u8',
  mp4_url: null,
  stream_url: null,
  thumbnail_url: 'https://cdn.example.com/6/thumb.jpg',
  download_url: null,
  time_mapping: null,
  clipmarks: [],
  tail: 'N123AB',
  has_audio: true,
  has_video: true,
  has_map: true,
  user: { id: 1, first_name: 'Pat', last_name: 'Pilot' },
};

export const secondaryVideo = (id: number, extra: Partial<EventVideo> = {}): EventVideo => ({
  ...primaryVideo,
  id,
  is_primary: false,
  program_type: `Phone ${id}`,
  hls_stream_url: `https://cdn.example.com/${id}/index.m3u8`,
  thumbnail_url: `https://cdn.example.com/${id}/thumb.jpg`,
  ...extra,
});

export const eventPayload = (videos: EventVideo[] = [primaryVideo, secondaryVideo(7)]): EventPayload => ({
  events: [{ id: 1, tags: [], custom_field_values: null, videos }],
});

export const permissions: VideoPermissions = {
  videos: { update: true, delete: false, download: true, share: true, suggest_deletion: true, draw: false },
  tags: { create: true, delete: true },
};

/** [utc, [lat, lon]] flight path: 1 Hz for `n` seconds heading north-east from Denver. */
export const flightPath = (n = 60, startUtc = START_UTC): Array<[number, [number, number]]> =>
  Array.from({ length: n }, (_, i) => [startUtc + i, [39.5 + i * 0.001, -104.9 + i * 0.001]]);

export function makeStore() {
  return configureStore({
    reducer: { auth: authReducer, library: libraryReducer, player: playerReducer, graph: graphReducer, broadcast: broadcastReducer },
    middleware: (getDefault) => getDefault({ serializableCheck: false, immutableCheck: false }),
  });
}
export type TestStore = ReturnType<typeof makeStore>;

/** Let pending thunks / microtasks settle (no fake timers in these suites). */
export const flush = () => new Promise<void>((res) => setTimeout(res, 0));
