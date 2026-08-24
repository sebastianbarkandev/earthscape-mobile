import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { getEvent, type EventVideo, type FlightData, type Clipmark } from './api';

/**
 * Slim mobile counterpart of the web's eventSlice (see reference/eventSlice.js
 * for the domain map — its logic is web-bound; only shapes were carried over).
 *
 * TimeMapper functions are NOT stored here (web pattern: keep the plain spec
 * {startUtc, videoTimeUtcTimeMap} in state, re-create the mapper at use sites).
 */

export interface TimeMapperSpec {
  startUtc: number;
  videoTimeUtcTimeMap:
    | Array<{ videoStart: number; videoEnd: number; utcStart: number; utcEnd: number }>
    | null;
}

interface MapData {
  loc: FlightData['loc'];
  target: FlightData['target'];
  footprint: FlightData['footprint'];
  acft_hdg: FlightData['acft_hdg'];
  firstUtc: number | null;
  lastUtc: number | null;
}

interface PlayerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  eventId: number | null;
  videos: EventVideo[];
  activeVideoId: number | null;
  timeMappers: Record<number, TimeMapperSpec>;
  clipmarks: Clipmark[];
  time: {
    currentVideo: number | null;
    currentUtc: number | null;
    start: number | null;
    end: number | null;
    duration: number | null;
  };
  mapData: MapData;
  isLive: boolean;
  /** One-shot seek command consumed by PlayerVideo ({videoTime, ts}). */
  seek: { videoTime: number; ts: number } | null;
}

const emptyMap: MapData = {
  loc: [],
  target: [],
  footprint: [],
  acft_hdg: [],
  firstUtc: null,
  lastUtc: null,
};

const initialState: PlayerState = {
  status: 'idle',
  error: null,
  eventId: null,
  videos: [],
  activeVideoId: null,
  timeMappers: {},
  clipmarks: [],
  time: { currentVideo: null, currentUtc: null, start: null, end: null, duration: null },
  mapData: emptyMap,
  isLive: false,
  seek: null,
};

/** snake_case API entries -> TimeMapper's camelCase (same conversion as web loadEvent). */
function toMapperSpec(video: EventVideo): TimeMapperSpec {
  return {
    startUtc: video.start ?? 0,
    videoTimeUtcTimeMap: video.time_mapping
      ? video.time_mapping.map((e) => ({
          videoStart: e.video_start,
          videoEnd: e.video_end,
          utcStart: e.utc_start,
          utcEnd: e.utc_end,
        }))
      : null,
  };
}

export const loadEvent = createAsyncThunk(
  'player/loadEvent',
  async (args: { eventId: number | string; videoIdHint?: number }) => {
    const payload = await getEvent(args.eventId);
    const event = payload.events[0];
    if (!event) throw new Error('Event not found');
    // Video selection mirrors the web: URL hint -> primary -> first.
    const video =
      event.videos.find((v) => v.id === args.videoIdHint) ??
      event.videos.find((v) => v.is_primary) ??
      event.videos[0];
    return { event, video };
  },
);

const playerSlice = createSlice({
  name: 'player',
  initialState,
  reducers: {
    resetPlayer: () => initialState,
    setCurrentTime(
      state,
      { payload }: PayloadAction<{ video: number | null; utc: number | null }>,
    ) {
      state.time.currentVideo = payload.video;
      state.time.currentUtc = payload.utc;
    },
    requestSeek(state, { payload }: PayloadAction<number>) {
      state.seek = { videoTime: payload, ts: Date.now() };
    },
    /** fetchMoreFlightPoints merge — concat pattern lifted from the web slice. */
    appendFlightData(state, { payload }: PayloadAction<FlightData>) {
      const d = state.mapData;
      if (payload.loc) d.loc = d.loc.concat(payload.loc);
      if (payload.target) d.target = d.target.concat(payload.target);
      if (payload.footprint) d.footprint = d.footprint.concat(payload.footprint);
      if (payload.acft_hdg) d.acft_hdg = d.acft_hdg.concat(payload.acft_hdg);
      d.firstUtc = d.firstUtc ?? payload.first_flight_point_utc;
      d.lastUtc = payload.last_flight_point_utc ?? d.lastUtc;
    },
    setLiveState(state, { payload }: PayloadAction<boolean>) {
      state.isLive = payload;
    },
  },
  extraReducers: (b) => {
    b.addCase(loadEvent.pending, (s) => {
      s.status = 'loading';
      s.error = null;
      s.mapData = emptyMap;
    });
    b.addCase(loadEvent.fulfilled, (s, { payload }) => {
      const { event, video } = payload;
      s.status = 'ready';
      s.eventId = event.id;
      s.videos = event.videos;
      s.activeVideoId = video.id;
      s.clipmarks = video.clipmarks ?? [];
      s.isLive = video.live_stream_state === 'live';
      event.videos.forEach((v) => {
        s.timeMappers[v.id] = toMapperSpec(v);
      });
      const start = video.start ?? 0;
      const end =
        video.live_stream_state === 'live'
          ? video.end ?? start
          : start + (video.duration ?? 0);
      s.time = {
        currentVideo: 0,
        currentUtc: start,
        start,
        end,
        duration: video.duration ?? null,
      };
    });
    b.addCase(loadEvent.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'Failed to load video.';
    });
  },
});

export const { resetPlayer, setCurrentTime, requestSeek, appendFlightData, setLiveState } =
  playerSlice.actions;

export const selectActiveVideo = (s: { player: PlayerState }) =>
  s.player.videos.find((v) => v.id === s.player.activeVideoId) ?? null;

export default playerSlice.reducer;
