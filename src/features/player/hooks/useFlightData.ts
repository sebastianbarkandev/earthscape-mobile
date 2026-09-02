import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { appendFlightData } from '../playerSlice';
import { appendGraphs } from '../graphSlice';
import { getFlightData } from '../api';
import { ApiError } from '@/common/api/client';

export const LIVE_POLL_MS = 7000;
/** 403 backoff ceiling (the permission quirk below can be a steady state, not a transition). */
export const FORBIDDEN_MAX_MS = 60000;

/**
 * Port of the web's fetchMoreFlightPoints loop:
 * initial fetch (server defaults after=video.start), then loop
 * ?after=last_flight_point_utc concatenating series until the server returns
 * no new tail; while live, keep polling on an interval.
 * Note the permission quirk: this endpoint checks LIVESTREAMS READ while the
 * stream is live and VIDEOS READ otherwise (a 403 during transition = reload).
 *
 * Multi-program: every piece of per-run state (in-flight flag, cancellation,
 * last utc) lives INSIDE the effect closure, keyed to the videoId that started
 * it — a late response from the previous program can never be appended under
 * the new one, and swapping never skips the new program's initial fetch.
 * The store's mapData always belongs to the active video (playerSlice drops it
 * on setActiveVideo / loadEvent), so a re-run for the same video (live<->VOD
 * flip) continues from the store's lastUtc instead of refetching the history.
 */
/**
 * @param onForbidden CLAUDE.md quirk: flight_data checks LIVESTREAMS READ while live and VIDEOS READ
 * otherwise — a 403 mid-transition means "refresh the event", not a client bug. Called once per
 * run; subsequent 403s only back off (7s doubling, capped at 60s) while the video is live.
 * @param own `?own=1`: the video's OWN points (a phone program) instead of the primary's (LIVE-003).
 */
export function useFlightData(videoId: number | null, onForbidden?: () => void, own = false) {
  const dispatch = useAppDispatch();
  const isLive = useAppSelector((s) => s.player.isLive);
  const storeLastUtc = useAppSelector((s) => s.player.mapData.lastUtc);
  const storeLastUtcRef = useRef<number | null>(storeLastUtc);
  storeLastUtcRef.current = storeLastUtc;
  const onForbiddenRef = useRef(onForbidden);
  onForbiddenRef.current = onForbidden;

  useEffect(() => {
    if (!videoId) return;
    const id = videoId;
    let cancelled = false;
    let inFlight = false;
    let lastUtc: number | null = storeLastUtcRef.current;
    let forbiddenCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const schedule = (ms: number) => {
      if (cancelled) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(fetchLoop, ms);
    };

    async function fetchLoop() {
      if (inFlight || cancelled) return;
      inFlight = true;
      let nextDelay: number | null = isLive ? LIVE_POLL_MS : null;
      try {
        let after = lastUtc ?? undefined;
        // Loop until the server stops advancing last_flight_point_utc.
        // Bounded to avoid runaway loops on malformed data.
        for (let i = 0; i < 200; i++) {
          if (cancelled) return;
          const res = await getFlightData(id, after, own);
          if (cancelled) return; // swapped/unmounted while awaiting: never append under another id
          const fd = res?.flight_data;
          if (!fd || fd.last_flight_point_utc == null) break;
          dispatch(appendFlightData(fd));
          if (fd.graphs) dispatch(appendGraphs(fd.graphs));
          if (after !== undefined && fd.last_flight_point_utc <= after) break;
          after = fd.last_flight_point_utc;
          lastUtc = after;
        }
        forbiddenCount = 0;
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 403) {
          if (forbiddenCount === 0) onForbiddenRef.current?.();
          forbiddenCount += 1;
          // Steady-state 403 (VIDEOS but no LIVESTREAMS permission): back off instead of storming.
          nextDelay = isLive ? Math.min(LIVE_POLL_MS * 2 ** forbiddenCount, FORBIDDEN_MAX_MS) : null;
        } else {
          // Non-fatal: map simply stops updating; heartbeat handles live<->VOD flips.
          // Log the status only — an ApiError carries the response body (SEC-018).
          console.warn('flight data fetch failed', e instanceof ApiError ? `HTTP ${e.status}` : e);
        }
      } finally {
        inFlight = false;
        if (nextDelay != null) schedule(nextDelay);
      }
    }

    fetchLoop();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, isLive, own, dispatch]);
}
