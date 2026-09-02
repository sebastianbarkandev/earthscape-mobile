/**
 * useVoiceCommands: native transcript events → strict grammar → clipmark thunks.
 * Policy under test: only FINAL results act, each request id acts once, standby reacts to the
 * wake phrase only, the button arms straight to active, and the recognizer is stopped when
 * the stream ends or the screen unmounts.
 */
import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import broadcastReducer, { createBroadcast, endBroadcast, publisherStateChanged, voiceSetMode } from '../broadcastSlice';
import { useVoiceCommands } from '../voice/useVoiceCommands';
import { EarthscapeLive } from '../../../../modules/earthscape-live';
import type { MobileStream } from '../api';

type Listener = (e: unknown) => void;
const listeners: Record<string, Listener[]> = {};
const emit = (name: string, e: unknown) => (listeners[name] ?? []).forEach((l) => l(e));

jest.mock('../../../../modules/earthscape-live', () => ({
  EarthscapeLive: {
    isSupported: true,
    isVoiceSupported: true,
    getSpeechPermission: jest.fn(() => Promise.resolve('granted')),
    requestSpeechPermission: jest.fn(() => Promise.resolve('granted')),
    setVoiceListening: jest.fn(() => Promise.resolve()),
    haptic: jest.fn(),
  },
  addLiveListener: jest.fn((name: string, fn: Listener) => {
    (listeners[name] ??= []).push(fn);
    return { remove: () => { listeners[name] = listeners[name].filter((l) => l !== fn); } };
  }),
}));
jest.mock('@/features/player/api', () => ({
  postClipmark: jest.fn(),
  postClipmarkUpdate: jest.fn(),
  deleteClipmarkApi: jest.fn(),
}));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const api = require('@/features/player/api') as { postClipmark: jest.Mock; postClipmarkUpdate: jest.Mock; deleteClipmarkApi: jest.Mock };
const native = EarthscapeLive as unknown as { getSpeechPermission: jest.Mock; requestSpeechPermission: jest.Mock; setVoiceListening: jest.Mock; haptic: jest.Mock };

const T0 = 1_700_000_000;
const stream: MobileStream = {
  id: 9, status: 'started', video_id: 70, event_id: 7, is_primary: true, program_type: null, title: 't', created_at: '2023-11-14T22:13:20', ended_at: null,
  playlist_ready: true, playlist_url: '/live/9/playlist.m3u8', server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: 'p', pbkeylen: 16, latency_ms: 400, url: 'srt://h:4096?mode=caller&passphrase=p&pbkeylen=16&latency=400' },
  telemetry_url: '/api/v1/live/streams/9/telemetry',
};

type Api = ReturnType<typeof useVoiceCommands>;
function Probe({ onApi }: { onApi: (api: Api) => void }) {
  const api = useVoiceCommands();
  useEffect(() => onApi(api));
  return null;
}

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

function makeStore() {
  return configureStore({ reducer: { broadcast: broadcastReducer } });
}
type Store = ReturnType<typeof makeStore>;

async function mount(store: Store) {
  let latest!: Api;
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <Probe onApi={(a) => { latest = a; }} />
      </Provider>,
    );
  });
  await flush();
  return { r, api: () => latest };
}

const goLive = (store: Store) => {
  store.dispatch(createBroadcast.fulfilled(stream, 'r', {}));
  store.dispatch(publisherStateChanged({ state: 'publishing', reason: 'connected' }));
};

/** A transcript with the recognizer's own word offset: spoken `atOffset` s after the request began. */
const transcript = (requestId: number, text: string, isFinal: boolean, startUnix: number | null = T0 + 60) => ({
  requestId, text, isFinal, onDevice: true, requestStartUnix: T0 + 50,
  segments: [{ text, startUnix, durationSec: 0.4, confidence: 0.9 }],
});

const voice = (store: Store) => store.getState().broadcast.voice;

beforeEach(() => {
  for (const k of Object.keys(listeners)) delete listeners[k];
  api.postClipmark.mockReset();
  api.postClipmarkUpdate.mockReset();
  api.deleteClipmarkApi.mockReset();
  native.getSpeechPermission.mockReset().mockResolvedValue('granted');
  native.requestSpeechPermission.mockReset().mockResolvedValue('granted');
  native.setVoiceListening.mockReset().mockResolvedValue(undefined);
  native.haptic.mockReset();
});

describe('arming', () => {
  it('going live with the wake phrase enabled arms STANDBY without prompting for permission', async () => {
    const store = makeStore();
    const { r } = await mount(store);
    expect(native.setVoiceListening).not.toHaveBeenCalled();
    await act(async () => { goLive(store); });
    await flush();
    expect(native.requestSpeechPermission).not.toHaveBeenCalled();
    expect(native.setVoiceListening).toHaveBeenCalledWith(true, expect.arrayContaining(['mark', 'clip in', 'activate voice commands']));
    expect(voice(store).mode).toBe('standby');
    await act(async () => { r.unmount(); });
  });

  it('does not auto-arm when permission has not been granted (only the button may prompt)', async () => {
    native.getSpeechPermission.mockResolvedValue('undetermined');
    const store = makeStore();
    const { r } = await mount(store);
    await act(async () => { goLive(store); });
    await flush();
    expect(native.requestSpeechPermission).not.toHaveBeenCalled();
    expect(native.setVoiceListening).not.toHaveBeenCalled();
    expect(voice(store).mode).toBe('off');
    expect(voice(store).permission).toBe('undetermined');
    await act(async () => { r.unmount(); });
  });

  it('the button goes straight to ACTIVE, asking for permission when undetermined; toggling again turns it off', async () => {
    native.getSpeechPermission.mockResolvedValue('undetermined');
    const store = makeStore();
    const { r, api: hook } = await mount(store);
    await act(async () => { goLive(store); });
    await flush();
    await act(async () => { await hook().toggle(); });
    expect(native.requestSpeechPermission).toHaveBeenCalledTimes(1);
    expect(native.setVoiceListening).toHaveBeenLastCalledWith(true, expect.any(Array));
    expect(voice(store).mode).toBe('active');
    expect(native.haptic).toHaveBeenCalledWith('success');
    await act(async () => { await hook().toggle(); });
    expect(voice(store).mode).toBe('off');
    expect(native.setVoiceListening).toHaveBeenLastCalledWith(false);
    await act(async () => { r.unmount(); });
  });

  it('a denied permission shows the Settings alert and stays off', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    native.getSpeechPermission.mockResolvedValue('denied');
    const store = makeStore();
    const { r, api: hook } = await mount(store);
    await act(async () => { goLive(store); });
    await flush();
    await act(async () => { await hook().toggle(); });
    expect(alert).toHaveBeenCalledTimes(1);
    expect(native.setVoiceListening).not.toHaveBeenCalled();
    expect(voice(store).mode).toBe('off');
    alert.mockRestore();
    await act(async () => { r.unmount(); });
  });

  it('stops the recognizer when the stream ends and on unmount', async () => {
    const store = makeStore();
    const { r } = await mount(store);
    await act(async () => { goLive(store); });
    await flush();
    expect(voice(store).mode).toBe('standby');
    native.setVoiceListening.mockClear();
    await act(async () => { store.dispatch(endBroadcast.fulfilled('ending', 'r2', undefined)); });
    await flush();
    expect(voice(store).mode).toBe('off');
    expect(native.setVoiceListening).toHaveBeenCalledWith(false);
    native.setVoiceListening.mockClear();
    await act(async () => { r.unmount(); });
    expect(native.setVoiceListening).toHaveBeenCalledWith(false);
  });
});

describe('transcripts', () => {
  async function liveActive() {
    const store = makeStore();
    const m = await mount(store);
    await act(async () => { goLive(store); });
    await flush();
    await act(async () => { store.dispatch(voiceSetMode('active')); });
    native.haptic.mockClear();
    return { store, ...m };
  }

  it('standby: only the wake phrase does anything, and it may sit inside a sentence', async () => {
    const store = makeStore();
    const { r } = await mount(store);
    await act(async () => { goLive(store); });
    await flush();
    expect(voice(store).mode).toBe('standby');
    await act(async () => { emit('onVoiceTranscript', transcript(1, 'mark', true)); });
    expect(api.postClipmark).not.toHaveBeenCalled();
    expect(voice(store).mode).toBe('standby');
    await act(async () => { emit('onVoiceTranscript', transcript(2, 'okay activate voice commands', false)); });
    expect(voice(store).mode).toBe('standby');
    await act(async () => { emit('onVoiceTranscript', transcript(2, 'okay activate voice commands', true)); });
    expect(voice(store).mode).toBe('active');
    expect(native.haptic).toHaveBeenCalledWith('success');
    await act(async () => { r.unmount(); });
  });

  it('active: a final "mark" posts a timepoint back-dated to utterance start minus the reaction offset; partials only show', async () => {
    api.postClipmark.mockResolvedValue({ id: 11, time_start: T0 + 58.5, time_end: null, text: 'Voice mark 1', type: 'timepoint' });
    const { store, r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(3, 'mar', false)); });
    expect(voice(store).transcript).toBe('mar');
    expect(voice(store).transcriptFinal).toBe(false);
    expect(api.postClipmark).not.toHaveBeenCalled();
    await act(async () => { emit('onVoiceTranscript', transcript(3, 'mark', true, T0 + 60)); });
    await flush();
    expect(api.postClipmark).toHaveBeenCalledTimes(1);
    expect(api.postClipmark.mock.calls[0][1]).toMatchObject({
      type: 'timepoint', time_start: T0 + 60 - 1.5,
      the_json: { stream: 'VOICE', data: { kind: 'voice', command: 'mark', transcript: 'mark', confidence: 0.9, offset_sec: 1.5 } },
    });
    expect(voice(store).marks).toHaveLength(1);
    expect(native.haptic).toHaveBeenCalledWith('success');
    await act(async () => { r.unmount(); });
  });

  it('the same request id is never acted on twice', async () => {
    api.postClipmark.mockResolvedValue({ id: 11, time_start: T0, time_end: null, text: 'x', type: 'timepoint' });
    const { r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(4, 'mark', true)); });
    await act(async () => { emit('onVoiceTranscript', transcript(4, 'mark', true)); });
    await flush();
    expect(api.postClipmark).toHaveBeenCalledTimes(1);
    await act(async () => { r.unmount(); });
  });

  it('a mark can never be dated before the stream began', async () => {
    api.postClipmark.mockResolvedValue({ id: 11, time_start: T0, time_end: null, text: 'x', type: 'timepoint' });
    const { r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(5, 'mark', true, T0 + 0.2)); });
    await flush();
    expect(api.postClipmark.mock.calls[0][1]).toMatchObject({ time_start: T0 });
    await act(async () => { r.unmount(); });
  });

  it('"clip in" … "clip out" saves a clip; "cancel clip" drops one; "undo" deletes the last mark; "label" renames it', async () => {
    api.postClipmark.mockResolvedValue({ id: 21, time_start: T0 + 58.5, time_end: T0 + 78.5, text: 'Voice clip 1', type: 'clip' });
    api.postClipmarkUpdate.mockResolvedValue({});
    api.deleteClipmarkApi.mockResolvedValue(undefined);
    const { store, r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(6, 'clip in', true, T0 + 60)); });
    expect(voice(store).openClipStart).toBe(T0 + 58.5);
    await act(async () => { emit('onVoiceTranscript', transcript(7, 'cancel clip', true, T0 + 65)); });
    expect(voice(store).openClipStart).toBeNull();
    await act(async () => { emit('onVoiceTranscript', transcript(8, 'start clip', true, T0 + 60)); });
    await act(async () => { emit('onVoiceTranscript', transcript(9, 'clip out', true, T0 + 80)); });
    await flush();
    expect(api.postClipmark).toHaveBeenCalledWith(70, expect.objectContaining({ type: 'clip', time_start: T0 + 58.5, time_end: T0 + 78.5 }));
    expect(voice(store).marks).toHaveLength(1);
    await act(async () => { emit('onVoiceTranscript', transcript(10, 'label suspect vehicle', true)); });
    await flush();
    expect(api.postClipmarkUpdate).toHaveBeenCalledWith(70, 21, { event_id: 7, text: 'suspect vehicle' });
    await act(async () => { emit('onVoiceTranscript', transcript(11, 'undo', true)); });
    await flush();
    expect(api.deleteClipmarkApi).toHaveBeenCalledWith(70, 21);
    expect(voice(store).marks).toHaveLength(0);
    await act(async () => { r.unmount(); });
  });

  it('two commands in one breath run in order', async () => {
    api.postClipmark.mockResolvedValue({ id: 31, time_start: T0, time_end: null, text: 'x', type: 'timepoint' });
    const { store, r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(12, 'mark clip in', true, T0 + 60)); });
    await flush();
    expect(api.postClipmark).toHaveBeenCalledTimes(1);
    expect(voice(store).openClipStart).toBe(T0 + 58.5);
    await act(async () => { r.unmount(); });
  });

  it('anything outside the vocabulary is rejected with visible feedback and no request', async () => {
    const { store, r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(13, 'mark the suspect on the left', true)); });
    await flush();
    expect(api.postClipmark).not.toHaveBeenCalled();
    expect(voice(store).feedback).toMatchObject({ tone: 'warn' });
    expect(voice(store).feedback?.text).toMatch(/Didn't catch that/);
    await act(async () => { r.unmount(); });
  });

  it('"deactivate voice commands" drops back to standby', async () => {
    const { store, r } = await liveActive();
    await act(async () => { emit('onVoiceTranscript', transcript(14, 'deactivate voice commands', true)); });
    expect(voice(store).mode).toBe('standby');
    await act(async () => { r.unmount(); });
  });

  it('when off, transcripts are ignored entirely', async () => {
    const store = makeStore();
    const { r } = await mount(store);
    await act(async () => { emit('onVoiceTranscript', transcript(15, 'mark', true)); });
    expect(voice(store).transcript).toBe('');
    expect(api.postClipmark).not.toHaveBeenCalled();
    await act(async () => { r.unmount(); });
  });

  it('native listen state is mirrored (paused while muted)', async () => {
    const { store, r } = await liveActive();
    await act(async () => { emit('onVoiceState', { state: 'paused_muted', onDevice: true }); });
    expect(voice(store).listen).toBe('paused_muted');
    expect(voice(store).mode).toBe('active');
    await act(async () => { r.unmount(); });
  });
});
