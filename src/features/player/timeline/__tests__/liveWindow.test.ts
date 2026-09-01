/**
 * LIVE-022: a live program has `end`/`duration` NULL, so the timeline extent must follow the
 * LIVE EDGE instead of collapsing to a 1-second ruler with the playhead, the clipmarks and the
 * metadata graphs off-canvas. Reverting timeline/liveExtent.ts (or the selectors that use it)
 * fails every "live" case below; the VOD cases pin the old behaviour so nothing else moved.
 */
import { appendFlightData, loadEvent, refreshEvent, resetZoom, setActiveVideo, setCurrentTime, setZoom } from '../../playerSlice';
import { selectBounds, selectTimeWindow } from '../selectors';
import { extentOf, LIVE_EDGE_STEP_SEC, LIVE_MIN_WINDOW_SEC } from '../liveExtent';
import { makeStore, type TestStore } from '../../__tests__/fixtures';
import { eventPayload, flightData, primary, s1, s2, s3, T0 } from '../../__tests__/multiprogramFixtures';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

function loaded(): TestStore {
  const store = makeStore();
  store.dispatch(loadEvent.fulfilled({ event: eventPayload([primary, s1, s2, s3]), video: primary, permissions: null }, 'r', { eventId: 7 }));
  return store;
}

describe('timeline window across live and VOD (1 primary + 3 live phones)', () => {
  it('VOD primary: the window and bounds are the recording range', () => {
    const st = loaded().getState();
    expect(selectTimeWindow(st)).toEqual({ left: T0, right: T0 + 600 });
    expect(selectBounds(st)).toEqual({ start: T0, end: T0 + 600, duration: 600 });
  });

  it('a live program with no telemetry yet still gets a readable window, not 1 second', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    const st = store.getState();
    expect(st.player.time.end).toBe(st.player.time.start); // the payload really is degenerate
    expect(selectTimeWindow(st)).toEqual({ left: T0, right: T0 + LIVE_MIN_WINDOW_SEC });
    expect(selectBounds(st).duration).toBe(LIVE_MIN_WINDOW_SEC);
  });

  it('the window grows with the flight-data tail, keeping the playhead and clipmarks inside', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    store.dispatch(appendFlightData(flightData(T0, 301))); // last_flight_point_utc = T0 + 300
    store.dispatch(setCurrentTime({ video: 300, utc: T0 + 300 }));
    const win = selectTimeWindow(store.getState());
    expect(win).toEqual({ left: T0, right: T0 + 300 });
    const clipmarkUtc = (s1.clipmarks ?? [])[0].time_start as number;
    expect(clipmarkUtc).toBeGreaterThanOrEqual(win.left);
    expect(clipmarkUtc).toBeLessThanOrEqual(win.right);
  });

  it('with no telemetry the TimeMapper-derived playhead drives the edge, rounded up a step', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s2.id));
    store.dispatch(setCurrentTime({ video: 455, utc: T0 + 455 }));
    expect(selectTimeWindow(store.getState())).toEqual({ left: T0, right: T0 + 460 });
  });

  it('the edge is quantized: 2 Hz ticks inside one step do not produce a new window (RESP-002)', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s3.id));
    store.dispatch(setCurrentTime({ video: 301, utc: T0 + 301 }));
    const first = selectTimeWindow(store.getState());
    store.dispatch(setCurrentTime({ video: 301.5, utc: T0 + 301.5 }));
    expect(selectTimeWindow(store.getState())).toBe(first);
    store.dispatch(setCurrentTime({ video: 311, utc: T0 + 311 }));
    const later = selectTimeWindow(store.getState());
    expect(later).not.toBe(first);
    expect(later.right - first.right).toBe(LIVE_EDGE_STEP_SEC);
  });

  // LIVE-027: `processing` (the transcode window right after a phone taps "End stream") has
  // live_stream_state !== 'live' but duration/end STILL NULL, so the rolling edge must outlast
  // `isLive`. Restoring `if (!p.isLive) return null` in liveEdgeOf fails all three below.
  it('a program that just stopped publishing keeps a readable window for the whole transcode', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    store.dispatch(appendFlightData(flightData(T0, 301)));
    store.dispatch(setCurrentTime({ video: 300, utc: T0 + 300 }));
    expect(selectTimeWindow(store.getState())).toEqual({ left: T0, right: T0 + 300 });

    // The 20s refresh flips it to `processing`: state stays "no usable duration".
    const ended = { ...s1, live_stream_state: 'processing' as const, duration: null, end: null };
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, ended, s2, s3]) }, 'r2', { eventId: 7 }));
    const st = store.getState();
    expect(st.player.isLive).toBe(false);
    expect(st.player.time.end).toBe(st.player.time.start); // the payload really is degenerate
    expect(selectTimeWindow(st)).toEqual({ left: T0, right: T0 + 300 });
    expect(selectBounds(st).duration).toBe(300);
  });

  it('tapping a "Processing…" tile does not collapse the ruler to 1 second', () => {
    const store = loaded();
    const ended = { ...s2, live_stream_state: 'processing' as const, duration: null, end: null };
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, s1, ended, s3]) }, 'r2', { eventId: 7 }));
    store.dispatch(setActiveVideo(ended.id));
    const win = selectTimeWindow(store.getState());
    expect(win.right - win.left).toBe(LIVE_MIN_WINDOW_SEC);
  });

  it('extentOf: no usable duration follows the live edge, a real recording length does not', () => {
    const map = { loc: [], target: [], footprint: [], acft_hdg: [], firstUtc: 1000, lastUtc: 1300 };
    const processing = extentOf({ isLive: false, mapData: map, time: { currentVideo: 0, currentUtc: 1000, start: 1000, end: 1000, duration: null } });
    expect(processing.end).toBeGreaterThanOrEqual(1000 + LIVE_MIN_WINDOW_SEC);
    const vod = extentOf({ isLive: false, mapData: map, time: { currentVideo: 0, currentUtc: 1000, start: 1000, end: 1060, duration: 60 } });
    expect(vod).toEqual({ start: 1000, end: 1060, duration: 60 });
  });

  it('an explicit zoom window wins while live, and resetZoom returns to the grown extent', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    store.dispatch(appendFlightData(flightData(T0, 601))); // edge at T0 + 600
    store.dispatch(setZoom({ left: T0 + 100, right: T0 + 200 }));
    expect(selectTimeWindow(store.getState())).toEqual({ left: T0 + 100, right: T0 + 200 });
    store.dispatch(resetZoom());
    expect(selectTimeWindow(store.getState())).toEqual({ left: T0, right: T0 + 600 });
  });

  it('every one of the three live phones yields a coherent window when swapped to', () => {
    const store = loaded();
    [s1, s2, s3].forEach((phone, i) => {
      store.dispatch(setActiveVideo(phone.id));
      store.dispatch(appendFlightData(flightData(T0, 60 * (i + 1))));
      store.dispatch(setCurrentTime({ video: 60 * (i + 1), utc: T0 + 60 * (i + 1) }));
      const st = store.getState();
      const win = selectTimeWindow(st);
      expect(win.right - win.left).toBeGreaterThanOrEqual(LIVE_MIN_WINDOW_SEC);
      expect(st.player.time.currentUtc).toBeLessThanOrEqual(win.right);
      expect(selectBounds(st).duration).toBe(win.right - win.left);
    });
    // Back to the VOD primary: the recording range again, not a live edge.
    store.dispatch(setActiveVideo(primary.id));
    expect(selectTimeWindow(store.getState())).toEqual({ left: T0, right: T0 + 600 });
  });
});
