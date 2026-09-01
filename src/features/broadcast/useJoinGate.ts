import { useEffect, useState } from 'react';
import { getEvent, getVideoPermissions } from '@/features/player/api';
import { joinGateFor } from './liveGates';
import { msg } from './broadcastSlice';

/**
 * Gate for the `/golive?eventId=` join path (SEC-017). A deep link must not reach
 * "Join live" — or even start the camera — unless the SAME rule the PlayerScreen
 * button applies holds: the event's PRIMARY video is live and the caller may UPDATE
 * it. Everything comes from existing endpoints: `GET /events/{id}.json` gives the
 * primary, `GET /videos/{id}/event_id` its permissions. A server refusal (403/404)
 * is surfaced verbatim and denies.
 */
export type JoinGate =
  | { status: 'none' } // not joining (brand-new event): nothing to check
  | { status: 'checking' }
  | { status: 'allowed'; primaryTitle: string | null }
  | { status: 'denied'; reason: string };

export function useJoinGate(eventId: number | undefined, publishingAvailable: boolean): JoinGate {
  const [gate, setGate] = useState<JoinGate>(() => (eventId ? { status: 'checking' } : { status: 'none' }));

  useEffect(() => {
    if (!eventId) {
      setGate({ status: 'none' });
      return;
    }
    let cancelled = false;
    setGate({ status: 'checking' });
    (async () => {
      try {
        const payload = await getEvent(eventId);
        const videos = payload.events?.[0]?.videos ?? [];
        const primary = videos.find((v) => v.is_primary) ?? null;
        const permissions = primary ? (await getVideoPermissions(primary.id)).permissions : null;
        if (cancelled) return;
        const result = joinGateFor(primary, permissions, publishingAvailable);
        setGate(result.ok ? { status: 'allowed', primaryTitle: primary?.title ?? null } : { status: 'denied', reason: result.reason });
      } catch (e) {
        if (!cancelled) setGate({ status: 'denied', reason: msg(e) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, publishingAvailable]);

  return gate;
}
