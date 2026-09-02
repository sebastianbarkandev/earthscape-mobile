import { useEffect, useRef, useState } from 'react';
import { api } from '@/common/api/client';
import { bearingDeg, distanceM, type LatLon } from '@/common/geo';
import { getFlightData } from '@/features/player/api';
import type { VideoListItem } from '@/features/library/librarySlice';
import { latestAircraftFix } from './groundAir';
import { TAIL_WINDOW_S } from './useAircraftTrack';

/** How often the live list + aircraft positions are re-read while the suggestion is shown. */
export const NEARBY_REFRESH_MS = 30_000;
/** Live streams probed per refresh (one flight_data tail each). */
export const NEARBY_MAX_STREAMS = 5;
/** Beyond this an aircraft is not "nearby" — nothing is suggested. */
export const NEARBY_MAX_M = 15_000;

export interface NearbyAircraft {
  eventId: number;
  videoId: number;
  title: string;
  distanceM: number;
  bearingDeg: number;
}

export interface NearbyLiveEvents {
  status: 'idle' | 'loading' | 'ready';
  /** Closest live aircraft within NEARBY_MAX_M, or null. */
  nearest: NearbyAircraft | null;
  /** Live streams that had a position, nearest first. */
  all: NearbyAircraft[];
}

const IDLE: NearbyLiveEvents = { status: 'idle', nearest: null, all: [] };

/**
 * "An aircraft is streaming near you — add your camera to its event." Reads `/api/v1/live/list`
 * (primaries only — `viewable_live_videos` filters `is_primary`; items carry `event_id` on the
 * earthscape-mobile backend) and the newest flight point of each stream. Only meaningful with a
 * phone position; without one it stays idle.
 */
export function useNearbyLiveEvents(me: LatLon | null, enabled: boolean): NearbyLiveEvents {
  const [state, setState] = useState<NearbyLiveEvents>(IDLE);
  const meRef = useRef(me);
  meRef.current = me;
  const hasMe = !!me;

  useEffect(() => {
    if (!enabled || !hasMe) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState((s) => (s.status === 'idle' ? { ...s, status: 'loading' } : s));

    const tick = async () => {
      try {
        const page = await api<{ items: VideoListItem[] }>('/api/v1/live/list?page=1');
        const items = (page.items ?? [])
          .filter((it) => typeof it.event_id === 'number' && it.live_stream_status !== 'ended' && it.live_stream_status !== 'ending')
          .slice(0, NEARBY_MAX_STREAMS);
        const after = Math.floor(Date.now() / 1000 - TAIL_WINDOW_S);
        const found = await Promise.all(
          items.map(async (it): Promise<NearbyAircraft | null> => {
            try {
              const res = await getFlightData(it.id, after);
              const fix = latestAircraftFix(res?.flight_data, null);
              const here = meRef.current;
              if (!fix || !here) return null;
              return { eventId: it.event_id as number, videoId: it.id, title: it.title, distanceM: distanceM(here, fix.loc), bearingDeg: bearingDeg(here, fix.loc) };
            } catch {
              return null;
            }
          }),
        );
        if (cancelled) return;
        const all = (found.filter(Boolean) as NearbyAircraft[]).sort((a, b) => a.distanceM - b.distanceM);
        const nearest = all[0] && all[0].distanceM <= NEARBY_MAX_M ? all[0] : null;
        setState({ status: 'ready', nearest, all });
      } catch {
        if (!cancelled) setState((s) => ({ ...s, status: 'ready' }));
      }
      if (!cancelled) timer = setTimeout(tick, NEARBY_REFRESH_MS);
    };
    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, hasMe]);

  return state;
}
