/**
 * SCENARIO 5 — join gating: who may add a camera to an event, and what a refused join looks like.
 *
 * Real `useJoinGate` + `liveGates` + `useBroadcast` + the `/golive` route component against the
 * fake API. Three claims:
 *   a) the deep-link gate (`/golive?eventId=`) decides exactly what the in-app "Add my camera"
 *      button decides — `joinGateFor(primary, primaryPermissions, …)` vs `canAddCameraTo(…)` —
 *      and never lets a `POST /live/streams` out when it refuses (SEC-017);
 *   b) a join the client thought was legal but the server refuses (409, the primary ended in the
 *      meantime) surfaces the SERVER's reason and leaves nothing open;
 *   c) the route itself is gated on `nav_permissions.can_read_livestreams` before any of that
 *      (SEC-005), with no network traffic at all.
 */
import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { useJoinGate, type JoinGate } from '@/features/broadcast/useJoinGate';
import { useBroadcast } from '@/features/broadcast/useBroadcast';
import { canAddCameraTo } from '@/features/broadcast/liveGates';
import { getEvent, getVideoPermissions } from '@/features/player/api';
import GoLiveRoute from '../../../app/golive';
import { EVENT_ID, PRIMARY_LIVE_STREAM_ID, PRIMARY_VIDEO_ID, installFakeBackend, type FakeBackend } from './fakeBackend';
import { makeSignedInStore, settle, type ScenarioStore } from './harness';

jest.mock('@/common/api/client', () => {
  const actual = jest.requireActual('@/common/api/client');
  return { ...actual, api: (path: string, opts?: unknown) => require('./fakeBackend').dispatchFakeApi(path, opts) };
});
const mockRouteParams: { eventId?: string; title?: string; programs?: string } = {};
const mockRedirects: string[] = [];
const mockGoLiveProps: Array<{ eventId?: number; eventTitle?: string; programs?: string[] }> = [];
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useLocalSearchParams: () => mockRouteParams,
  Redirect: ({ href }: { href: string }) => {
    mockRedirects.push(href);
    return null;
  },
}));
// The Go Live screen itself has its own gate tests; here it is a marker for "the route let us in".
jest.mock('@/features/broadcast/GoLiveScreen', () => ({
  GoLiveScreen: (props: { eventId?: number; eventTitle?: string; programs?: string[] }) => {
    mockGoLiveProps.push(props);
    return null;
  },
}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('../../../modules/earthscape-live', () => ({
  EarthscapeLive: {
    isSupported: true,
    startPublish: jest.fn(() => Promise.resolve()),
    stopPublish: jest.fn(() => Promise.resolve()),
    stopPreview: jest.fn(() => Promise.resolve()),
  },
  addLiveListener: jest.fn(() => ({ remove: () => undefined })),
  PRESETS: {},
}));
jest.mock('expo-location', () => ({ requestForegroundPermissionsAsync: jest.fn(async () => ({ granted: false })), watchPositionAsync: jest.fn(), Accuracy: { BestForNavigation: 6 } }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));

const PRESET = { width: 1280, height: 720, fps: 30, bitrateKbps: 2500, maxBitrateKbps: 4000, minBitrateKbps: 500 };

let backend: FakeBackend;
let store: ScenarioStore;
let renderer: ReactTestRenderer | null = null;

function GateProbe({ publishing, onGate }: { publishing: boolean; onGate: (g: JoinGate) => void }) {
  const gate = useJoinGate(EVENT_ID, publishing);
  useEffect(() => onGate(gate));
  return null;
}

/** Run the real deep-link gate and, for comparison, the in-app button's rule on the same data. */
async function gateAndButton(publishing = true): Promise<{ gate: JoinGate; button: boolean }> {
  let gate: JoinGate = { status: 'none' };
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <GateProbe publishing={publishing} onGate={(g) => { gate = g; }} />
      </Provider>,
    );
  });
  await settle();
  const primary = (await getEvent(EVENT_ID)).events[0].videos.find((v) => v.is_primary) ?? null;
  const permissions = primary ? await getVideoPermissions(primary.id).then((r) => r.permissions).catch(() => null) : null;
  return { gate, button: canAddCameraTo(primary, permissions, publishing) };
}

type Api = ReturnType<typeof useBroadcast>;
function BroadcastProbe({ onApi }: { onApi: (api: Api) => void }) {
  const api = useBroadcast();
  useEffect(() => onApi(api));
  return null;
}

beforeEach(() => {
  jest.useFakeTimers();
  backend = installFakeBackend();
  store = makeSignedInStore();
  mockRedirects.length = 0;
  mockGoLiveProps.length = 0;
  delete mockRouteParams.eventId;
  delete mockRouteParams.title;
  delete mockRouteParams.programs;
});
afterEach(() => {
  if (renderer) act(() => (renderer as ReactTestRenderer).unmount());
  renderer = null;
  jest.useRealTimers();
});

describe('scenario 5 — joining an event is gated the same way everywhere', () => {
  it('primary live + UPDATE on it: allowed, and no POST is issued by the gate itself', async () => {
    const { gate, button } = await gateAndButton();
    expect(gate).toEqual({ status: 'allowed', primaryTitle: 'Flight 12' });
    expect(button).toBe(true);
    expect(backend.countRoute(`GET /api/v1/events/${EVENT_ID}.json`)).toBeGreaterThanOrEqual(1);
    expect(backend.countRoute(`GET /api/v1/videos/${PRIMARY_VIDEO_ID}/event_id`)).toBeGreaterThanOrEqual(1);
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(0);
  });

  it('primary no longer live: denied with the reason, and the deep link agrees with the button', async () => {
    backend.endProgram(PRIMARY_VIDEO_ID); // the aircraft landed; the event is `processing`
    const { gate, button } = await gateAndButton();
    expect(gate.status).toBe('denied');
    expect(gate).toMatchObject({ reason: expect.stringContaining('not live any more') });
    expect(button).toBe(false);
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(0);
  });

  it('no videos.update on the primary: blocked before any POST (a read-only member)', async () => {
    backend.setPermissions(PRIMARY_VIDEO_ID, { update: false });
    const { gate, button } = await gateAndButton();
    expect(gate).toEqual({ status: 'denied', reason: "You don't have permission to add a camera to this event." });
    expect(button).toBe(false);
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(0);
  });

  it("a 403 on the primary's permissions denies with the server's reason", async () => {
    backend.setPermissions(PRIMARY_VIDEO_ID, { forbidden: true });
    const { gate } = await gateAndButton();
    expect(gate).toEqual({ status: 'denied', reason: 'Forbidden' });
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(0);
  });

  it('publishing unavailable (unsupported device / live_enabled off) denies regardless of permissions', async () => {
    const { gate, button } = await gateAndButton(false);
    expect(gate.status).toBe('denied');
    expect(gate).toMatchObject({ reason: expect.stringContaining('not available on this device') });
    expect(button).toBe(false);
  });

  it('the server has the last word: a 409 race surfaces its reason and leaves no stream behind', async () => {
    // The gate passed a moment ago...
    const { gate } = await gateAndButton();
    expect(gate.status).toBe('allowed');
    act(() => (renderer as ReactTestRenderer).unmount());
    renderer = null;
    // ...and the primary ends before the phone POSTs its join.
    backend.endProgram(PRIMARY_VIDEO_ID);
    backend.clearCalls();

    let api!: Api;
    act(() => {
      renderer = create(
        <Provider store={store}>
          <BroadcastProbe onApi={(a) => { api = a; }} />
        </Provider>,
      );
    });
    let ok = true;
    await act(async () => {
      ok = await api.start({ eventId: EVENT_ID, streamName: 'Mobile · Ana', programType: 'Mobile · Ana', preset: PRESET, latencyMs: 400, telemetry: false });
    });
    await settle();

    expect(ok).toBe(false);
    expect(store.getState().broadcast.phase).toBe('error');
    // live_mobile_api answers 409 {error: "Event is not live"} — the user sees THAT, not "HTTP 409".
    expect(store.getState().broadcast.error).toBe('Event is not live');
    expect(store.getState().broadcast.stream).toBeNull();
    expect(backend.countRoute('POST /api/v1/live/streams')).toBe(1); // one attempt, no retry storm
    expect(backend.openStreamIds()).toEqual([]); // the primary's own stream is ending, nothing new
    expect(backend.videos.map((v) => v.id)).toEqual([PRIMARY_VIDEO_ID]); // no phantom program joined
  });
});

describe('scenario 5 (cont.) — the /golive deep link is gated before the screen mounts', () => {
  it('a member without can_read_livestreams is redirected and issues no request', async () => {
    store = makeSignedInStore({ nav_permissions: { can_read_livestreams: false } });
    mockRouteParams.eventId = String(EVENT_ID);
    await act(async () => {
      renderer = create(
        <Provider store={store}>
          <GoLiveRoute />
        </Provider>,
      );
    });
    expect(mockRedirects).toEqual(['/(tabs)']);
    expect(mockGoLiveProps).toHaveLength(0);
    expect(backend.calls).toHaveLength(0);
  });

  it('a signed-out deep link goes to login', async () => {
    store = makeSignedInStore({}, false);
    mockRouteParams.eventId = String(EVENT_ID);
    await act(async () => {
      renderer = create(
        <Provider store={store}>
          <GoLiveRoute />
        </Provider>,
      );
    });
    expect(mockRedirects).toEqual(['/login']);
    expect(mockGoLiveProps).toHaveLength(0);
  });

  it('an allowed deep link reaches the SAME screen the in-app button pushes, with the event and its program labels', async () => {
    mockRouteParams.eventId = String(EVENT_ID);
    mockRouteParams.title = 'Flight 12';
    mockRouteParams.programs = JSON.stringify(['Mobile · Ben', 'Mobile · Cy']);
    await act(async () => {
      renderer = create(
        <Provider store={store}>
          <GoLiveRoute />
        </Provider>,
      );
    });
    expect(mockRedirects).toEqual([]);
    expect(mockGoLiveProps[0]).toEqual({ eventId: EVENT_ID, eventTitle: 'Flight 12', programs: ['Mobile · Ben', 'Mobile · Cy'] });
  });

  it('a hostile eventId never becomes a request path', async () => {
    mockRouteParams.eventId = '..%2Fsignout';
    await act(async () => {
      renderer = create(
        <Provider store={store}>
          <GoLiveRoute />
        </Provider>,
      );
    });
    expect(mockGoLiveProps[0]?.eventId).toBeUndefined(); // parseId rejected it -> "new event" mode
    expect(backend.calls).toHaveLength(0);
  });
});

/** The primary's own live stream id is a fixture constant the assertions above lean on. */
it('fixture sanity: the event starts as one live primary program', async () => {
  const payload = await getEvent(EVENT_ID);
  const videos = payload.events[0].videos;
  expect(videos).toHaveLength(1);
  expect(videos[0]).toMatchObject({
    id: PRIMARY_VIDEO_ID,
    is_primary: true,
    live_stream_state: 'live',
    live_stream_id: PRIMARY_LIVE_STREAM_ID,
    hls_stream_url: `/live/${PRIMARY_LIVE_STREAM_ID}/playlist.m3u8`,
    duration: null,
    end: null,
  });
});
