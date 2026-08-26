import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createMobileStream, endMobileStream, getMobileStream, type CreateStreamBody, type MobileStream } from './api';
import type { NetworkPathEvent, PublisherState, PublisherStats } from '../../../modules/earthscape-live';

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
  lastEvent: string | null;
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
  lastEvent: null,
};

const msg = (e: unknown) => (e instanceof Error ? e.message : 'Request failed');

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
      state.lastEvent = `${payload.code}: ${payload.message}`;
      if (payload.fatal) {
        state.error = payload.message;
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
      if (payload) state.phase = 'error';
    },
  },
  extraReducers: (b) => {
    b.addCase(createBroadcast.pending, (s, a) => {
      s.phase = 'creating';
      s.mode = a.meta.arg.event_id ? 'join' : 'new';
      s.error = null;
      s.startedAt = null;
      s.stats = null;
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
      s.stream = { ...(s.stream ?? payload), ...payload, ingest: s.stream?.ingest ?? payload.ingest };
      if (payload.status === 'ended' && s.phase !== 'ended') s.phase = 'ended';
    });
    b.addCase(endBroadcast.pending, (s) => {
      s.phase = 'ending';
    });
    b.addCase(endBroadcast.fulfilled, (s, { payload }) => {
      s.phase = 'ended';
      if (s.stream) s.stream = { ...s.stream, status: payload };
    });
    b.addCase(endBroadcast.rejected, (s, a) => {
      // The server call failed but the publisher is already stopped; surface it, keep 'ended' semantics.
      s.phase = 'ended';
      s.error = a.payload ?? 'Could not notify the server that the stream ended.';
    });
  },
});

export const {
  resetBroadcast,
  publisherStateChanged,
  publisherStats,
  publisherError,
  networkPath,
  telemetryProgress,
  setTelemetryEnabled,
  setBroadcastError,
} = broadcastSlice.actions;
export default broadcastSlice.reducer;
