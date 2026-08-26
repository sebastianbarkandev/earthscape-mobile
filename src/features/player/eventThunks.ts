import { createAsyncThunk } from '@reduxjs/toolkit';
import { resolveMediaUrl } from '@/common/config';
import {
  downloadToCache,
  extensionOf,
  mimeForExtension,
  removeFile,
  saveToPhotos,
  shareFile,
  waitForUrl,
} from '@/common/media';
import {
  postMakePublic,
  postScreenshot,
  postSuggestDelete,
  postTail,
  putEvent,
  type EventTag,
  type EventVideo,
  type ShareToken,
} from './api';

/** Minimal view of the store these thunks need (avoids importing the store type — cycle). */
interface PlayerStateView {
  player: {
    eventId: number | null;
    videos: EventVideo[];
    activeVideoId: number | null;
    eventTags: EventTag[];
    customFieldValues: Record<string, unknown> | null;
    time: { currentVideo: number | null };
  };
}

function requireEvent(state: PlayerStateView) {
  const { eventId, videos, activeVideoId } = state.player;
  const video = videos.find((v) => v.id === activeVideoId) ?? null;
  if (!eventId || !video) throw new Error('No video loaded');
  return { eventId, video };
}

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

/**
 * Web updateEventInfo: PUT the WHOLE event (tags + every video's title/description).
 * Pass overrides for the active video only; everything else is echoed from state.
 */
export const updateEventInfo = createAsyncThunk<
  { tags: EventTag[]; videos: Array<{ id: number; title: string; description: string }> },
  { title?: string; description?: string; tags?: EventTag[] },
  { state: PlayerStateView; rejectValue: string }
>('player/updateEventInfo', async (patch, { getState, rejectWithValue }) => {
  try {
    const state = getState();
    const { eventId, video } = requireEvent(state);
    const tags = patch.tags ?? state.player.eventTags;
    const videos = state.player.videos.map((v) => ({
      id: v.id,
      title: v.id === video.id ? (patch.title ?? v.title) : v.title,
      description: v.id === video.id ? (patch.description ?? v.description ?? '') : v.description ?? '',
    }));
    if (!videos.every((v) => v.title.trim().length > 0)) return rejectWithValue('Title cannot be empty.');
    const res = await putEvent(eventId, { tags, videos, custom_field_values: state.player.customFieldValues });
    // The schema dump echoes what was saved; fall back to what we sent.
    return { tags: res?.tags ?? tags, videos: res?.videos ?? videos };
  } catch (e) {
    return rejectWithValue(errorMessage(e));
  }
});

export const updateTail = createAsyncThunk<
  { videoId: number; tail: string | null },
  string | null,
  { state: PlayerStateView; rejectValue: string }
>('player/updateTail', async (tail, { getState, rejectWithValue }) => {
  try {
    const { video } = requireEvent(getState());
    const res = await postTail(video.id, tail && tail.trim() ? tail.trim() : null);
    return { videoId: video.id, tail: res?.tail ?? null };
  } catch (e) {
    return rejectWithValue(errorMessage(e));
  }
});

export const suggestDeletion = createAsyncThunk<void, string, { state: PlayerStateView; rejectValue: string }>(
  'player/suggestDeletion',
  async (reason, { getState, rejectWithValue }) => {
    try {
      const { video } = requireEvent(getState());
      await postSuggestDelete(video.id, reason);
    } catch (e) {
      return rejectWithValue(errorMessage(e));
    }
  },
);

/**
 * Screenshot: the web grabs a DOM canvas; RN uses the server endpoint. The image
 * is produced by a Celery chain and uploaded to S3/static, so poll until it exists,
 * then save it to Photos.
 */
export const takeScreenshot = createAsyncThunk<
  { url: string; filename: string },
  void,
  { state: PlayerStateView; rejectValue: string }
>('player/takeScreenshot', async (_, { getState, rejectWithValue }) => {
  try {
    const state = getState();
    const { video } = requireEvent(state);
    const t = state.player.time.currentVideo ?? 0;
    const res = await postScreenshot(video.id, t);
    const image = res.data.find((d) => d.type === 'images') as { url: string; filename: string } | undefined;
    if (!image?.url) return rejectWithValue('The server did not return a screenshot URL.');
    const url = resolveMediaUrl(image.url) ?? image.url;
    const ready = await waitForUrl(url, 15, 1000);
    if (!ready) return rejectWithValue('Screenshot is still being generated. Try again in a moment.');
    const { uri, status } = await downloadToCache(url, image.filename || `screenshot_${video.id}_${Math.round(t)}.png`);
    if (status >= 400) {
      await removeFile(uri);
      return rejectWithValue(`Screenshot download failed (HTTP ${status}).`);
    }
    await saveToPhotos(uri);
    await removeFile(uri);
    return { url, filename: image.filename };
  } catch (e) {
    return rejectWithValue(errorMessage(e));
  }
});

/** Download: `/download/video/{id}/{key}` 302s to S3 (or serves the file on-premise); then share sheet. */
export const downloadVideo = createAsyncThunk<
  { uri: string },
  { toPhotos?: boolean } | undefined,
  { state: PlayerStateView; rejectValue: string }
>('player/downloadVideo', async (opts, { getState, rejectWithValue }) => {
  try {
    const { video } = requireEvent(getState());
    const url = resolveMediaUrl(video.download_url);
    if (!url) return rejectWithValue('This video has no download URL.');
    const ext = extensionOf(video.download_url ?? '', 'mp4');
    const safeTitle = (video.title || `video_${video.id}`).replace(/[^\w.-]+/g, '_').slice(0, 60);
    const { uri, status } = await downloadToCache(url, `${safeTitle}.${ext}`);
    if (status >= 400) {
      await removeFile(uri);
      return rejectWithValue(`Download failed (HTTP ${status}).`);
    }
    if (opts?.toPhotos) await saveToPhotos(uri);
    else {
      const { mimeType, UTI } = mimeForExtension(ext);
      await shareFile(uri, mimeType, UTI);
    }
    return { uri };
  } catch (e) {
    return rejectWithValue(errorMessage(e));
  }
});

export const createShareToken = createAsyncThunk<
  ShareToken,
  { expiresAt: number | null; canDownload: boolean; sharedWith: string },
  { state: PlayerStateView; rejectValue: string }
>('player/createShareToken', async (args, { getState, rejectWithValue }) => {
  try {
    const { eventId } = requireEvent(getState());
    const res = await postMakePublic(eventId, {
      expires_at: args.expiresAt,
      can_download: args.canDownload,
      shared_with: args.sharedWith,
    });
    return res.share_token;
  } catch (e) {
    return rejectWithValue(errorMessage(e));
  }
});

// ── Transcript (web getTranscriptStatus / startTranscription) ────────────────────
import { getTranscriptStatus, postDrawnObjectUpdate, postStartTranscription, type TranscriptStatus, type DrawnObject } from './api';

export const fetchTranscript = createAsyncThunk<TranscriptStatus, number, { rejectValue: string }>(
  'player/fetchTranscript',
  async (videoId, { rejectWithValue }) => {
    try {
      return await getTranscriptStatus(videoId);
    } catch (e) {
      return rejectWithValue(errorMessage(e));
    }
  },
);

export const startTranscription = createAsyncThunk<string, number, { rejectValue: string }>(
  'player/startTranscription',
  async (videoId, { rejectWithValue }) => {
    try {
      const res = await postStartTranscription(videoId);
      return res.status;
    } catch (e) {
      return rejectWithValue(errorMessage(e));
    }
  },
);

export const updateDrawnObject = createAsyncThunk<
  DrawnObject,
  { id: number; text?: string; color: string },
  { state: PlayerStateView; rejectValue: string }
>('player/updateDrawnObject', async ({ id, text, color }, { getState, rejectWithValue }) => {
  try {
    const { video } = requireEvent(getState());
    return await postDrawnObjectUpdate(video.id, id, { text, color });
  } catch (e) {
    return rejectWithValue(errorMessage(e));
  }
});
