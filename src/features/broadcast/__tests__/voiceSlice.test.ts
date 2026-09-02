/**
 * Voice sub-state of the broadcast slice: mode/listen bookkeeping, the four clipmark thunks
 * (same endpoints the timeline card uses) and their feedback. Network is mocked at the api
 * layer — the thunks must never fire outside a live stream.
 */
import { configureStore } from '@reduxjs/toolkit';
import reducer, {
  createBroadcast,
  publisherStateChanged,
  resetBroadcast,
  voiceAddMark,
  voiceCancelClip,
  voiceClipIn,
  voiceClipOut,
  voiceLabelLast,
  voiceListenChanged,
  voiceSetMode,
  voiceSetReactionOffset,
  voiceSetWakeEnabled,
  voiceUndoLast,
  type BroadcastState,
} from '../broadcastSlice';
import type { MobileStream } from '../api';

jest.mock('@/features/player/api', () => ({
  postClipmark: jest.fn(),
  postClipmarkUpdate: jest.fn(),
  deleteClipmarkApi: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('@/features/player/api') as { postClipmark: jest.Mock; postClipmarkUpdate: jest.Mock; deleteClipmarkApi: jest.Mock };

const stream: MobileStream = {
  id: 9, status: 'started', video_id: 70, event_id: 7, is_primary: true, program_type: null, title: 't', created_at: '2023-11-14T22:13:20', ended_at: null,
  playlist_ready: true, playlist_url: '/live/9/playlist.m3u8', server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: 'p', pbkeylen: 16, latency_ms: 400, url: 'srt://h:4096?mode=caller&passphrase=p&pbkeylen=16&latency=400' },
  telemetry_url: '/api/v1/live/streams/9/telemetry',
};
const init = (): BroadcastState => reducer(undefined, { type: 'x' });
const T0 = 1_700_000_000;

function liveStore() {
  const store = configureStore({ reducer: { broadcast: reducer } });
  store.dispatch(createBroadcast.fulfilled(stream, 'r', {}));
  store.dispatch(publisherStateChanged({ state: 'publishing', reason: 'connected' }));
  return store;
}
type Store = ReturnType<typeof liveStore>;
const voice = (store: Store) => store.getState().broadcast.voice;

beforeEach(() => {
  api.postClipmark.mockReset();
  api.postClipmarkUpdate.mockReset();
  api.deleteClipmarkApi.mockReset();
});

describe('voice reducers', () => {
  it('defaults: off, wake phrase on, 1.5 s reaction offset, no permission known', () => {
    const v = init().voice;
    expect(v.mode).toBe('off');
    expect(v.listen).toBe('off');
    expect(v.wakeEnabled).toBe(true);
    expect(v.reactionOffsetSec).toBe(1.5);
    expect(v.permission).toBeNull();
    expect(v.marks).toEqual([]);
    expect(v.openClipStart).toBeNull();
  });

  it('mode changes clear the transcript and announce themselves', () => {
    let s = reducer(init(), voiceSetMode('active'));
    expect(s.voice.mode).toBe('active');
    expect(s.voice.lastActivityAt).not.toBeNull();
    expect(s.voice.feedback?.text).toBe('Voice commands active');
    s = reducer(s, voiceSetMode('standby'));
    expect(s.voice.lastActivityAt).toBeNull();
    expect(s.voice.feedback?.text).toMatch(/activate voice commands/);
    s = reducer(s, voiceSetMode('off'));
    expect(s.voice.feedback).toBeNull();
  });

  it("the native recognizer reporting 'off' forces the mode off (it stopped underneath us)", () => {
    let s = reducer(init(), voiceSetMode('active'));
    s = reducer(s, voiceListenChanged({ state: 'paused_muted', onDevice: true }));
    expect(s.voice.mode).toBe('active');
    expect(s.voice.listen).toBe('paused_muted');
    s = reducer(s, voiceListenChanged({ state: 'off', onDevice: true }));
    expect(s.voice.mode).toBe('off');
  });

  it('reaction offset is clamped to 0–10 s', () => {
    expect(reducer(init(), voiceSetReactionOffset(-3)).voice.reactionOffsetSec).toBe(0);
    expect(reducer(init(), voiceSetReactionOffset(99)).voice.reactionOffsetSec).toBe(10);
    expect(reducer(init(), voiceSetReactionOffset(2)).voice.reactionOffsetSec).toBe(2);
  });

  it('clip in / cancel', () => {
    let s = reducer(init(), voiceClipIn({ atUnix: T0 }));
    expect(s.voice.openClipStart).toBe(T0);
    expect(s.voice.feedback?.tone).toBe('ok');
    s = reducer(s, voiceCancelClip());
    expect(s.voice.openClipStart).toBeNull();
    expect(s.voice.feedback?.text).toBe('Clip cancelled');
    s = reducer(s, voiceCancelClip());
    expect(s.voice.feedback?.tone).toBe('warn');
  });

  it('resetBroadcast keeps the user’s voice preferences but drops stream state', () => {
    let s = reducer(init(), voiceSetWakeEnabled(false));
    s = reducer(s, voiceSetReactionOffset(3));
    s = reducer(s, voiceSetMode('active'));
    s = reducer(s, voiceClipIn({ atUnix: T0 }));
    s = reducer(s, resetBroadcast());
    expect(s.voice.wakeEnabled).toBe(false);
    expect(s.voice.reactionOffsetSec).toBe(3);
    expect(s.voice.mode).toBe('off');
    expect(s.voice.openClipStart).toBeNull();
  });

  it('a new stream starts with no voice marks', () => {
    let s = reducer(init(), voiceClipIn({ atUnix: T0 }));
    s = { ...s, voice: { ...s.voice, marks: [{ id: 1, type: 'timepoint', time_start: T0, time_end: null, text: 'x' }] } };
    s = reducer(s, createBroadcast.pending('r', {}));
    expect(s.voice.marks).toEqual([]);
    expect(s.voice.openClipStart).toBeNull();
  });
});

describe('voice thunks', () => {
  it('"mark" posts a timepoint on the phone’s own video/event and remembers it', async () => {
    api.postClipmark.mockResolvedValue({ id: 501, time_start: T0 + 10, time_end: null, text: 'Voice mark 1', type: 'timepoint' });
    const store = liveStore();
    await store.dispatch(voiceAddMark({ atUnix: T0 + 10, provenance: { transcript: 'mark', confidence: 0.8 } }));
    expect(api.postClipmark).toHaveBeenCalledWith(70, {
      event_id: 7, time_start: T0 + 10, time_end: null, type: 'timepoint', text: 'Voice mark 1',
      the_json: { stream: 'VOICE', data: { kind: 'voice', command: 'mark', transcript: 'mark', confidence: 0.8, offset_sec: 1.5 } },
    });
    expect(voice(store).marks).toEqual([{ id: 501, type: 'timepoint', time_start: T0 + 10, time_end: null, text: 'Voice mark 1' }]);
    expect(voice(store).feedback).toMatchObject({ text: 'Mark added', tone: 'ok' });
    expect(voice(store).busy).toBe(0);
  });

  it('refuses to post when not live', async () => {
    const store = configureStore({ reducer: { broadcast: reducer } });
    await store.dispatch(voiceAddMark({ atUnix: T0 }));
    expect(api.postClipmark).not.toHaveBeenCalled();
    expect(voice(store).feedback).toMatchObject({ text: 'Not streaming', tone: 'warn' });
  });

  it('"clip out" needs an open clip of at least 1 s, then posts a clip and closes it', async () => {
    api.postClipmark.mockResolvedValue({ id: 502, time_start: T0 + 5, time_end: T0 + 17, text: 'Voice clip 1', type: 'clip' });
    const store = liveStore();
    await store.dispatch(voiceClipOut({ atUnix: T0 + 20 }));
    expect(api.postClipmark).not.toHaveBeenCalled();
    expect(voice(store).feedback?.text).toMatch(/No clip is open/);

    store.dispatch(voiceClipIn({ atUnix: T0 + 5 }));
    await store.dispatch(voiceClipOut({ atUnix: T0 + 5.5 }));
    expect(api.postClipmark).not.toHaveBeenCalled();
    expect(voice(store).feedback?.text).toMatch(/too short/);
    expect(voice(store).openClipStart).toBe(T0 + 5);

    await store.dispatch(voiceClipOut({ atUnix: T0 + 17 }));
    expect(api.postClipmark).toHaveBeenCalledWith(70, expect.objectContaining({ event_id: 7, time_start: T0 + 5, time_end: T0 + 17, type: 'clip', text: 'Voice clip 1' }));
    expect(api.postClipmark.mock.calls[0][1].the_json).toMatchObject({ stream: 'VOICE', data: { kind: 'voice', command: 'clip', transcript: '' } });
    expect(voice(store).openClipStart).toBeNull();
    expect(voice(store).marks[0]).toMatchObject({ id: 502, type: 'clip', time_end: T0 + 17 });
    expect(voice(store).feedback?.text).toBe('Clip saved (12s)');
  });

  it('"label …" renames the newest mark; "undo" deletes it', async () => {
    api.postClipmark.mockResolvedValueOnce({ id: 1, time_start: T0 + 1, time_end: null, text: 'Voice mark 1', type: 'timepoint' });
    api.postClipmark.mockResolvedValueOnce({ id: 2, time_start: T0 + 2, time_end: null, text: 'Voice mark 2', type: 'timepoint' });
    api.postClipmarkUpdate.mockResolvedValue({});
    api.deleteClipmarkApi.mockResolvedValue(undefined);
    const store = liveStore();
    await store.dispatch(voiceLabelLast({ text: 'nothing yet' }));
    expect(api.postClipmarkUpdate).not.toHaveBeenCalled();
    expect(voice(store).feedback?.text).toBe('Nothing to label yet');

    await store.dispatch(voiceAddMark({ atUnix: T0 + 1 }));
    await store.dispatch(voiceAddMark({ atUnix: T0 + 2 }));
    await store.dispatch(voiceLabelLast({ text: '  suspect vehicle  ' }));
    expect(api.postClipmarkUpdate).toHaveBeenCalledWith(70, 2, { event_id: 7, text: 'suspect vehicle' });
    expect(voice(store).marks[1].text).toBe('suspect vehicle');
    expect(voice(store).marks[0].text).toBe('Voice mark 1');

    await store.dispatch(voiceUndoLast());
    expect(api.deleteClipmarkApi).toHaveBeenCalledWith(70, 2);
    expect(voice(store).marks.map((m) => m.id)).toEqual([1]);
    await store.dispatch(voiceUndoLast());
    expect(voice(store).marks).toEqual([]);
    await store.dispatch(voiceUndoLast());
    expect(api.deleteClipmarkApi).toHaveBeenCalledTimes(2);
    expect(voice(store).feedback?.text).toBe('Nothing to undo');
  });

  it('server failures surface as errors and leave the mark list untouched', async () => {
    api.postClipmark.mockRejectedValue(new Error('HTTP 500'));
    const store = liveStore();
    await store.dispatch(voiceAddMark({ atUnix: T0 + 1 }));
    expect(voice(store).marks).toEqual([]);
    expect(voice(store).feedback?.tone).toBe('err');
    expect(voice(store).busy).toBe(0);
  });
});
