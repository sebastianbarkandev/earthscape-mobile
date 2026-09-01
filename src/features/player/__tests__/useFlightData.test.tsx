import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import playerReducer, { loadEvent, setActiveVideo } from '../playerSlice';
import graphReducer from '../graphSlice';
import { FORBIDDEN_MAX_MS, LIVE_POLL_MS, useFlightData } from '../hooks/useFlightData';
import { ApiError } from '@/common/api/client';
import { getFlightData } from '../api';
import { eventPayload, flightData, primary, s1, s2, T0 } from './multiprogramFixtures';

jest.mock('../api', () => ({ getFlightData: jest.fn() }));
const mockedGet = getFlightData as jest.MockedFunction<typeof getFlightData>;

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const makeStore = () => configureStore({ reducer: { player: playerReducer, graph: graphReducer } });
/** Server answer to ?after=<last>: no new points, last_flight_point_utc unchanged. */
const emptyTail = (after: number) => ({ flight_data: { ...flightData(after, 0), first_flight_point_utc: null, last_flight_point_utc: after } });

function Probe({ videoId, onForbidden }: { videoId: number | null; onForbidden?: () => void }) {
  useFlightData(videoId, onForbidden);
  return null;
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useFlightData keyed by video (multi-program swaps)', () => {
  let store: ReturnType<typeof makeStore>;
  let renderer: ReactTestRenderer | null = null;
  let warn: jest.SpyInstance;
  beforeEach(() => {
    jest.useFakeTimers();
    store = makeStore();
    store.dispatch(loadEvent.fulfilled({ event: eventPayload([primary, s1, s2]), video: primary, permissions: null }, 'r', { eventId: 7 }));
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    jest.useRealTimers();
  });

  const render = (videoId: number | null, onForbidden?: () => void) => {
    act(() => {
      const el = (
        <Provider store={store}>
          <Probe videoId={videoId} onForbidden={onForbidden} />
        </Provider>
      );
      if (renderer) renderer.update(el);
      else renderer = create(el);
    });
  };

  it('swap while the old fetch is in flight: new video fetched at once, late old response discarded', async () => {
    const d1 = deferred<{ flight_data: ReturnType<typeof flightData> }>();
    const d2 = deferred<{ flight_data: ReturnType<typeof flightData> }>();
    // Initial fetches are deferred; the loop's ?after= tail calls answer "nothing new".
    mockedGet.mockImplementation((id, after) => (after !== undefined ? Promise.resolve(emptyTail(after)) : id === primary.id ? d1.promise : d2.promise));

    render(primary.id);
    expect(mockedGet).toHaveBeenCalledWith(primary.id, undefined);

    act(() => {
      store.dispatch(setActiveVideo(s2.id));
    });
    render(s2.id);
    expect(mockedGet).toHaveBeenCalledWith(s2.id, undefined);

    // s2 answers first with its own 5 points.
    d2.resolve({ flight_data: flightData(T0 + 1000, 5) });
    await flush();
    // Then the stale primary response lands — it must NOT be appended under s2.
    d1.resolve({ flight_data: flightData(T0, 10) });
    await flush();

    const map = store.getState().player.mapData;
    expect(map.loc).toHaveLength(5);
    expect(map.loc[0][0]).toBe(T0 + 1000);
    expect(map.lastUtc).toBe(T0 + 1004);
  });

  it('live: polls with ?after=lastUtc and keeps the interval keyed to the live video', async () => {
    mockedGet.mockImplementation(async (_id, after) => (after === undefined ? { flight_data: flightData(T0, 5) } : emptyTail(after)));
    act(() => {
      store.dispatch(setActiveVideo(s1.id)); // live
    });
    render(s1.id);
    await flush();
    // Initial fetch, then the loop asks for the tail once (server returns same last utc -> stops).
    expect(mockedGet.mock.calls[0]).toEqual([s1.id, undefined]);
    expect(mockedGet.mock.calls[1]).toEqual([s1.id, T0 + 4]);
    const callsAfterInitial = mockedGet.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(7000);
    });
    await flush();
    expect(mockedGet.mock.calls.length).toBeGreaterThan(callsAfterInitial);
    expect(mockedGet.mock.calls[callsAfterInitial][0]).toBe(s1.id);
    expect(mockedGet.mock.calls[callsAfterInitial][1]).toBe(T0 + 4);
  });

  it('403 while live: onForbidden once, then exponential backoff (no 7s reload storm)', async () => {
    const at: number[] = [];
    mockedGet.mockImplementation(() => {
      at.push(Date.now());
      return Promise.reject(new ApiError(403, {}));
    });
    const onForbidden = jest.fn();
    act(() => {
      store.dispatch(setActiveVideo(s1.id));
    });
    render(s1.id, onForbidden);
    await flush();
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledTimes(1);
    // 30s of fake time: retries at 14s and 42s -> at most one more call within 30s.
    for (let i = 0; i < 30; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await flush();
    }
    // TEST-009: bracket, don't cap — `nextDelay = null` on 403 would satisfy an upper bound
    // alone while freezing the map for the rest of the stream.
    expect(mockedGet.mock.calls.length).toBe(2); // retried once (14s), not twice (no 7s storm)
    expect(onForbidden).toHaveBeenCalledTimes(1);
    // Backoff keeps doubling: ~2 minutes of 403s stays well under a per-7s storm (17 calls)
    // but the hook MUST keep retrying so the map recovers when the permission flip settles.
    for (let i = 0; i < 90; i++) {
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      await flush();
    }
    expect(mockedGet.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(mockedGet.mock.calls.length).toBeLessThanOrEqual(5);
    // The gaps themselves double (7·2ⁿ, capped at 60s) — pinned from the recorded call times.
    const gaps = at.slice(1).map((t, i) => t - at[i]);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < gaps.length; i++) {
      expect(gaps[i]).toBeGreaterThan(gaps[i - 1] * 1.5);
      expect(gaps[i]).toBeLessThanOrEqual(FORBIDDEN_MAX_MS);
    }
    expect(gaps[0]).toBe(LIVE_POLL_MS * 2);
  });

  it('VOD 403: onForbidden once and no polling', async () => {
    mockedGet.mockImplementation(() => Promise.reject(new ApiError(403, {})));
    const onForbidden = jest.fn();
    render(primary.id, onForbidden);
    await flush();
    await act(async () => {
      jest.advanceTimersByTime(120000);
    });
    await flush();
    expect(onForbidden).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });

  /**
   * SEC-018 (TEST-003): the non-403 failure path logs the STATUS, never the ApiError — an
   * ApiError carries the whole parsed response body (event titles, tags, user records), which
   * would land in the device log / Sentry breadcrumbs.
   */
  describe('SEC-018 the flight-data failure warning carries no response body', () => {
    it('an ApiError is logged as "HTTP <status>" only', async () => {
      mockedGet.mockImplementation(() => Promise.reject(new ApiError(500, { secret: 'response-body', videos: [{ title: 'falls_1.ts' }] })));
      render(primary.id);
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual(['flight data fetch failed', 'HTTP 500']);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('falls_1');
    });

    it('a non-ApiError (network failure) still reaches the log', async () => {
      const err = new TypeError('Network request failed');
      mockedGet.mockImplementation(() => Promise.reject(err));
      render(primary.id);
      await flush();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]).toEqual(['flight data fetch failed', err]);
    });

    it('a 403 is not logged at all (it is the handled permission-flip path)', async () => {
      mockedGet.mockImplementation(() => Promise.reject(new ApiError(403, { secret: 'response-body' })));
      render(primary.id, () => undefined);
      await flush();
      expect(warn).not.toHaveBeenCalled();
    });
  });

  it('unmount cancels the loop: a response after unmount is dropped and no timer fires', async () => {
    const d = deferred<{ flight_data: ReturnType<typeof flightData> }>();
    mockedGet.mockImplementation(() => d.promise);
    act(() => {
      store.dispatch(setActiveVideo(s1.id));
    });
    render(s1.id);
    act(() => renderer?.unmount());
    renderer = null;
    d.resolve({ flight_data: flightData(T0, 3) });
    await flush();
    expect(store.getState().player.mapData.loc).toHaveLength(0);
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
