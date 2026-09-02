import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError } from '@/common/api/client';
import { getEvent, getFlightData, type EventVideo } from '@/features/player/api';
import { isMobileProgram } from '@/features/player/programs';
import { latestAircraftFix, type AircraftFix } from './groundAir';

/** Aircraft tail poll. Phone telemetry lands in flight points within a few seconds, the aircraft's KLV faster. */
export const TRACK_POLL_MS = 5000;
/** Re-read the event so joining/leaving teammates show up. Same cadence the player uses while live. */
export const EVENT_REFRESH_MS = 20_000;
/** First read asks only for this much history — the overlay wants "now", not the whole flight. */
export const TAIL_WINDOW_S = 90;
/** Other phones tracked at once (each costs one request per tick). */
export const MAX_TEAMMATES = 5;
/** After a 403 (permission flips during the live↔VOD transition) wait this long before asking again. */
const FORBIDDEN_BACKOFF_MS = 15_000;

export interface Teammate {
  videoId: number;
  label: string;
  fix: AircraftFix | null;
}

export interface AircraftTrack {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** The event's primary program (the aircraft), once the event has loaded. */
  primary: { id: number; title: string; live: boolean } | null;
  aircraft: AircraftFix | null;
  /** Other live phones on the event, excluding this one. */
  teammates: Teammate[];
  error: string | null;
}

const IDLE: AircraftTrack = { status: 'idle', primary: null, aircraft: null, teammates: [], error: null };

const errorText = (e: unknown) => (e instanceof Error ? e.message : 'Could not load the aircraft track');
const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

/**
 * Follows the aircraft of a live event for the Go Live screen: the primary program's newest
 * position/heading/target/footprint (5 s tail polls, like the viewer's `useFlightData`) and
 * the other live phones on the event (their own tracks, `?own=1`). Stops when `eventId` is
 * absent or `enabled` is false. `ownVideoId` is only used to hide this phone from the teammates.
 */
export function useAircraftTrack(eventId: number | undefined, ownVideoId: number | null, enabled = true): AircraftTrack {
  const [state, setState] = useState<AircraftTrack>(IDLE);
  const ownRef = useRef(ownVideoId);
  ownRef.current = ownVideoId;

  useEffect(() => {
    if (!eventId || !enabled) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let primary: EventVideo | null = null;
    let programs: EventVideo[] = [];
    let aircraft: AircraftFix | null = null;
    let aircraftAfter: number | undefined;
    const mates = new Map<number, { after: number | undefined; fix: AircraftFix | null }>();
    let lastEventRead = 0;

    setState({ ...IDLE, status: 'loading' });

    const publish = (error: string | null) => {
      if (cancelled) return;
      const teammates: Teammate[] = programs
        .filter((v) => v.id !== ownRef.current)
        .slice(0, MAX_TEAMMATES)
        .map((v) => ({ videoId: v.id, label: v.program_type || v.title || `Camera ${v.id}`, fix: mates.get(v.id)?.fix ?? null }));
      setState({
        status: error && !aircraft ? 'error' : primary ? 'ready' : 'loading',
        primary: primary ? { id: primary.id, title: primary.title, live: primary.live_stream_state === 'live' } : null,
        aircraft,
        teammates,
        error,
      });
    };

    const readEvent = async () => {
      const payload = await getEvent(eventId);
      const ev = payload.events?.[0];
      const videos = ev?.videos ?? [];
      primary = videos.find((v) => v.is_primary) ?? videos[0] ?? null;
      programs = videos.filter((v) => !v.is_primary && v.live_stream_state === 'live' && isMobileProgram(v));
      for (const id of Array.from(mates.keys())) if (!programs.some((v) => v.id === id)) mates.delete(id);
      lastEventRead = Date.now();
    };

    const tick = async () => {
      let delay = TRACK_POLL_MS;
      let error: string | null = null;
      try {
        if (!primary || Date.now() - lastEventRead >= EVENT_REFRESH_MS) await readEvent();
        if (primary) {
          const after = aircraftAfter ?? Math.floor(Date.now() / 1000 - TAIL_WINDOW_S);
          const res = await getFlightData(primary.id, after);
          const fd = res?.flight_data; // a video with no points answers `[]` — no flight_data key
          aircraft = latestAircraftFix(fd, aircraft);
          if (fd?.last_flight_point_utc != null) aircraftAfter = Math.max(after, fd.last_flight_point_utc);
          else aircraftAfter = after;
        }
        const tracked = programs.filter((v) => v.id !== ownRef.current).slice(0, MAX_TEAMMATES);
        await Promise.all(
          tracked.map(async (v) => {
            const m = mates.get(v.id) ?? { after: undefined, fix: null };
            const after = m.after ?? Math.floor(Date.now() / 1000 - TAIL_WINDOW_S);
            try {
              const res = await getFlightData(v.id, after, true);
              const fd = res?.flight_data;
              m.fix = latestAircraftFix(fd, m.fix);
              m.after = fd?.last_flight_point_utc != null ? Math.max(after, fd.last_flight_point_utc) : after;
            } catch {
              /* a teammate's track is best effort */
            }
            mates.set(v.id, m);
          }),
        );
      } catch (e) {
        error = errorText(e);
        if (isForbidden(e)) {
          delay = FORBIDDEN_BACKOFF_MS;
          lastEventRead = 0; // the permission flipped: re-read the event first
        }
      }
      publish(error);
      if (!cancelled) timer = setTimeout(tick, delay);
    };

    tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [eventId, enabled]);

  // Hide this phone once its own video id is known, without restarting the loop.
  return useMemo(() => (ownVideoId == null ? state : { ...state, teammates: state.teammates.filter((t) => t.videoId !== ownVideoId) }), [state, ownVideoId]);
}
