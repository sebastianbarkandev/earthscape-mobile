import { useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { appendFlightData } from '../playerSlice';
import { getFlightData } from '../api';

const LIVE_POLL_MS = 7000;

/**
 * Port of the web's fetchMoreFlightPoints loop:
 * initial fetch (server defaults after=video.start), then loop
 * ?after=last_flight_point_utc concatenating series until the server returns
 * no new tail; while live, keep polling on an interval.
 * Note the permission quirk: this endpoint checks LIVESTREAMS READ while the
 * stream is live and VIDEOS READ otherwise (a 403 during transition = reload).
 */
export function useFlightData(videoId: number | null) {
  const dispatch = useAppDispatch();
  const isLive = useAppSelector((s) => s.player.isLive);
  const lastUtcRef = useRef<number | null>(null);
  const inFlight = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!videoId) return;
    cancelled.current = false;
    lastUtcRef.current = null;

    async function fetchLoop() {
      if (inFlight.current || cancelled.current) return;
      inFlight.current = true;
      try {
        let after = lastUtcRef.current ?? undefined;
        // Loop until the server stops advancing last_flight_point_utc.
        // Bounded to avoid runaway loops on malformed data.
        for (let i = 0; i < 200; i++) {
          if (cancelled.current) return;
          const res = await getFlightData(videoId!, after);
          const fd = res?.flight_data;
          if (!fd || fd.last_flight_point_utc == null) break;
          dispatch(appendFlightData(fd));
          if (after !== undefined && fd.last_flight_point_utc <= after) break;
          after = fd.last_flight_point_utc;
          lastUtcRef.current = after;
        }
      } catch (e) {
        // Non-fatal: map simply stops updating; heartbeat handles live<->VOD flips.
        console.warn('flight data fetch failed', e);
      } finally {
        inFlight.current = false;
      }
    }

    fetchLoop();
    const timer = isLive ? setInterval(fetchLoop, LIVE_POLL_MS) : null;
    return () => {
      cancelled.current = true;
      if (timer) clearInterval(timer);
    };
  }, [videoId, isLive, dispatch]);
}
