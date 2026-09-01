import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createMobileStream, endMobileStream, getMobileStream, type CreateStreamBody, type MobileStream } from './api';
import type { NetworkPathEvent, PublisherState, PublisherStats } from '../../../modules/earthscape-live';
import { redactSecrets } from './redact';
import { ApiError } from '@/common/api/client';

/** /end retries before giving up (the live server's 15-min no-data expiry then closes the stream). */
export const END_MAX_ATTEMPTS = 6;

/**
 * One phone-originated live stream ("broadcast"). Phases:
 *   idle → creating (POST /live/streams) → ready (ingest known, camera preview)
 *   → connecting/publishing/reconnecting (native publisher) → ending (POST /end) → ended
 * The native publisher state is mirrored in `publisher`; `stream` is the server view.
 */
export type BroadcastPhase = 'idle' | 'creating' | 'ready' | 'live' | 'ending' | 'ended' | 'error';

export interface BroadcastState {
  phase: BroadcastPhase;
  /** How this broadcast was started: a brand-new event or joining an existing live event. */
  mode: 'new' | 'join' | null;
  stream: MobileStream | null;
  publisher: PublisherState;
  publisherReason: string | null;
  reconnectAttempt: number;
  nextRetryMs: number | null;
  stats: PublisherStats | null;
  network: NetworkPathEvent | null;
  telemetry: { sent: number; pending: number; failures: number; enabled: boolean; lastFixAt: number | null };
  startedAt: number | null; // ms epoch when publishing first succeeded
  error: string | null;
  /**
   * Why the broadcast died, for the whole rest of the screen's life (LIVE-031). A fatal failure is
   * followed immediately by `endBroadcast()` (so no server stream dangles), and BOTH
   * `endBroadcast.pending` and `.fulfilled` clear `error` — the reason would otherwise vanish in the
   * same tick and the user would be shown a bare "Ended". Set only for fatal errors; cleared when a
   * new broadcast starts (`createBroadcast.pending`) or the state is reset. Always redacted.
   */
  fatalReason: string | null;
  lastEvent: string | null;
  /** Failed `POST /end` attempts of the current stream (retried by useBroadcast while phase === 'ending'). */
  endAttempts: number;
}

const initialState: BroadcastState = {
  phase: 'idle',
  mode: null,
  stream: null,
  publisher: 'idle',
  publisherReason: null,
  reconnectAttempt: 0,
  nextRetryMs: null,
  stats: null,
  network: null,
  telemetry: { sent: 0, pending: 0, failures: 0, enabled: true, lastFixAt: null },
  startedAt: null,
  error: null,
  fatalReason: null,
  lastEvent: null,
  endAttempts: 0,
};

/** Human message for a failed call: the server's reason (`{error}` on a 409 join, Flask-Security `{response:{errors}}`) over "HTTP 409". */
export const msg = (e: unknown): string => {
  if (e instanceof ApiError) {
    const b = (e.body && typeof e.body === 'object' ? e.body : null) as { error?: unknown; msg?: unknown; response?: { errors?: unknown[] } } | null;
    const reason = b?.error ?? b?.msg ?? b?.response?.errors?.[0];
    if (typeof reason === 'string' && reason.trim()) return reason;
    return `Request failed (HTTP ${e.status})`;
  }
  return e instanceof Error ? e.message : 'Request failed';
};

export const createBroadcast = createAsyncThunk<MobileStream, CreateStreamBody, { rejectValue: string }>(
  'broadcast/create',
  async (body, { rejectWithValue }) => {
    try {
      return await createMobileStream(body);
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

export const refreshBroadcast = createAsyncThunk<MobileStream, void, { state: { broadcast: BroadcastState }; rejectValue: string }>(
  'broadcast/refresh',
  async (_, { getState, rejectWithValue }) => {
    const id = getState().broadcast.stream?.id;
    if (!id) return rejectWithValue('No stream');
    try {
      return await getMobileStream(id, getState().broadcast.stream?.ingest.latency_ms);
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

export const endBroadcast = createAsyncThunk<string, void, { state: { broadcast: BroadcastState }; rejectValue: string }>(
  'broadcast/end',
  async (_, { getState, rejectWithValue }) => {
    const id = getState().broadcast.stream?.id;
    if (!id) return 'ended';
    try {
      const res = await endMobileStream(id);
      return res.status;
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

const broadcastSlice = createSlice({
  name: 'broadcast',
  initialState,
  reducers: {
    resetBroadcast: () => initialState,
    publisherStateChanged(
      state,
      { payload }: PayloadAction<{ state: PublisherState; reason?: string; attempt?: number; nextRetryMs?: number }>,
    ) {
      state.publisher = payload.state;
      state.publisherReason = payload.reason ?? null;
      state.reconnectAttempt = payload.attempt ?? (payload.state === 'reconnecting' ? state.reconnectAttempt : 0);
      state.nextRetryMs = payload.state === 'reconnecting' ? payload.nextRetryMs ?? null : null;
      if (payload.state === 'publishing') {
        state.phase = 'live';
        if (!state.startedAt) state.startedAt = Date.now();
        state.error = null;
        state.fatalReason = null; // we are demonstrably live again: no stale cause of death
      } else if (payload.state === 'reconnecting' || payload.state === 'connecting') {
        if (state.phase === 'ready' || state.phase === 'live') state.phase = 'live';
      } else if ((payload.state === 'preview' || payload.state === 'idle') && state.phase === 'live') {
        // Publisher stopped underneath us (fatal error / user stop handled elsewhere)
        state.phase = state.stream ? 'ready' : 'idle';
      }
      state.lastEvent = `${payload.state}${payload.reason ? ` (${payload.reason})` : ''}`;
    },
    publisherStats(state, { payload }: PayloadAction<PublisherStats>) {
      state.stats = payload;
    },
    publisherError(state, { payload }: PayloadAction<{ code: string; message: string; fatal: boolean }>) {
      // Native messages may quote the SRT URL — never let the passphrase into display state (SEC-010).
      const message = redactSecrets(payload.message);
      state.lastEvent = `${payload.code}: ${message}`;
      if (payload.fatal) {
        state.error = message;
        // Survives the automatic endBroadcast() that follows a fatal error (LIVE-031).
        state.fatalReason = message;
        state.phase = 'error';
      }
    },
    networkPath(state, { payload }: PayloadAction<NetworkPathEvent>) {
      state.network = payload;
    },
    telemetryProgress(state, { payload }: PayloadAction<Partial<BroadcastState['telemetry']>>) {
      state.telemetry = { ...state.telemetry, ...payload };
    },
    setTelemetryEnabled(state, { payload }: PayloadAction<boolean>) {
      state.telemetry.enabled = payload;
    },
    setBroadcastError(state, { payload }: PayloadAction<string | null>) {
      state.error = payload;
      state.fatalReason = payload;
      if (payload) state.phase = 'error';
    },
    /**
     * Entering the stop sequence BEFORE the native publisher is stopped: the `preview`
     * state it emits must not bounce the phase back to 'ready' (which re-enabled "Go live"
     * mid-stop and allowed a second POST /streams — LIVE-005).
     */
    beginEnding(state) {
      if (state.phase !== 'ended') state.phase = 'ending';
    },
  },
  extraReducers: (b) => {
    b.addCase(createBroadcast.pending, (s, a) => {
      s.phase = 'creating';
      s.mode = a.meta.arg.event_id ? 'join' : 'new';
      s.error = null;
      s.fatalReason = null;
      s.startedAt = null;
      s.stats = null;
      s.endAttempts = 0;
    });
    b.addCase(createBroadcast.fulfilled, (s, { payload }) => {
      s.stream = payload;
      s.phase = 'ready';
    });
    b.addCase(createBroadcast.rejected, (s, a) => {
      s.phase = 'error';
      s.error = a.payload ?? 'Could not create the stream.';
    });
    b.addCase(refreshBroadcast.fulfilled, (s, { payload }) => {
      // A poll still in flight when the screen left (`resetBroadcast`) must not resurrect the
      // stream: the next Go Live would then open on a stale one and take the orphan-end branch
      // (REG-007). Same for an answer about a stream we are no longer on.
      if (!s.stream || s.stream.id !== payload.id) return;
      // `playlist_ready` is sticky: it means "the playlist has been servable", so a transient
      // server-side cache flush (or an EFS read that momentarily finds nothing) can't flip the
      // UI back to "waiting for the first segment" while viewers are watching.
      s.stream = { ...s.stream, ...payload, ingest: s.stream.ingest ?? payload.ingest, playlist_ready: s.stream.playlist_ready || payload.playlist_ready };
      if (payload.status === 'ended' && s.phase !== 'ended') s.phase = 'ended';
      // Our /end landed (or the server ended it) while a retry was pending.
      else if (payload.status === 'ending' && s.phase === 'ending') s.phase = 'ended';
    });
    b.addCase(endBroadcast.pending, (s) => {
      // `error` is the /end retry channel, so it is cleared for this attempt; `fatalReason` is NOT
      // touched here or in .fulfilled — it is what tells the user why the stream stopped (LIVE-031).
      s.phase = 'ending';
      s.error = null;
    });
    b.addCase(endBroadcast.fulfilled, (s, { payload }) => {
      s.phase = 'ended';
      s.error = null;
      s.endAttempts = 0;
      if (s.stream) s.stream = { ...s.stream, status: payload };
    });
    b.addCase(endBroadcast.rejected, (s, a) => {
      // The publisher is already stopped but the server still thinks we are live: stay in
      // 'ending' so useBroadcast retries (backoff / network restored) — viewers would otherwise
      // keep a frozen LIVE tile for 15 minutes. Give up after END_MAX_ATTEMPTS (LIVE-015).
      s.endAttempts += 1;
      s.error = a.payload ?? 'Could not notify the server that the stream ended.';
      s.phase = s.endAttempts >= END_MAX_ATTEMPTS ? 'ended' : 'ending';
    });
  },
});

export const {
  resetBroadcast,
  beginEnding,
  publisherStateChanged,
  publisherStats,
  publisherError,
  networkPath,
  telemetryProgress,
  setTelemetryEnabled,
  setBroadcastError,
} = broadcastSlice.actions;
export default broadcastSlice.reducer;
