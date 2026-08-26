import { createAsyncThunk } from '@reduxjs/toolkit';
import { getApiHost } from '@/common/config';
import { downloadToCache, mimeForExtension, removeFile, shareFile } from '@/common/media';
import {
  clipDownloadUrl,
  deleteClipmarkApi,
  getClipFormats,
  postClipmark,
  postClipmarkUpdate,
  postClipToVideo,
  type Clipmark,
} from './api';
import type { PlayerState } from './playerSlice';

type S = { player: PlayerState };
const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

function ctx(state: S) {
  const { eventId, activeVideoId } = state.player;
  if (!eventId || !activeVideoId) throw new Error('No video loaded');
  return { eventId, videoId: activeVideoId };
}

/** Web addClipmark: Mark (timepoint), Clip out, drag-create. Always sends an explicit type + time_end key. */
export const createClipmark = createAsyncThunk<
  Clipmark,
  { time_start: number; time_end: number | null; type: 'clip' | 'timepoint'; text?: string },
  { state: S; rejectValue: string }
>('player/createClipmark', async (args, { getState, rejectWithValue }) => {
  try {
    const { eventId, videoId } = ctx(getState());
    return await postClipmark(videoId, {
      event_id: eventId,
      time_start: args.time_start,
      time_end: args.time_end,
      type: args.type,
      text: args.text ?? (args.type === 'clip' ? 'New Clip' : 'New Timepoint'),
    });
  } catch (e) {
    return rejectWithValue(msg(e));
  }
});

export const updateClipmark = createAsyncThunk<
  Clipmark,
  { id: number; time_start?: number | null; time_end?: number | null; text?: string; description?: string },
  { state: S; rejectValue: string }
>('player/updateClipmark', async ({ id, ...patch }, { getState, rejectWithValue }) => {
  try {
    const { eventId, videoId } = ctx(getState());
    const res = await postClipmarkUpdate(videoId, id, { event_id: eventId, ...patch });
    return { ...res, id: res?.id ?? id };
  } catch (e) {
    return rejectWithValue(msg(e));
  }
});

export const deleteClipmark = createAsyncThunk<number, number, { state: S; rejectValue: string }>(
  'player/deleteClipmark',
  async (id, { getState, rejectWithValue }) => {
    try {
      const { videoId } = ctx(getState());
      await deleteClipmarkApi(videoId, id);
      return id;
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

/** Web clipClipmark guards + POST …/clip → new video id (the web then navigates to its settings page). */
export const clipToVideo = createAsyncThunk<
  number,
  { id: number; title: string; description: string },
  { state: S; rejectValue: string }
>('player/clipToVideo', async ({ id, title, description }, { getState, rejectWithValue }) => {
  try {
    const state = getState();
    const { videoId } = ctx(state);
    const c = state.player.clipmarks.find((x) => x.id === id);
    if (!c || c.time_start == null || c.time_end == null) return rejectWithValue('Only clips with a start and end can become videos.');
    const dur = c.time_end - c.time_start;
    if (state.player.time.duration != null && dur > state.player.time.duration) return rejectWithValue('Clip is longer than the video.');
    if (dur < 0.005) return rejectWithValue('Clip is too short.');
    const res = await postClipToVideo(videoId, id, { title, description });
    return res.video.id;
  } catch (e) {
    return rejectWithValue(msg(e));
  }
});

export const fetchClipFormats = createAsyncThunk<{ id: number; formats: string[] }, number, { state: S; rejectValue: string }>(
  'player/fetchClipFormats',
  async (id, { getState, rejectWithValue }) => {
    try {
      const { videoId } = ctx(getState());
      const res = await getClipFormats(videoId, id);
      return { id, formats: res.formats ?? [] };
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const CLIP_STILL_PROCESSING = 'Clip is still being processed. Please wait a few moments and try again.';

/**
 * Web downloadClipmark: fetch; ready iff header X-Status === 'File ready for download';
 * else 3 retries 2s apart; then the share sheet (the web clicks an <a download>).
 */
export const downloadClipmark = createAsyncThunk<
  { uri: string },
  { id: number; format: string },
  { state: S; rejectValue: string }
>('player/downloadClipmark', async ({ id, format }, { getState, rejectWithValue }) => {
  const { videoId } = ctx(getState());
  const attempt = async () => {
    const url = clipDownloadUrl(getApiHost(), videoId, id, format);
    const res = await downloadToCache(url, `clip_${videoId}_${id}.${format}`);
    const status = res.headers['X-Status'] ?? res.headers['x-status'];
    if (res.status === 200 && status === 'File ready for download') return res.uri;
    await removeFile(res.uri);
    return null;
  };
  try {
    let uri = await attempt();
    for (let i = 0; !uri && i < 3; i++) {
      await sleep(2000);
      uri = await attempt();
    }
    if (!uri) return rejectWithValue(CLIP_STILL_PROCESSING);
    const { mimeType, UTI } = mimeForExtension(format);
    await shareFile(uri, mimeType, UTI);
    return { uri };
  } catch (e) {
    return rejectWithValue(msg(e));
  }
});
