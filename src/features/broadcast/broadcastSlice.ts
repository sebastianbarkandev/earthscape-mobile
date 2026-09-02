import { createAsyncThunk, createSlice, PayloadAction } from '@reduxjs/toolkit';
import { createMobileStream, endMobileStream, getMobileStream, type CreateStreamBody, type MobileStream } from './api';
import type { NetworkPathEvent, PublisherState, PublisherStats, SpeechPermission, VoiceListenState, VoiceStateEvent } from '../../../modules/earthscape-live';
import { redactSecrets } from './redact';
import { ApiError } from '@/common/api/client';
import { deleteClipmarkApi, postClipmark, postClipmarkUpdate, type VoiceClipmarkJson } from '@/features/player/api';
import { DEFAULT_REACTION_OFFSET_SEC, MIN_VOICE_CLIP_SEC } from './voice/voiceTiming';

/** /end retries before giving up (the live server's 15-min no-data expiry then closes the stream). */
export const END_MAX_ATTEMPTS = 6;

/**
 * Voice commands while streaming (features/broadcast/voice). `mode` is what the phone DOES
 * with what it hears: `standby` only reacts to the wake phrase, `active` runs the command
 * grammar; `listen` mirrors the native recognizer (whether anything is heard at all).
 */
export type VoiceMode = 'off' | 'standby' | 'active';

export interface VoiceMark {
  id: number;
  type: 'timepoint' | 'clip';
  time_start: number;
  time_end: number | null;
  text: string;
}

export interface VoiceFeedback {
  text: string;
  tone: 'ok' | 'warn' | 'err';
  at: number; // ms epoch, for the HUD's fade
}

export interface VoiceState {
  mode: VoiceMode;
  listen: VoiceListenState;
  listenReason: string | null;
  onDevice: boolean;
  permission: SpeechPermission | null;
  /** Arm standby (wake phrase) automatically once live. Survives resetBroadcast. */
  wakeEnabled: boolean;
  /** Seconds subtracted from the utterance start: the moment worth marking was BEFORE the user spoke. */
  reactionOffsetSec: number;
  transcript: string;
  transcriptFinal: boolean;
  feedback: VoiceFeedback | null;
  /** Unix seconds of a spoken "clip in" awaiting its "clip out". */
  openClipStart: number | null;
  /** Marks created by voice during this broadcast, newest last. */
  marks: VoiceMark[];
  /** Clipmark requests in flight. */
  busy: number;
  /** ms epoch of the last accepted utterance — the idle timeout drops `active` back to `standby`. */
  lastActivityAt: number | null;
  /** Every feedback line of this broadcast, newest first (capped) — the HUD's help panel shows it, so "it did nothing" has a record. */
  history: VoiceFeedback[];
}

const initialVoice: VoiceState = {
  mode: 'off',
  listen: 'off',
  listenReason: null,
  onDevice: false,
  permission: null,
  wakeEnabled: true,
  reactionOffsetSec: DEFAULT_REACTION_OFFSET_SEC,
  transcript: '',
  transcriptFinal: false,
  feedback: null,
  openClipStart: null,
  marks: [],
  busy: 0,
  lastActivityAt: null,
  history: [],
};

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
  /**
   * GPS telemetry. `enabled` is the live truth ("fixes are being attached"), not just the
   * checkbox intent — a denied location permission turns it off. `denied` records that iOS
   * refused, which is what makes the Go Live screen offer a retry: a second
   * `requestForegroundPermissionsAsync()` is answered SILENTLY from the remembered denial,
   * so without an explicit affordance the user has no way back (SEC-022 companion bug).
   */
  telemetry: { sent: number; pending: number; failures: number; enabled: boolean; denied: boolean; lastFixAt: number | null };
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
  voice: VoiceState;
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
  telemetry: { sent: 0, pending: 0, failures: 0, enabled: true, denied: false, lastFixAt: null },
  startedAt: null,
  error: null,
  fatalReason: null,
  lastEvent: null,
  endAttempts: 0,
  voice: initialVoice,
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

// ── Voice-created clipmarks: the same endpoints the timeline card uses, on the phone's own video ──

type VoiceThunkApi = { state: { broadcast: BroadcastState }; rejectValue: string };

/** The phone's video + event, or the reason there is none (no stream yet / already ended). */
function voiceTarget(state: BroadcastState): { videoId: number; eventId: number } | string {
  const s = state.stream;
  if (!s || state.phase !== 'live') return 'Not streaming';
  if (typeof s.video_id !== 'number' || typeof s.event_id !== 'number') return 'Stream has no video yet';
  return { videoId: s.video_id, eventId: s.event_id };
}

const voiceMarkText = (n: number, type: VoiceMark['type']) => `Voice ${type === 'clip' ? 'clip' : 'mark'} ${n}`;

/** What was heard, for the record (the backend whitelists this exact `stream`). */
export interface VoiceProvenance {
  transcript: string;
  confidence?: number;
}
const voiceJson = (command: string, p: VoiceProvenance | undefined, offsetSec: number): VoiceClipmarkJson => ({
  stream: 'VOICE',
  data: { kind: 'voice', command, transcript: (p?.transcript ?? '').slice(0, 500), confidence: p?.confidence, offset_sec: offsetSec },
});

export const voiceAddMark = createAsyncThunk<VoiceMark, { atUnix: number; provenance?: VoiceProvenance }, VoiceThunkApi>(
  'broadcast/voice/mark',
  async ({ atUnix, provenance }, { getState, rejectWithValue }) => {
    const target = voiceTarget(getState().broadcast);
    if (typeof target === 'string') return rejectWithValue(target);
    const { voice } = getState().broadcast;
    const n = voice.marks.length + 1;
    try {
      const cm = await postClipmark(target.videoId, {
        event_id: target.eventId,
        time_start: atUnix,
        time_end: null,
        type: 'timepoint',
        text: voiceMarkText(n, 'timepoint'),
        the_json: voiceJson('mark', provenance, voice.reactionOffsetSec),
      });
      return { id: cm.id, type: 'timepoint', time_start: cm.time_start ?? atUnix, time_end: null, text: cm.text ?? voiceMarkText(n, 'timepoint') };
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

export const voiceClipOut = createAsyncThunk<VoiceMark, { atUnix: number; provenance?: VoiceProvenance }, VoiceThunkApi>(
  'broadcast/voice/clipOut',
  async ({ atUnix, provenance }, { getState, rejectWithValue }) => {
    const { voice } = getState().broadcast;
    const target = voiceTarget(getState().broadcast);
    if (typeof target === 'string') return rejectWithValue(target);
    const start = voice.openClipStart;
    if (start == null) return rejectWithValue('No clip is open — say "clip in" first');
    if (atUnix - start < MIN_VOICE_CLIP_SEC) return rejectWithValue(`Clip too short (under ${MIN_VOICE_CLIP_SEC}s)`);
    const n = voice.marks.length + 1;
    try {
      const cm = await postClipmark(target.videoId, {
        event_id: target.eventId,
        time_start: start,
        time_end: atUnix,
        type: 'clip',
        text: voiceMarkText(n, 'clip'),
        the_json: voiceJson('clip', provenance, voice.reactionOffsetSec),
      });
      return { id: cm.id, type: 'clip', time_start: cm.time_start ?? start, time_end: cm.time_end ?? atUnix, text: cm.text ?? voiceMarkText(n, 'clip') };
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

/** "Label …": renames the newest voice mark (the timeline shows `text`). */
export const voiceLabelLast = createAsyncThunk<{ id: number; text: string }, { text: string }, VoiceThunkApi>(
  'broadcast/voice/label',
  async ({ text }, { getState, rejectWithValue }) => {
    const target = voiceTarget(getState().broadcast);
    if (typeof target === 'string') return rejectWithValue(target);
    const last = getState().broadcast.voice.marks[getState().broadcast.voice.marks.length - 1];
    if (!last) return rejectWithValue('Nothing to label yet');
    const trimmed = text.trim().slice(0, 200);
    if (!trimmed) return rejectWithValue('Say the label after "label"');
    try {
      await postClipmarkUpdate(target.videoId, last.id, { event_id: target.eventId, text: trimmed });
      return { id: last.id, text: trimmed };
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

/** "Undo": deletes the newest voice mark (only marks this session created — never someone else's). */
export const voiceUndoLast = createAsyncThunk<{ id: number }, void, VoiceThunkApi>(
  'broadcast/voice/undo',
  async (_, { getState, rejectWithValue }) => {
    const target = voiceTarget(getState().broadcast);
    if (typeof target === 'string') return rejectWithValue(target);
    const last = getState().broadcast.voice.marks[getState().broadcast.voice.marks.length - 1];
    if (!last) return rejectWithValue('Nothing to undo');
    try {
      await deleteClipmarkApi(target.videoId, last.id);
      return { id: last.id };
    } catch (e) {
      return rejectWithValue(msg(e));
    }
  },
);

export const VOICE_HISTORY_MAX = 12;
/** Show a feedback line and keep it in the history. */
const say = (voice: VoiceState, text: string, tone: VoiceFeedback['tone']) => {
  const f: VoiceFeedback = { text, tone, at: Date.now() };
  voice.feedback = f;
  voice.history.unshift(f);
  if (voice.history.length > VOICE_HISTORY_MAX) voice.history.length = VOICE_HISTORY_MAX;
};

const broadcastSlice = createSlice({
  name: 'broadcast',
  initialState,
  reducers: {
    // Voice preferences (wake phrase, reaction offset) are the user's settings, not stream state.
    resetBroadcast: (state) => ({
      ...initialState,
      voice: { ...initialVoice, wakeEnabled: state.voice.wakeEnabled, reactionOffsetSec: state.voice.reactionOffsetSec, permission: state.voice.permission },
    }),
    voiceSetMode(state, { payload }: PayloadAction<VoiceMode>) {
      if (state.voice.mode === payload) return;
      state.voice.mode = payload;
      state.voice.lastActivityAt = payload === 'active' ? Date.now() : null;
      state.voice.transcript = '';
      state.voice.transcriptFinal = false;
      if (payload === 'off') state.voice.feedback = null;
      else if (payload === 'active') say(state.voice, 'Voice commands active', 'ok');
      else say(state.voice, 'Say “activate voice commands”', 'ok');
    },
    voiceListenChanged(state, { payload }: PayloadAction<VoiceStateEvent>) {
      state.voice.listen = payload.state;
      state.voice.listenReason = payload.reason ?? null;
      state.voice.onDevice = payload.onDevice;
      // The native side stopped on its own (stopPreview / module destroyed): mirror it.
      if (payload.state === 'off' && state.voice.mode !== 'off') state.voice.mode = 'off';
    },
    voicePermission(state, { payload }: PayloadAction<SpeechPermission>) {
      state.voice.permission = payload;
    },
    voiceSetWakeEnabled(state, { payload }: PayloadAction<boolean>) {
      state.voice.wakeEnabled = payload;
    },
    voiceSetReactionOffset(state, { payload }: PayloadAction<number>) {
      state.voice.reactionOffsetSec = Math.max(0, Math.min(10, payload));
    },
    voiceTranscript(state, { payload }: PayloadAction<{ text: string; isFinal: boolean }>) {
      state.voice.transcript = payload.text;
      state.voice.transcriptFinal = payload.isFinal;
    },
    voiceFeedback(state, { payload }: PayloadAction<{ text: string; tone: VoiceFeedback['tone'] }>) {
      say(state.voice, payload.text, payload.tone);
    },
    voiceTouch(state) {
      state.voice.lastActivityAt = Date.now();
    },
    voiceClipIn(state, { payload }: PayloadAction<{ atUnix: number }>) {
      state.voice.openClipStart = payload.atUnix;
      say(state.voice, 'Clip started — say “clip out” to save it', 'ok');
    },
    voiceCancelClip(state) {
      say(state.voice, state.voice.openClipStart == null ? 'No clip is open' : 'Clip cancelled', state.voice.openClipStart == null ? 'warn' : 'ok');
      state.voice.openClipStart = null;
    },
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
      s.voice.marks = [];
      s.voice.openClipStart = null;
      s.voice.history = [];
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

    // ── Voice marks ──
    const voiceRejected = (fallback: string) => (s: BroadcastState, a: { payload?: string }) => {
      s.voice.busy = Math.max(0, s.voice.busy - 1);
      // Guard messages ("No clip is open") are warnings; transport/server failures are errors.
      const text = a.payload ?? fallback;
      say(s.voice, text, /failed|HTTP|network|timed out|Could not/i.test(text) ? 'err' : 'warn');
    };
    const voicePending = (s: BroadcastState) => { s.voice.busy += 1; };
    b.addCase(voiceAddMark.pending, voicePending);
    b.addCase(voiceAddMark.fulfilled, (s, { payload }) => {
      s.voice.busy = Math.max(0, s.voice.busy - 1);
      s.voice.marks.push(payload);
      say(s.voice, 'Mark added', 'ok');
    });
    b.addCase(voiceAddMark.rejected, voiceRejected('Could not add the mark'));
    b.addCase(voiceClipOut.pending, voicePending);
    b.addCase(voiceClipOut.fulfilled, (s, { payload }) => {
      s.voice.busy = Math.max(0, s.voice.busy - 1);
      s.voice.marks.push(payload);
      s.voice.openClipStart = null;
      const len = payload.time_end != null ? Math.round(payload.time_end - payload.time_start) : 0;
      say(s.voice, `Clip saved (${len}s)`, 'ok');
    });
    b.addCase(voiceClipOut.rejected, voiceRejected('Could not save the clip'));
    b.addCase(voiceLabelLast.pending, voicePending);
    b.addCase(voiceLabelLast.fulfilled, (s, { payload }) => {
      s.voice.busy = Math.max(0, s.voice.busy - 1);
      const m = s.voice.marks.find((x) => x.id === payload.id);
      if (m) m.text = payload.text;
      say(s.voice, `Labelled “${payload.text}”`, 'ok');
    });
    b.addCase(voiceLabelLast.rejected, voiceRejected('Could not label the mark'));
    b.addCase(voiceUndoLast.pending, voicePending);
    b.addCase(voiceUndoLast.fulfilled, (s, { payload }) => {
      s.voice.busy = Math.max(0, s.voice.busy - 1);
      s.voice.marks = s.voice.marks.filter((x) => x.id !== payload.id);
      say(s.voice, 'Last mark deleted', 'ok');
    });
    b.addCase(voiceUndoLast.rejected, voiceRejected('Could not delete the mark'));
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
  voiceSetMode,
  voiceListenChanged,
  voicePermission,
  voiceSetWakeEnabled,
  voiceSetReactionOffset,
  voiceTranscript,
  voiceFeedback,
  voiceTouch,
  voiceClipIn,
  voiceCancelClip,
} = broadcastSlice.actions;
export default broadcastSlice.reducer;
