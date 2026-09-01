/**
 * SCENARIO 6 — flight data with N programs on one event.
 *
 * Real store + real `useFlightData` against the fake API: incremental `?after=` paging,
 * cancellation when the active program changes mid-flight, the 403-during-transition path with
 * its backoff, the `[]` body a video with no flight points really returns, and no cross-program
 * series contamination.
 *
 * The paging assertions encode two verified backend facts the older fixtures did not:
 *   - `?after=` is STRICT (`FlightPoint.utc > after`, app/models/video.py:get_flight_points)
 *   - an empty tail answers `first/last_flight_point_utc: null` (NOT the previous `after`)
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { loadEvent, setActiveVideo } from '@/features/player/playerSlice';
import { getEvent, getVideoPermissions } from '@/features/player/api';
import { useFlightData } from '@/features/player/hooks/useFlightData';
import { EVENT_ID, PRIMARY_VIDEO_ID, T0, installFakeBackend, type FakeBackend } from './fakeBackend';
import { advance, makeScenarioStore, settle, type ScenarioStore } from './harness';

jest.mock('@/common/api/client', () => {
  const actual = jest.requireActual('@/common/api/client');
  return { ...actual, api: (path: string, opts?: unknown) => require('./fakeBackend').dispatchFakeApi(path, opts) };
});

let backend: FakeBackend;
let store: ScenarioStore;
let renderer: ReactTestRenderer | null = null;
let onForbidden: jest.Mock;

function Probe({ videoId }: { videoId: number | null }) {
  useFlightData(videoId, onForbidden);
  return null;
}

const render = (videoId: number | null) => {
  const el = (
    <Provider store={store}>
      <Probe videoId={videoId} />
    </Provider>
  );
  act(() => {
    if (renderer) renderer.update(el);
    else renderer = create(el);
  });
};

/** Load the event through the real thunk so timeMappers/live state match a real page. */
async function loadRealEvent(): Promise<void> {
  await act(async () => {
    await store.dispatch(loadEvent({ eventId: EVENT_ID }));
  });
  await settle();
  expect(store.getState().player.status).toBe('ready');
}

const flightCalls = () => backend.calls.filter((c) => c.route.endsWith('/flight_data.json'));
const afterParams = () => flightCalls().map((c) => (c.query.after === undefined ? null : Number(c.query.after)));
const requestedIds = () => flightCalls().map((c) => Number(c.route.split('/')[4]));

beforeEach(() => {
  jest.useFakeTimers();
  backend = installFakeBackend();
  store = makeScenarioStore();
  onForbidden = jest.fn();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  if (renderer) act(() => (renderer as ReactTestRenderer).unmount());
  renderer = null;
  jest.useRealTimers();
});

describe('scenario 6 — incremental flight data across programs', () => {
  it('pages with ?after= until the server stops advancing, then polls the live tail', async () => {
    backend.pageSize = 5;
    backend.pushPoints(PRIMARY_VIDEO_ID, 12); // T0 .. T0+11
    await loadRealEvent();
    render(PRIMARY_VIDEO_ID);
    await settle();

    // 3 pages of points + one empty tail (first/last = null) that ends the loop.
    expect(afterParams()).toEqual([null, T0 + 4, T0 + 9, T0 + 11]);
    const map = store.getState().player.mapData;
    expect(map.loc).toHaveLength(12);
    expect(map.firstUtc).toBe(T0);
    expect(map.lastUtc).toBe(T0 + 11);
    expect(map.loc.map(([utc]) => utc)).toEqual(Array.from({ length: 12 }, (_, i) => T0 + i));
    // Graphs are merged per category/name, not concatenated blindly.
    expect(store.getState().graph.data.KLV.Altitude).toHaveLength(12);

    // Live -> the loop re-polls every 7 s and only asks for the tail.
    backend.clearCalls();
    backend.pushPoints(PRIMARY_VIDEO_ID, 3);
    await advance(7_000);
    expect(afterParams()[0]).toBe(T0 + 11);
    expect(store.getState().player.mapData.loc).toHaveLength(15);
    expect(store.getState().player.mapData.lastUtc).toBe(T0 + 14);
  });

  it('a video with no flight points at all (the endpoint answers `[]`) is a no-op, not a crash', async () => {
    await loadRealEvent(); // no points pushed
    render(PRIMARY_VIDEO_ID);
    await settle();
    expect(flightCalls()).toHaveLength(1);
    expect(store.getState().player.mapData.loc).toEqual([]);
    expect(store.getState().player.mapData.lastUtc).toBeNull();
    await advance(21_000); // three live polls later: still nothing appended, still no crash
    expect(store.getState().player.mapData.loc).toEqual([]);
  });

  it('an in-flight response for the program the viewer just left is never applied', async () => {
    backend.serveRequestedVideoPoints = true; // one track per program (see fakeBackend)
    const phone = backend.joinProgram('Mobile · Ben');
    backend.pushPoints(PRIMARY_VIDEO_ID, 10, T0);
    backend.pushPoints(phone.id, 4, T0 + 1000);
    await loadRealEvent();
    backend.hold(`GET /api/v1/videos/${PRIMARY_VIDEO_ID}/flight_data.json`);

    render(PRIMARY_VIDEO_ID);
    await settle();
    expect(store.getState().player.mapData.loc).toHaveLength(0); // still in flight

    // The viewer taps the phone tile while the primary's fetch is pending.
    act(() => {
      store.dispatch(setActiveVideo(phone.id));
    });
    render(phone.id);
    await settle();
    expect(store.getState().player.mapData.loc).toHaveLength(4);

    // The primary's late answer lands: it must NOT be appended under the phone.
    backend.release(`GET /api/v1/videos/${PRIMARY_VIDEO_ID}/flight_data.json`);
    await settle();
    const map = store.getState().player.mapData;
    expect(map.loc).toHaveLength(4);
    expect(map.loc.every(([utc]) => utc >= T0 + 1000)).toBe(true);
    expect(requestedIds()).toEqual([PRIMARY_VIDEO_ID, phone.id, phone.id]);
  });

  it('swapping back and forth keeps each program\'s series separate', async () => {
    backend.serveRequestedVideoPoints = true;
    const phone = backend.joinProgram('Mobile · Ben');
    backend.pushPoints(PRIMARY_VIDEO_ID, 10, T0);
    backend.pushPoints(phone.id, 4, T0 + 1000);
    await loadRealEvent();

    render(PRIMARY_VIDEO_ID);
    await settle();
    expect(store.getState().player.mapData.loc).toHaveLength(10);

    act(() => store.dispatch(setActiveVideo(phone.id)));
    render(phone.id);
    await settle();
    expect(store.getState().player.mapData.loc).toHaveLength(4);
    expect(store.getState().graph.data.KLV.Altitude).toHaveLength(4);

    act(() => store.dispatch(setActiveVideo(PRIMARY_VIDEO_ID)));
    render(PRIMARY_VIDEO_ID);
    await settle();
    const map = store.getState().player.mapData;
    expect(map.loc).toHaveLength(10);
    expect(map.loc.every(([utc]) => utc < T0 + 1000)).toBe(true);
    expect(store.getState().graph.data.KLV.Altitude).toHaveLength(10);
  });

  it('403 mid-transition: the event is refreshed once, then the poll backs off instead of storming', async () => {
    backend.pushPoints(PRIMARY_VIDEO_ID, 5);
    await loadRealEvent();
    // LIVESTREAMS READ is what flight_data checks while the primary is live (VIDEOS READ otherwise).
    backend.flightForbidden = true;
    render(PRIMARY_VIDEO_ID);
    await settle();

    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(flightCalls()).toHaveLength(1);
    // 7 s * 2^n backoff: two minutes of 403s must stay far below the 17 calls a flat 7 s poll makes.
    await advance(120_000, 1_000);
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(flightCalls().length).toBeLessThanOrEqual(5);
    expect(store.getState().player.mapData.loc).toEqual([]);

    // Permission comes back (the transition finished): the next poll resumes normally.
    backend.flightForbidden = false;
    await advance(60_000, 1_000);
    expect(store.getState().player.mapData.loc).toHaveLength(5);
  });

  it('the fetch target is the ACTIVE program even though the backend serves the primary track (LIVE-003)', async () => {
    backend.pushPoints(PRIMARY_VIDEO_ID, 6);
    const phone = backend.joinProgram('Mobile · Ben');
    await loadRealEvent();
    act(() => store.dispatch(setActiveVideo(phone.id)));
    render(phone.id);
    await settle();
    expect(requestedIds()[0]).toBe(phone.id);
    // The points that come back are the primary's — the mobile mitigation is the map's caption.
    expect(store.getState().player.mapData.loc).toHaveLength(6);
    expect(store.getState().player.mapData.firstUtc).toBe(T0);
  });
});

/** Sanity: the fake really is the only boundary (these are the real api modules). */
describe('boundary check', () => {
  it('the real api modules build the documented URLs', async () => {
    await getEvent(EVENT_ID);
    await getVideoPermissions(PRIMARY_VIDEO_ID);
    expect(backend.routes()).toEqual([`/api/v1/events/${EVENT_ID}.json`, `/api/v1/videos/${PRIMARY_VIDEO_ID}/event_id`]);
  });
});
