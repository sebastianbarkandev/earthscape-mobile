import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  getEvent,
  getVideoPermissions,
  type Clipmark,
  type EventPayload,
  type EventTag,
  type EventVideo,
  type FlightData,
  type ShareToken,
  type VideoPermissions,
} from './api';
import type { DashboardLayout } from './videoCapabilities';
import {
  createShareToken,
  downloadVideo,
  fetchTranscript,
  startTranscription,
  suggestDeletion,
  takeScreenshot,
  updateDrawnObject,
  updateEventInfo,
  updateTail,
} from './eventThunks';
import type { TranscriptWord } from './api';
import { initialTimelineState, timelineReducers, type TimelineState } from './timeline/timelineReducers';
import { createClipmark, deleteClipmark, updateClipmark } from './clipmarkThunks';

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

export type MapType = 'standard' | 'hybrid' | 'satellite';
/** Web event.map.center: 'none' | platform type (aircraft) | 'fov'. */
export type MapFollow = 'none' | 'vehicle' | 'fov';

export interface PlayerState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  eventId: number | null;
  eventTags: EventTag[];
  customFieldValues: Record<string, unknown> | null;
  videos: EventVideo[];
  activeVideoId: number | null;
  permissions: VideoPermissions | null;
  /** Permissions on the event's PRIMARY video — what "Add my camera" is gated on (SEC-017); equals `permissions` when the active video is the primary. */
  primaryPermissions: VideoPermissions | null;
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
  /** Web dashboardLayout — the user's choice; lock rules applied by effectiveLayout(). */
  layout: DashboardLayout;
  /** Web event.toggles + LayersControl overlay checkboxes. */
  toggles: {
    overlays: boolean; // map chrome (follow control, layers button)
    mapDrawings: boolean;
    vehiclePath: boolean;
    targetPath: boolean;
    heatmap: boolean;
  };
  mapType: MapType;
  mapFollow: MapFollow;
  /** Web setFocusCoordinates — one-shot pan request from a card/drawn object. */
  focusCoordinates: { lat: number; lon: number; nonce: number } | null;
  playback: { paused: boolean; rate: number; muted: boolean };
  /** One-shot seek command consumed by PlayerVideo ({videoTime, nonce}). */
  seek: { videoTime: number; nonce: number } | null;
  /** Long-running action feedback for the action row. */
  op: { busy: 'screenshot' | 'download' | 'update' | 'delete' | 'share' | null; error: string | null; notice: string | null };
  shareTokens: ShareToken[];
  timeline: TimelineState;
  clipmarkOp: { busyId: number | null; op: 'create' | 'update' | 'delete' | 'clip' | 'download' | null; error: string | null };
  /** Web event.transcript: polled every 3s while status is loading/processing/queued. */
  transcript: { status: string | null; text: string | null; words: TranscriptWord[]; loading: boolean };
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
  eventTags: [],
  customFieldValues: null,
  videos: [],
  activeVideoId: null,
  permissions: null,
  primaryPermissions: null,
  timeMappers: {},
  clipmarks: [],
  time: { currentVideo: null, currentUtc: null, start: null, end: null, duration: null },
  mapData: emptyMap,
  isLive: false,
  layout: 'split',
  toggles: { overlays: true, mapDrawings: true, vehiclePath: true, targetPath: true, heatmap: false },
  mapType: 'hybrid',
  mapFollow: 'none',
  focusCoordinates: null,
  playback: { paused: false, rate: 1, muted: false },
  seek: null,
  op: { busy: null, error: null, notice: null },
  shareTokens: [],
  timeline: initialTimelineState,
  clipmarkOp: { busyId: null, op: null, error: null },
  transcript: { status: null, text: null, words: [], loading: false },
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

/** Web filterClipmarks strips 'activate_marker' system rows. */
export function filterClipmarks(clipmarks: Clipmark[] | null | undefined): Clipmark[] {
  return (clipmarks ?? []).filter((c) => c?.the_json?.data?.name !== 'activate_marker');
}

interface LoadEventResult {
  event: EventPayload['events'][number];
  video: EventVideo;
  permissions: VideoPermissions | null;
  /** Omitted (tests / older callers) = same as `permissions`. */
  primaryPermissions?: VideoPermissions | null;
}

export const loadEvent = createAsyncThunk<LoadEventResult, { eventId: number | string; videoIdHint?: number }>(
  'player/loadEvent',
  async (args) => {
    const payload = await getEvent(args.eventId);
    const event = payload.events[0];
    if (!event) throw new Error('Event not found');
    // Video selection mirrors the web: URL hint -> primary -> first.
    const video =
      event.videos.find((v) => v.id === args.videoIdHint) ??
      event.videos.find((v) => v.is_primary) ??
      event.videos[0];
    // Per-video permissions (web VideoPage: GET /videos/{id}/event_id). Non-fatal.
    const permissions = await getVideoPermissions(video.id)
      .then((r) => r.permissions)
      .catch(() => null);
    // "Add my camera" is about the PRIMARY (the backend joins phones to it), which may not be
    // the video being played — fetch ITS permissions in that case, one extra call (SEC-017).
    const primary = event.videos.find((v) => v.is_primary) ?? null;
    const primaryPermissions =
      !primary || primary.id === video.id
        ? permissions
        : await getVideoPermissions(primary.id)
            .then((r) => r.permissions)
            .catch(() => null);
    return { event, video, permissions, primaryPermissions };
  },
);

/**
 * NON-destructive re-read of the event (same GET as loadEvent) for the live case:
 * programs join/end mid-stream, the heartbeat reports a live<->VOD flip, or
 * flight_data 403s mid-transition. The reducer merges `videos[]` by id and
 * refreshes the active video's state/mappers WITHOUT touching status, mapData,
 * time or timeline — the native player keeps running and the source only swaps
 * when the active video's URL actually changes (useVideoPlayer keys on it).
 */
export const refreshEvent = createAsyncThunk<
  { event: EventPayload['events'][number] },
  { eventId: number | string }
>('player/refreshEvent', async (args) => {
  const payload = await getEvent(args.eventId);
  const event = payload.events[0];
  if (!event) throw new Error('Event not found');
  return { event };
});

/**
 * Multi-program tile tap. Permissions are PER VIDEO (ACL orgs grant per uploader /
 * per program), so a swap must re-read them: `setActiveVideo` clears `permissions`
 * (the UI fails closed) and this thunk fills them back in for the video the viewer
 * actually landed on. `primaryPermissions` is deliberately left alone — it gates
 * "Add my camera" on the PRIMARY (SEC-017) and never changes with the tile.
 */
export const selectProgram = createAsyncThunk<
  { videoId: number; permissions: VideoPermissions | null },
  number,
  { state: { player: PlayerState } }
>('player/selectProgram', async (videoId, { dispatch, getState }) => {
  if (getState().player.activeVideoId !== videoId) dispatch(setActiveVideo(videoId));
  const permissions = await getVideoPermissions(videoId)
    .then((r) => r.permissions)
    .catch(() => null);
  return { videoId, permissions };
});

/**
 * Union of the server's clipmark rows for the active video with local rows the GET
 * raced. Ids come from a monotonic DB sequence, so a local row whose id is higher
 * than everything the server returned is one we just created (keep it); an older
 * local row missing from the response was deleted server-side (drop it).
 * Returns `existing` UNCHANGED (same reference) when nothing meaningful moved, so the
 * 20 s live refresh does not re-render the timeline canvas every cycle.
 */
export function mergeClipmarks(existing: Clipmark[], incoming: Clipmark[]): Clipmark[] {
  const maxIncomingId = incoming.reduce((m, c) => Math.max(m, c.id), 0);
  const ids = new Set(incoming.map((c) => c.id));
  // An empty payload is authoritative (there is nothing for a local row to be newer than).
  const localOnly = incoming.length ? existing.filter((c) => !ids.has(c.id) && c.id > maxIncomingId) : [];
  const merged = [...incoming, ...localOnly];
  const same =
    merged.length === existing.length &&
    merged.every((c, i) => {
      const e = existing[i];
      return (
        e != null &&
        e.id === c.id &&
        e.type === c.type &&
        e.text === c.text &&
        e.time_start === c.time_start &&
        e.time_end === c.time_end
      );
    });
  return same ? existing : merged;
}

/**
 * Pure merge used by refreshEvent.fulfilled: existing order is kept, changed
 * videos are replaced, programs that joined are appended, programs that vanished
 * are dropped unless they are the active one (the player must not lose its source).
 */
export function mergeEventVideos(existing: EventVideo[], incoming: EventVideo[], activeVideoId: number | null): EventVideo[] {
  const byId = new Map(incoming.map((v) => [v.id, v]));
  const merged: EventVideo[] = [];
  existing.forEach((v) => {
    const next = byId.get(v.id);
    if (next) {
      merged.push(next);
      byId.delete(v.id);
    } else if (v.id === activeVideoId) {
      merged.push(v);
    }
  });
  byId.forEach((v) => merged.push(v));
  return merged;
}

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
      state.seek = { videoTime: payload, nonce: (state.seek?.nonce ?? 0) + 1 };
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
    setLayout(state, { payload }: PayloadAction<DashboardLayout>) {
      state.layout = payload;
    },
    toggleMapOption(state, { payload }: PayloadAction<keyof PlayerState['toggles']>) {
      state.toggles[payload] = !state.toggles[payload];
    },
    setMapType(state, { payload }: PayloadAction<MapType>) {
      state.mapType = payload;
    },
    setMapFollow(state, { payload }: PayloadAction<MapFollow>) {
      state.mapFollow = payload;
    },
    setFocusCoordinates(state, { payload }: PayloadAction<{ lat: number; lon: number } | null>) {
      state.focusCoordinates = payload
        ? { ...payload, nonce: (state.focusCoordinates?.nonce ?? 0) + 1 }
        : null;
    },
    setPaused(state, { payload }: PayloadAction<boolean>) {
      state.playback.paused = payload;
    },
    setPlaybackRate(state, { payload }: PayloadAction<number>) {
      state.playback.rate = payload;
    },
    setMuted(state, { payload }: PayloadAction<boolean>) {
      state.playback.muted = payload;
    },
    clearOpFeedback(state) {
      state.op.error = null;
      state.op.notice = null;
    },
    /** Local clipmark list maintenance (thunks land here in Phase B). */
    upsertClipmark(state, { payload }: PayloadAction<Clipmark>) {
      const i = state.clipmarks.findIndex((c) => c.id === payload.id);
      if (i >= 0) state.clipmarks[i] = payload;
      else state.clipmarks.push(payload);
    },
    removeClipmarkLocal(state, { payload }: PayloadAction<number>) {
      state.clipmarks = state.clipmarks.filter((c) => c.id !== payload);
    },
    clearClipmarkError(state) {
      state.clipmarkOp.error = null;
    },
    /** Multi-program: make another video of the same event the primary player (web: swap in the Streams tab). */
    setActiveVideo(state, { payload }: PayloadAction<number>) {
      const video = state.videos.find((v) => v.id === payload);
      if (!video || state.activeVideoId === payload) return;
      state.activeVideoId = video.id;
      // Permissions are per video: until selectProgram re-reads them for THIS program the UI
      // must fail closed (LIVE-017) rather than offer edits granted on the previous one.
      state.permissions = null;
      state.clipmarks = filterClipmarks(video.clipmarks);
      state.isLive = video.live_stream_state === 'live';
      const start = video.start ?? 0;
      const end = video.live_stream_state === 'live' ? video.end ?? start : start + (video.duration ?? 0);
      state.time = { currentVideo: 0, currentUtc: start, start, end, duration: video.duration ?? null };
      // flight_data is fetched per video (useFlightData re-runs on the id change): drop the old
      // series here, otherwise appendFlightData would concat two programs' tracks (graphSlice mirrors this).
      state.mapData = emptyMap;
      state.seek = null;
      state.timeline = { ...initialTimelineState, tool: state.timeline.tool, sensorVisibility: state.timeline.sensorVisibility };
    },
    ...timelineReducers,
  },
  extraReducers: (b) => {
    b.addCase(loadEvent.pending, (s) => {
      s.status = 'loading';
      s.error = null;
      s.mapData = emptyMap;
    });
    b.addCase(loadEvent.fulfilled, (s, { payload }) => {
      const { event, video, permissions, primaryPermissions } = payload;
      s.status = 'ready';
      s.eventId = event.id;
      s.eventTags = event.tags ?? [];
      s.customFieldValues = event.custom_field_values ?? null;
      s.videos = event.videos;
      s.activeVideoId = video.id;
      s.permissions = permissions;
      s.primaryPermissions = primaryPermissions === undefined ? permissions : primaryPermissions;
      s.clipmarks = filterClipmarks(video.clipmarks);
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
      s.timeline = { ...initialTimelineState, tool: s.timeline.tool, sensorVisibility: s.timeline.sensorVisibility };
      s.transcript = initialState.transcript;
    });
    b.addCase(refreshEvent.fulfilled, (s, { payload }) => {
      const { event } = payload;
      // Stale response after navigating to another event (or before the first load): ignore.
      if (s.status !== 'ready' || s.eventId !== event.id) return;
      s.eventTags = event.tags ?? s.eventTags;
      s.customFieldValues = event.custom_field_values ?? s.customFieldValues;
      s.videos = mergeEventVideos(s.videos, event.videos, s.activeVideoId);
      event.videos.forEach((v) => {
        s.timeMappers[v.id] = toMapperSpec(v);
      });
      const active = s.videos.find((v) => v.id === s.activeVideoId);
      if (!active) return;
      // Clipmarks created elsewhere (timepoints, TAK chat) arrive with this payload — without the
      // merge an open live player never sees them (LIVE-018). Timeline/player state is untouched.
      s.clipmarks = mergeClipmarks(s.clipmarks, filterClipmarks(active.clipmarks));
      const nowLive = active.live_stream_state === 'live';
      const duration = active.duration ?? null;
      if (nowLive !== s.isLive || duration !== s.time.duration) {
        // live -> processing/recording_ready (or back): the range changes, the playhead does not.
        s.isLive = nowLive;
        const start = active.start ?? s.time.start ?? 0;
        s.time.start = start;
        s.time.end = nowLive ? active.end ?? start : start + (active.duration ?? 0);
        s.time.duration = duration;
      }
    });

    b.addCase(selectProgram.fulfilled, (s, { payload }) => {
      // Another tile was tapped while this request was in flight: its own result decides.
      if (s.activeVideoId !== payload.videoId) return;
      s.permissions = payload.permissions;
    });

    // ── transcript + drawn objects (Phase C) ──
    b.addCase(fetchTranscript.pending, (s) => {
      s.transcript.loading = true;
    });
    b.addCase(fetchTranscript.fulfilled, (s, { payload }) => {
      s.transcript.loading = false;
      s.transcript.status = payload.status ?? null;
      s.transcript.text = payload.transcript?.text ?? null;
      s.transcript.words = Array.isArray(payload.transcript?.words) ? payload.transcript!.words! : [];
    });
    b.addCase(fetchTranscript.rejected, (s) => {
      s.transcript.loading = false;
    });
    b.addCase(startTranscription.fulfilled, (s, { payload }) => {
      s.transcript.status = payload === 'success' ? 'processing' : payload;
    });
    b.addCase(startTranscription.rejected, (s, a) => {
      s.op.error = a.payload ?? 'Could not start transcription.';
    });
    b.addCase(updateDrawnObject.fulfilled, (s, { payload }) => {
      const v = s.videos.find((x) => x.id === s.activeVideoId);
      if (!v?.drawn_objects) return;
      const i = v.drawn_objects.findIndex((d) => d.id === payload.id);
      if (i >= 0) v.drawn_objects[i] = { ...v.drawn_objects[i], ...payload };
    });
    b.addCase(updateDrawnObject.rejected, (s, a) => {
      s.op.error = a.payload ?? 'Could not update the drawing.';
    });

    // ── clipmarks (Phase B thunks) ──
    b.addCase(createClipmark.pending, (s) => {
      s.clipmarkOp = { busyId: null, op: 'create', error: null };
    });
    b.addCase(createClipmark.fulfilled, (s, { payload }) => {
      s.clipmarkOp.op = null;
      if (!s.clipmarks.some((c) => c.id === payload.id)) s.clipmarks.push(payload);
      s.timeline.activeClipmarkId = payload.id;
    });
    b.addCase(createClipmark.rejected, (s, a) => {
      s.clipmarkOp = { busyId: null, op: null, error: a.payload ?? 'Could not create the event.' };
    });
    b.addCase(updateClipmark.pending, (s, a) => {
      s.clipmarkOp = { busyId: a.meta.arg.id, op: 'update', error: null };
    });
    b.addCase(updateClipmark.fulfilled, (s, { payload }) => {
      s.clipmarkOp = { busyId: null, op: null, error: null };
      const i = s.clipmarks.findIndex((c) => c.id === payload.id);
      if (i >= 0) s.clipmarks[i] = { ...s.clipmarks[i], ...payload };
    });
    b.addCase(updateClipmark.rejected, (s, a) => {
      s.clipmarkOp = { busyId: null, op: null, error: a.payload ?? 'Could not save the event.' };
    });
    b.addCase(deleteClipmark.pending, (s, a) => {
      s.clipmarkOp = { busyId: a.meta.arg, op: 'delete', error: null };
    });
    b.addCase(deleteClipmark.fulfilled, (s, { payload }) => {
      s.clipmarkOp = { busyId: null, op: null, error: null };
      s.clipmarks = s.clipmarks.filter((c) => c.id !== payload);
      if (s.timeline.activeClipmarkId === payload) s.timeline.activeClipmarkId = null;
    });
    b.addCase(deleteClipmark.rejected, (s, a) => {
      s.clipmarkOp = { busyId: null, op: null, error: a.payload ?? 'Could not delete the event.' };
    });
    b.addCase(loadEvent.rejected, (s, a) => {
      s.status = 'error';
      s.error = a.error.message ?? 'Failed to load video.';
    });

    // ── event/video info edits ──
    b.addCase(updateEventInfo.pending, (s) => {
      s.op.busy = 'update';
      s.op.error = null;
    });
    b.addCase(updateEventInfo.fulfilled, (s, { payload }) => {
      s.op.busy = null;
      s.eventTags = payload.tags;
      payload.videos.forEach((pv) => {
        const v = s.videos.find((x) => x.id === pv.id);
        if (v) {
          v.title = pv.title;
          v.description = pv.description;
        }
      });
    });
    b.addCase(updateEventInfo.rejected, (s, a) => {
      s.op.busy = null;
      s.op.error = a.payload ?? 'Could not save changes.';
    });
    b.addCase(updateTail.fulfilled, (s, { payload }) => {
      const v = s.videos.find((x) => x.id === payload.videoId);
      if (v) v.tail = payload.tail;
    });
    b.addCase(updateTail.rejected, (s, a) => {
      s.op.error = a.payload ?? 'Could not save vehicle.';
    });

    b.addCase(suggestDeletion.pending, (s) => {
      s.op.busy = 'delete';
    });
    b.addCase(suggestDeletion.fulfilled, (s) => {
      s.op.busy = null;
      s.op.notice = 'Deletion suggested. An administrator will review it.';
    });
    b.addCase(suggestDeletion.rejected, (s, a) => {
      s.op.busy = null;
      s.op.error = a.payload ?? 'Could not suggest deletion.';
    });

    b.addCase(takeScreenshot.pending, (s) => {
      s.op.busy = 'screenshot';
      s.op.error = null;
    });
    b.addCase(takeScreenshot.fulfilled, (s) => {
      s.op.busy = null;
      s.op.notice = 'Screenshot saved to Photos.';
    });
    b.addCase(takeScreenshot.rejected, (s, a) => {
      s.op.busy = null;
      s.op.error = a.payload ?? 'Screenshot failed.';
    });

    b.addCase(downloadVideo.pending, (s) => {
      s.op.busy = 'download';
      s.op.error = null;
    });
    b.addCase(downloadVideo.fulfilled, (s) => {
      s.op.busy = null;
    });
    b.addCase(downloadVideo.rejected, (s, a) => {
      s.op.busy = null;
      s.op.error = a.payload ?? 'Download failed.';
    });

    b.addCase(createShareToken.pending, (s) => {
      s.op.busy = 'share';
      s.op.error = null;
    });
    b.addCase(createShareToken.fulfilled, (s, { payload }) => {
      s.op.busy = null;
      s.shareTokens.unshift(payload);
    });
    b.addCase(createShareToken.rejected, (s, a) => {
      s.op.busy = null;
      s.op.error = a.payload ?? 'Could not create a share link.';
    });
  },
});

export const {
  resetPlayer,
  setCurrentTime,
  requestSeek,
  appendFlightData,
  setLiveState,
  setLayout,
  toggleMapOption,
  setMapType,
  setMapFollow,
  setFocusCoordinates,
  setPaused,
  setPlaybackRate,
  setMuted,
  clearOpFeedback,
  upsertClipmark,
  removeClipmarkLocal,
  clearClipmarkError,
  setActiveVideo,
  setZoom,
  panWindow,
  resetZoom,
  clipIn,
  cancelClipIn,
  beginClipDrag,
  endClipDrag,
  setActiveClipmark,
  toggleClipmarksVisible,
  toggleSensor,
  setTimelineTool,
} = playerSlice.actions;

export const selectActiveVideo = (s: { player: PlayerState }) =>
  s.player.videos.find((v) => v.id === s.player.activeVideoId) ?? null;

/** The event's primary program (multi-program events: joining phones are non-primary). */
export const selectPrimaryVideo = (s: { player: PlayerState }) =>
  s.player.videos.find((v) => v.is_primary) ?? null;

/** True while ANY program of the event is live — drives the periodic non-destructive refresh. */
export const selectAnyLive = (s: { player: PlayerState }) =>
  s.player.videos.some((v) => v.live_stream_state === 'live');

export default playerSlice.reducer;
