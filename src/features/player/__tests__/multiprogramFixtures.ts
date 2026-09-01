import type { EventPayload, EventVideo, FlightData } from '../api';

/**
 * Shared fixture: one event with an aircraft PRIMARY (VOD recording with a real
 * time_mapping) and three LIVE phone programs that joined via "Add my camera".
 */
export const T0 = 1_700_000_000;

export function makeVideo(over: Partial<EventVideo> & { id: number }): EventVideo {
  return {
    event_id: 7,
    title: `Video ${over.id}`,
    description: '',
    duration: 600,
    start: T0,
    end: T0 + 600,
    is_primary: false,
    program_type: null,
    status: 'ready',
    live_stream_state: null,
    hls_stream_url: `https://cdn.example/${over.id}/index.m3u8`,
    mp4_url: null,
    stream_url: null,
    thumbnail_url: `/static/thumbs/${over.id}.jpg`,
    time_mapping: null,
    clipmarks: [],
    tail: null,
    has_audio: true,
    has_video: true,
    ...over,
  };
}

export const primary = makeVideo({
  id: 100,
  title: 'Flight 12',
  is_primary: true,
  time_mapping: [{ video_start: 0, video_end: 600, utc_start: T0, utc_end: T0 + 600 }],
  clipmarks: [{ id: 1, type: 'timepoint', text: 'primary mark', time_start: T0 + 10, time_end: null }],
});

export const livePhone = (id: number, label: string): EventVideo =>
  makeVideo({
    id,
    title: `Flight 12 (${label})`,
    program_type: label,
    status: 'live',
    live_stream_state: 'live',
    live_stream_id: id * 10,
    duration: null,
    end: null,
    hls_stream_url: `/live/${id * 10}/playlist.m3u8`,
    clipmarks: [{ id: id, type: 'tak_chat', text: `chat ${id}`, time_start: T0 + id, time_end: null }],
  });

export const s1 = livePhone(201, 'Mobile · Ana');
export const s2 = livePhone(202, 'Mobile · Ben');
export const s3 = livePhone(203, 'Mobile · Cy');
export const s4 = livePhone(204, 'Mobile · Dee');

export function eventPayload(videos: EventVideo[]): EventPayload['events'][number] {
  return { id: 7, tags: [], custom_field_values: null, videos };
}

export function flightData(fromUtc: number, n: number): FlightData {
  const loc = Array.from({ length: n }, (_, i) => [fromUtc + i, [39 + i * 0.001, -104 - i * 0.001]] as [number, [number, number]]);
  return {
    loc,
    target: [],
    footprint: [],
    acft_hdg: loc.map(([u]) => [u, 90] as [number, number]),
    graphs: { Position: { Altitude: loc.map(([u], i) => [u, 1000 + i] as [number, number]) } },
    first_flight_point_utc: fromUtc,
    last_flight_point_utc: fromUtc + n - 1,
  };
}
