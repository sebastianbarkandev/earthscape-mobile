/**
 * SCENARIO 4 — one publishing device under stress, end to end against the fake API:
 * create → wait for the live server's listener → publish → SRT drop → reconnect → background →
 * foreground → double-tap on Start → End with a `/end` that fails twice before it lands.
 *
 * Real `useBroadcast` + `broadcastSlice` + `broadcast/api.ts` + `endRetry`/`waitForStarted`;
 * faked: the network (./fakeBackend, whose live routes mirror app/api/live_mobile_api.py), the
 * native publisher (modules/earthscape-live) and expo-location / expo-keep-awake.
 *
 * Invariants asserted: exactly ONE `POST /streams` per broadcast, no orphaned server stream, GPS
 * batches monotonic and stopped in terminal phases, and the location watch released.
 */
import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { useBroadcast } from '@/features/broadcast/useBroadcast';
import { END_MAX_ATTEMPTS } from '@/features/broadcast/broadcastSlice';
import { watchPositionAsync } from 'expo-location';
import { EVENT_ID, PRIMARY_LIVE_STREAM_ID, PRIMARY_VIDEO_ID, installFakeBackend, type FakeBackend } from './fakeBackend';
import { advance, makeScenarioStore, settle, type ScenarioStore } from './harness';

jest.mock('@/common/api/client', () => {
  const actual = jest.requireActual('@/common/api/client');
  return { ...actual, api: (path: string, opts?: unknown) => require('./fakeBackend').dispatchFakeApi(path, opts) };
});

type Listener = (e: unknown) => void;
const mockListeners: Record<string, Listener[]> = {};
const emit = (name: string, e: unknown) => (mockListeners[name] ?? []).forEach((l) => l(e));
jest.mock('../../../modules/earthscape-live', () => ({
  EarthscapeLive: {
    isSupported: true,
    startPublish: jest.fn(() => Promise.resolve()),
    stopPublish: jest.fn(() => Promise.resolve()),
    stopPreview: jest.fn(() => Promise.resolve()),
  },
  addLiveListener: jest.fn((name: string, fn: Listener) => {
    (mockListeners[name] ??= []).push(fn);
    return { remove: () => { mockListeners[name] = (mockListeners[name] ?? []).filter((l) => l !== fn); } };
  }),
  PRESETS: { auto: { width: 1280, height: 720, fps: 30, bitrateKbps: 2500, maxBitrateKbps: 4000, minBitrateKbps: 500 } },
}));
jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(() => Promise.resolve({ granted: true })),
  watchPositionAsync: jest.fn(),
  Accuracy: { BestForNavigation: 6 },
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn(() => Promise.resolve()) }));

const { EarthscapeLive } = require('../../../modules/earthscape-live') as {
  EarthscapeLive: { startPublish: jest.Mock; stopPublish: jest.Mock; stopPreview: jest.Mock };
};
const mockedWatch = watchPositionAsync as unknown as jest.Mock;

const PRESET = { width: 1280, height: 720, fps: 30, bitrateKbps: 2500, maxBitrateKbps: 4000, minBitrateKbps: 500 };
const startArgs = { eventId: EVENT_ID, streamName: 'Mobile · Ana', programType: 'Mobile · Ana', preset: PRESET, latencyMs: 400, telemetry: true };
/** The joining phone's stream: nextStreamId starts one past the primary's. */
const JOINED_STREAM_ID = PRIMARY_LIVE_STREAM_ID + 1;
const JOINED_VIDEO_ID = 201;
const TELEMETRY_FLUSH_MS = 2000;

type Api = ReturnType<typeof useBroadcast>;
function Probe({ onApi }: { onApi: (api: Api) => void }) {
  const api = useBroadcast();
  useEffect(() => onApi(api));
  return null;
}

let backend: FakeBackend;
let store: ScenarioStore;
let renderer: ReactTestRenderer | null = null;
let api!: Api;
let watchCb: ((loc: { coords: { latitude: number; longitude: number; altitude: number | null; heading: number | null }; timestamp: number }) => void) | null;
let removeWatch: jest.Mock;

const phase = () => store.getState().broadcast.phase;
const fix = (timestamp: number) => ({ coords: { latitude: 45.5, longitude: -122.6, altitude: 300, heading: 90 }, timestamp });
const telemetryPosts = () => backend.calls.filter((c) => c.route.endsWith('/telemetry'));

beforeEach(() => {
  jest.useFakeTimers();
  Object.keys(mockListeners).forEach((k) => delete mockListeners[k]);
  backend = installFakeBackend();
  store = makeScenarioStore();
  watchCb = null;
  removeWatch = jest.fn();
  mockedWatch.mockImplementation(async (_opts: unknown, cb: typeof watchCb) => {
    watchCb = cb;
    return { remove: removeWatch };
  });
  act(() => {
    renderer = create(
      <Provider store={store}>
        <Probe onApi={(a) => { api = a; }} />
      </Provider>,
    );
  });
});
afterEach(() => {
  if (renderer) act(() => (renderer as ReactTestRenderer).unmount());
  renderer = null;
  jest.useRealTimers();
});

describe('scenario 4 — publisher lifecycle under stress (a phone joining a live event)', () => {
  it('survives a drop, a reconnect and a background round trip, refuses a double Start, and ends cleanly after two failed /end calls', async () => {
    // ── create: exactly one POST /streams, with the documented body ──
    let ok = false;
    await act(async () => {
      ok = await api.start(startArgs);
    });
    await settle();
    expect(ok).toBe(true);
    const create = backend.calls.filter((c) => `${c.method} ${c.route}` === 'POST /api/v1/live/streams');
    expect(create).toHaveLength(1);
    expect(create[0].body).toEqual({ stream_name: 'Mobile · Ana', event_id: EVENT_ID, program_type: 'Mobile · Ana', latency_ms: 400 });
    // The joined program really is a non-primary program of the SAME event.
    const stream = store.getState().broadcast.stream;
    expect(stream?.id).toBe(JOINED_STREAM_ID);
    expect(stream?.event_id).toBe(EVENT_ID);
    expect(stream?.is_primary).toBe(false);
    expect(stream?.program_type).toBe('Mobile · Ana');
    expect(backend.video(JOINED_VIDEO_ID).is_primary).toBe(false);
    expect(backend.video(PRIMARY_VIDEO_ID).is_primary).toBe(true);
    // The publisher only dials once the live server reports `started` (the "Connecting…" hang fix).
    expect(backend.countRoute(`GET /api/v1/live/streams/${JOINED_STREAM_ID}`)).toBeGreaterThanOrEqual(1);
    expect(EarthscapeLive.startPublish).toHaveBeenCalledTimes(1);
    expect(EarthscapeLive.startPublish.mock.calls[0][0].url).toBe(
      `srt://203.0.113.10:4107?mode=caller&passphrase=pass${JOINED_STREAM_ID}&pbkeylen=16&latency=400`,
    );
    expect(phase()).toBe('ready');

    // ── publish + GPS telemetry ──
    act(() => emit('onStateChange', { state: 'connecting', previous: 'preview' }));
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting' }));
    expect(phase()).toBe('live');
    expect(mockedWatch).toHaveBeenCalledTimes(1);
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(1_000_000)));
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(1_001_000)));
    await advance(TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(1);
    expect(telemetryPosts()[0].route).toBe(`/api/v1/live/streams/${JOINED_STREAM_ID}/telemetry`);
    expect(backend.telemetryBatches(JOINED_STREAM_ID)).toEqual([[1_000_000, 1_001_000]]);

    // ── SRT drop → reconnect: the server stream is kept, nothing is re-created ──
    act(() => emit('onStateChange', { state: 'reconnecting', previous: 'publishing', reason: 'connection lost', attempt: 1, nextRetryMs: 1000 }));
    expect(phase()).toBe('live');
    expect(store.getState().broadcast.reconnectAttempt).toBe(1);
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(1_002_000)));
    act(() => emit('onStateChange', { state: 'publishing', previous: 'reconnecting', reason: 'connected' }));
    expect(store.getState().broadcast.reconnectAttempt).toBe(0);

    // ── background → foreground (link parked, path lost, then restored) ──
    act(() => emit('onNetworkPath', { status: 'unsatisfied', interface: 'none', expensive: false, constrained: false }));
    act(() => emit('onStateChange', { state: 'reconnecting', previous: 'publishing', reason: 'background', attempt: 1, nextRetryMs: 1500 }));
    act(() => emit('onNetworkPath', { status: 'satisfied', interface: 'cellular', expensive: true, constrained: false }));
    act(() => emit('onStateChange', { state: 'publishing', previous: 'reconnecting', reason: 'foreground' }));
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(1_003_000)));
    await advance(TELEMETRY_FLUSH_MS);
    expect(phase()).toBe('live');
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(1); // no second stream, ever

    // ── double-tap on Start while live ──
    let second = true;
    await act(async () => {
      second = await api.start(startArgs);
    });
    expect(second).toBe(false);
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(1);

    // Telemetry batches are monotonic and complete (nothing dropped or re-sent).
    const sent = backend.telemetryBatches(JOINED_STREAM_ID).flat();
    expect(sent).toEqual([1_000_000, 1_001_000, 1_002_000, 1_003_000]);
    expect(sent.every((t, i) => i === 0 || t > sent[i - 1])).toBe(true);

    // ── End: /end fails twice (dying link), then lands ──
    backend.failNext(`POST /api/v1/live/streams/${JOINED_STREAM_ID}/end`, 2, 503, { error: 'gateway' });
    await act(async () => {
      await api.stop();
    });
    await settle();
    expect(phase()).toBe('ending');
    expect(store.getState().broadcast.endAttempts).toBe(1);
    await advance(1_000);
    expect(store.getState().broadcast.endAttempts).toBe(2);
    await advance(2_000);
    expect(phase()).toBe('ended');
    expect(store.getState().broadcast.endAttempts).toBe(0);
    expect(store.getState().broadcast.error).toBeNull();
    expect(backend.countRoute(`POST /api/v1/live/streams/${JOINED_STREAM_ID}/end`)).toBe(3);

    // ── no orphan, no telemetry after the end, GPS released ──
    expect(backend.openStreamIds()).toEqual([PRIMARY_LIVE_STREAM_ID]); // only the aircraft's
    expect(backend.video(JOINED_VIDEO_ID).live_stream_state).toBe('processing');
    expect(removeWatch).toHaveBeenCalledTimes(1);
    backend.clearCalls();
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(1_010_000)));
    await advance(6 * TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(0);
    expect(EarthscapeLive.stopPublish).toHaveBeenCalled();
  });

  it('a fatal publisher error closes the server stream and stops GPS (no orphan, no phantom program)', async () => {
    await act(async () => {
      await api.start(startArgs);
    });
    await settle();
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting' }));
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(2_000_000)));
    await advance(TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(1);

    act(() => emit('onError', { code: 'srt_fatal', message: 'link lost for good srt://h:4107?passphrase=pass501', fatal: true }));
    expect(phase()).toBe('error');
    // SEC-010: the passphrase from the native message never reaches display state.
    expect(store.getState().broadcast.error).not.toContain('pass501');

    // SEC-022: nobody called stop() here — the terminal phase itself must release the GPS watch
    // and the flush loop, or they keep sampling and POSTing to a dead stream.
    expect(removeWatch).toHaveBeenCalledTimes(1);
    backend.clearCalls();
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(2_005_000)));
    await advance(6 * TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(0);

    // Leaving the screen ends the stream server-side so viewers lose the frozen LIVE tile (LIVE-004).
    await act(async () => {
      await api.leave();
    });
    await settle();
    expect(backend.countRoute(`POST /api/v1/live/streams/${JOINED_STREAM_ID}/end`)).toBe(1);
    expect(backend.openStreamIds()).toEqual([PRIMARY_LIVE_STREAM_ID]);
    backend.clearCalls();
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(2_010_000)));
    await advance(6 * TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(0);
  });

  it('the server ending the stream underneath the phone stops the publisher and the GPS watch', async () => {
    await act(async () => {
      await api.start(startArgs);
    });
    await settle();
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting' }));
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(3_000_000)));
    await advance(TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(1);

    // An admin ended it (or the 15-min no-data expiry did): the 4 s status poll sees `ended`.
    backend.endProgram(JOINED_VIDEO_ID);
    await advance(4_000);
    expect(phase()).toBe('ended');
    expect(EarthscapeLive.stopPublish).toHaveBeenCalled();
    expect(removeWatch).toHaveBeenCalledTimes(1);
    backend.clearCalls();
    act(() => (watchCb as NonNullable<typeof watchCb>)(fix(3_005_000)));
    await advance(6 * TELEMETRY_FLUSH_MS);
    expect(telemetryPosts()).toHaveLength(0);
  });

  it('a stream that the live server never starts fails visibly instead of hanging, and leaves nothing open', async () => {
    backend.autoStartStreams = false; // the listener never comes up
    let ok = true;
    let started!: Promise<boolean>;
    act(() => {
      started = api.start(startArgs);
    });
    await advance(21_000, 1_000); // LISTENER_WAIT_MS + a poll
    await act(async () => {
      ok = await started;
    });
    await settle();
    expect(ok).toBe(false);
    expect(EarthscapeLive.startPublish).not.toHaveBeenCalled();
    // The reason reaches `lastEvent`; `error` is NOT asserted here because the immediate
    // endBroadcast() wipes it before the screen can show it — reported as LIVE-026.
    expect(store.getState().broadcast.lastEvent).toContain('server_not_started');
    expect(phase()).toBe('ended');
    expect(backend.countRoute(`POST /api/v1/live/streams/${JOINED_STREAM_ID}/end`)).toBe(1);
    expect(backend.openStreamIds()).toEqual([PRIMARY_LIVE_STREAM_ID]);
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(1);
  });

  it('a permanently failing /end gives up after END_MAX_ATTEMPTS instead of retrying forever', async () => {
    await act(async () => {
      await api.start(startArgs);
    });
    await settle();
    act(() => emit('onStateChange', { state: 'publishing', previous: 'connecting' }));
    backend.failNext(`POST /api/v1/live/streams/${JOINED_STREAM_ID}/end`, 99, 500);
    await act(async () => {
      await api.stop();
    });
    await advance(120_000, 1_000);
    expect(store.getState().broadcast.endAttempts).toBeGreaterThanOrEqual(END_MAX_ATTEMPTS);
    expect(phase()).toBe('ended');
    expect(backend.countRoute(`POST /api/v1/live/streams/${JOINED_STREAM_ID}/end`)).toBe(END_MAX_ATTEMPTS);
  });
});
