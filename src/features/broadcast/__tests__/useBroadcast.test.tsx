import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import broadcastReducer, { END_MAX_ATTEMPTS } from '../broadcastSlice';
import { useBroadcast } from '../useBroadcast';
import { createMobileStream, endMobileStream, getMobileStream, postTelemetry, type MobileStream } from '../api';
import { requestForegroundPermissionsAsync, watchPositionAsync } from 'expo-location';
import { EarthscapeLive } from '../../../../modules/earthscape-live';

type Listener = (e: unknown) => void;
const listeners: Record<string, Listener[]> = {};
const emit = (name: string, e: unknown) => (listeners[name] ?? []).forEach((l) => l(e));

jest.mock('../../../../modules/earthscape-live', () => ({
  EarthscapeLive: {
    isSupported: true,
    startPublish: jest.fn(() => Promise.resolve()),
    stopPublish: jest.fn(() => Promise.resolve()),
    stopPreview: jest.fn(() => Promise.resolve()),
  },
  addLiveListener: jest.fn((name: string, fn: Listener) => {
    (listeners[name] ??= []).push(fn);
    return { remove: () => { listeners[name] = listeners[name].filter((l) => l !== fn); } };
  }),
  PRESETS: { auto: { width: 1280, height: 720, fps: 30, bitrateKbps: 2500, maxBitrateKbps: 4000, minBitrateKbps: 500 } },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: false })),
  watchPositionAsync: jest.fn(),
  Accuracy: { BestForNavigation: 6 },
}));
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: jest.fn(() => Promise.resolve()),
  deactivateKeepAwake: jest.fn(() => Promise.resolve()),
}));
jest.mock('../api', () => ({
  createMobileStream: jest.fn(),
  endMobileStream: jest.fn(),
  getMobileStream: jest.fn(),
  postTelemetry: jest.fn(() => Promise.resolve({ accepted: 0, status: 'started' })),
}));

const mockedCreate = createMobileStream as jest.MockedFunction<typeof createMobileStream>;
const mockedEnd = endMobileStream as jest.MockedFunction<typeof endMobileStream>;
const mockedGet = getMobileStream as jest.MockedFunction<typeof getMobileStream>;
const native = EarthscapeLive as unknown as { startPublish: jest.Mock; stopPublish: jest.Mock; stopPreview: jest.Mock };
const mockedPost = postTelemetry as jest.MockedFunction<typeof postTelemetry>;
const mockedPerm = requestForegroundPermissionsAsync as unknown as jest.Mock;
const mockedWatch = watchPositionAsync as unknown as jest.Mock;

const stream = (id: number): MobileStream => ({
  id, status: 'starting', video_id: 70 + id, event_id: 7, is_primary: false, program_type: 'Mobile · Ana', title: 't', created_at: null, ended_at: null,
  playlist_ready: false, playlist_url: `/live/${id}/playlist.m3u8`, server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: 'p', pbkeylen: 16, latency_ms: 400, url: 'srt://h:4096?mode=caller&passphrase=p&pbkeylen=16&latency=400' },
  telemetry_url: `/api/v1/live/streams/${id}/telemetry`,
});

type Api = ReturnType<typeof useBroadcast>;
function Probe({ onApi }: { onApi: (api: Api) => void }) {
  const api = useBroadcast();
  useEffect(() => onApi(api));
  return null;
}

const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
const startArgs = { eventId: 7, streamName: 'Mobile · Ana', programType: 'Mobile · Ana', preset: { width: 1280, height: 720, fps: 30, bitrateKbps: 2500, maxBitrateKbps: 4000, minBitrateKbps: 500 }, latencyMs: 400, telemetry: false };

describe('useBroadcast state machine (phone joining a live event)', () => {
  let store: ReturnType<typeof makeStore>;
  let renderer: ReactTestRenderer | null = null;
  let api!: Api;
  const makeStore = () => configureStore({ reducer: { broadcast: broadcastReducer } });

  beforeEach(() => {
    jest.useFakeTimers();
    Object.keys(listeners).forEach((k) => delete listeners[k]);
    // The status poll the start() gate relies on: the live server has brought the
    // listener up. (Streams are created `starting`; start() waits for `started`.)
    mockedGet.mockReset();
    mockedGet.mockImplementation(async (id) => ({ ...stream(id), status: 'started' }));
    store = makeStore();
    act(() => {
      renderer = create(
        <Provider store={store}>
          <Probe onApi={(a) => { api = a; }} />
        </Provider>,
      );
    });
  });
  afterEach(() => {
    if (renderer) act(() => renderer!.unmount());
    renderer = null;
    jest.useRealTimers();
  });
  const phase = () => store.getState().broadcast.phase;

  it('create → publish → reconnect → publish → end', async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    mockedEnd.mockResolvedValueOnce({ success: true, status: 'ending' });
    let ok = false;
    await act(async () => { ok = await api.start(startArgs); });
    expect(ok).toBe(true);
    expect(mockedCreate).toHaveBeenCalledWith({ stream_name: 'Mobile · Ana', event_id: 7, program_type: 'Mobile · Ana', latency_ms: 400 });
    expect(native.startPublish).toHaveBeenCalledTimes(1);
    expect(native.startPublish.mock.calls[0][0].url).toBe(stream(9).ingest.url);
    expect(phase()).toBe('ready');
    act(() => emit('onStateChange', { state: 'connecting', previous: 'preview', reason: 'connect' }));
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting', reason: 'connected' }));
    expect(phase()).toBe('live');
    act(() => emit('onStateChange', { state: 'reconnecting', previous: 'publishing', reason: 'connection lost', attempt: 1, nextRetryMs: 1000 }));
    expect(phase()).toBe('live');
    expect(store.getState().broadcast.reconnectAttempt).toBe(1);
    act(() => emit('onStateChange', { state: 'publishing', previous: 'reconnecting', reason: 'connected' }));
    expect(store.getState().broadcast.reconnectAttempt).toBe(0);

    await act(async () => { await api.stop(); });
    // stop() stops the publisher; the "server says ending" effect may stop it once more (idempotent natively).
    expect(native.stopPublish).toHaveBeenCalled();
    expect(mockedEnd).toHaveBeenCalledWith(9);
    expect(phase()).toBe('ended');
  });

  it("the native 'preview' event during stop() does not reopen the Go live window", async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    let release!: () => void;
    native.stopPublish.mockImplementationOnce(() => new Promise<void>((r) => { release = r; }));
    mockedEnd.mockResolvedValueOnce({ success: true, status: 'ending' });
    await act(async () => { await api.start(startArgs); });
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting', reason: 'connected' }));
    let stopping!: Promise<void>;
    act(() => { stopping = api.stop(); });
    expect(phase()).toBe('ending'); // synchronously, before stopPublish resolves
    act(() => emit('onStateChange', { state: 'preview', previous: 'stopping', reason: 'user' }));
    expect(phase()).toBe('ending');
    // A tap on a stale "Go live" during the window is refused: no second POST /streams.
    let second = true;
    await act(async () => { second = await api.start(startArgs); });
    expect(second).toBe(false);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await stopping; });
    expect(phase()).toBe('ended');
  });

  it('double start is refused while creating and while ready (before the publisher connects)', async () => {
    let resolveCreate!: (s: MobileStream) => void;
    mockedCreate.mockImplementationOnce(() => new Promise<MobileStream>((r) => { resolveCreate = r; }));
    let first!: Promise<boolean>;
    act(() => { first = api.start(startArgs); });
    expect(phase()).toBe('creating');
    let second = true;
    await act(async () => { second = await api.start(startArgs); });
    expect(second).toBe(false);
    await act(async () => { resolveCreate(stream(9)); await first; });
    expect(phase()).toBe('ready');
    await act(async () => { second = await api.start(startArgs); });
    expect(second).toBe(false);
    expect(mockedCreate).toHaveBeenCalledTimes(1);
  });

  it('unmounting the screen with an open stream ends it on the server (back gesture / deep link)', async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    mockedEnd.mockResolvedValueOnce({ success: true, status: 'ending' });
    await act(async () => { await api.start(startArgs); });
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting', reason: 'connected' }));
    await act(async () => { await api.leave(); });
    await flush();
    expect(native.stopPreview).toHaveBeenCalledTimes(1);
    expect(mockedEnd).toHaveBeenCalledWith(9);
    expect(phase()).toBe('idle');
  });

  it('leaving while merely ready (created, not yet connected) also ends the server stream', async () => {
    mockedCreate.mockResolvedValueOnce(stream(11));
    mockedEnd.mockResolvedValueOnce({ success: true, status: 'ending' });
    await act(async () => { await api.start(startArgs); });
    expect(phase()).toBe('ready');
    await act(async () => { await api.leave(); });
    await flush();
    expect(mockedEnd).toHaveBeenCalledWith(11);
  });

  it('leaving after a clean End does not end twice', async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    mockedEnd.mockResolvedValue({ success: true, status: 'ending' });
    await act(async () => { await api.start(startArgs); });
    await act(async () => { await api.stop(); });
    await act(async () => { await api.leave(); });
    await flush();
    expect(mockedEnd).toHaveBeenCalledTimes(1);
  });

  it('a failed /end is retried with backoff until it lands', async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    mockedEnd.mockRejectedValueOnce(new Error('Network request failed')).mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce({ success: true, status: 'ending' });
    await act(async () => { await api.start(startArgs); });
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting', reason: 'connected' }));
    await act(async () => { await api.stop(); });
    expect(phase()).toBe('ending');
    expect(store.getState().broadcast.endAttempts).toBe(1);
    expect(store.getState().broadcast.error).toBe('Network request failed');
    await act(async () => { jest.advanceTimersByTime(1000); });
    await flush();
    expect(mockedEnd).toHaveBeenCalledTimes(2);
    expect(store.getState().broadcast.endAttempts).toBe(2);
    await act(async () => { jest.advanceTimersByTime(2000); });
    await flush();
    expect(mockedEnd).toHaveBeenCalledTimes(3);
    expect(phase()).toBe('ended');
    expect(store.getState().broadcast.error).toBeNull();
  });

  it('a restored network path retries /end at once; the budget is bounded', async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    mockedEnd.mockRejectedValue(new Error('offline'));
    await act(async () => { await api.start(startArgs); });
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting', reason: 'connected' }));
    await act(async () => { await api.stop(); });
    expect(mockedEnd).toHaveBeenCalledTimes(1);
    act(() => emit('onNetworkPath', { status: 'unsatisfied', interface: 'none', expensive: false, constrained: false }));
    act(() => emit('onNetworkPath', { status: 'satisfied', interface: 'cellular', expensive: true, constrained: false }));
    await flush();
    expect(mockedEnd).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 20; i++) {
      await act(async () => { jest.advanceTimersByTime(15000); });
      await flush();
    }
    expect(mockedEnd).toHaveBeenCalledTimes(END_MAX_ATTEMPTS);
    expect(phase()).toBe('ended');
  });

  it('startPublish failure ends the just-created server stream', async () => {
    mockedCreate.mockResolvedValueOnce(stream(9));
    native.startPublish.mockRejectedValueOnce(new Error('no camera'));
    mockedEnd.mockResolvedValueOnce({ success: true, status: 'ending' });
    let ok = true;
    await act(async () => { ok = await api.start(startArgs); });
    expect(ok).toBe(false);
    await flush();
    expect(mockedEnd).toHaveBeenCalledWith(9);
  });

  // SEC-022: the GPS checkbox is hidden in the 'ended'/'error' phases, so a location watch left
  // running there cannot be stopped from the screen at all — the hook must stop it itself.
  describe('GPS telemetry does not outlive the broadcast (SEC-022)', () => {
    const TELEMETRY_FLUSH_MS = 2000;
    const STATUS_POLL_MS = 4000;
    type Fix = { coords: { latitude: number; longitude: number; altitude: number | null; heading: number | null }; timestamp: number };
    const fixAt = (timestamp: number): Fix => ({ coords: { latitude: 45.5, longitude: -122.6, altitude: 300, heading: 90 }, timestamp });
    let watchCb: ((loc: Fix) => void) | null;
    let removeWatch: jest.Mock;

    beforeEach(() => {
      watchCb = null;
      removeWatch = jest.fn();
      mockedPerm.mockResolvedValueOnce({ granted: true });
      mockedWatch.mockImplementationOnce(async (_opts: unknown, cb: (loc: Fix) => void) => {
        watchCb = cb;
        return { remove: removeWatch };
      });
    });

    const startWithTelemetry = async () => {
      mockedCreate.mockResolvedValueOnce(stream(9));
      await act(async () => { await api.start({ ...startArgs, telemetry: true }); });
      await flush(); // start() fires startTelemetry without awaiting it
      expect(mockedWatch).toHaveBeenCalledTimes(1);
      act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting', reason: 'connected' }));
      // One fix reaches the server while live: the watch + flush loop are provably running.
      act(() => watchCb!(fixAt(1_000_000)));
      await act(async () => { jest.advanceTimersByTime(TELEMETRY_FLUSH_MS); });
      expect(mockedPost).toHaveBeenCalledTimes(1);
      mockedPost.mockClear();
    };

    const expectTelemetryStopped = async () => {
      expect(removeWatch).toHaveBeenCalledTimes(1);
      // A fix still in flight from the native watch, then several flush intervals: nothing is sent.
      act(() => watchCb!(fixAt(1_100_000)));
      await act(async () => { jest.advanceTimersByTime(5 * TELEMETRY_FLUSH_MS); });
      await flush();
      expect(mockedPost).not.toHaveBeenCalled();
    };

    it('a fatal publisher error stops the location watch and the flush loop', async () => {
      await startWithTelemetry();
      act(() => emit('onError', { code: 'srt_fatal', message: 'link lost for good', fatal: true }));
      expect(phase()).toBe('error');
      await expectTelemetryStopped();
    });

    it('a server-side end stops the location watch and the flush loop', async () => {
      await startWithTelemetry();
      mockedGet.mockImplementation(async (id) => ({ ...stream(id), status: 'ended' }));
      await act(async () => { jest.advanceTimersByTime(STATUS_POLL_MS); });
      await flush();
      expect(phase()).toBe('ended');
      await expectTelemetryStopped();
    });

    it('telemetry restarts cleanly on a later start() after an error', async () => {
      await startWithTelemetry();
      act(() => emit('onError', { code: 'srt_fatal', message: 'link lost for good', fatal: true }));
      await expectTelemetryStopped();
      const removeSecond = jest.fn();
      let secondCb: ((loc: Fix) => void) | null = null;
      mockedPerm.mockResolvedValueOnce({ granted: true });
      mockedWatch.mockImplementationOnce(async (_opts: unknown, cb: (loc: Fix) => void) => {
        secondCb = cb;
        return { remove: removeSecond };
      });
      mockedCreate.mockResolvedValueOnce(stream(12));
      mockedEnd.mockResolvedValue({ success: true, status: 'ending' });
      let ok = false;
      await act(async () => { ok = await api.start({ ...startArgs, telemetry: true }); });
      await flush();
      expect(ok).toBe(true);
      expect(mockedWatch).toHaveBeenCalledTimes(2);
      act(() => secondCb!(fixAt(2_000_000)));
      await act(async () => { jest.advanceTimersByTime(TELEMETRY_FLUSH_MS); });
      expect(mockedPost).toHaveBeenCalledTimes(1);
      expect(mockedPost.mock.calls[0][0]).toBe(12); // posted against the new stream
    });
  });
});
