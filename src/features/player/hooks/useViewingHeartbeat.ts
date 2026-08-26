import { useEffect, useRef } from 'react';
import { postViewing } from '../api';

const HEARTBEAT_MS = 5000;

/**
 * Mirrors the web's sendViewingStatus 5s loop. The response's liveStreamState
 * is the transition signal: when it changes (live -> ended, or VOD -> live),
 * the caller reloads the event so the player source swaps (the event payload's
 * hls_stream_url changes between live playlist and VOD HLS).
 */
export function useViewingHeartbeat(
  videoId: number | null,
  currentLiveState: string | null,
  onLiveStateChanged: (next: string | null) => void,
  /** Read at each tick; the server only records a viewing session while not paused. */
  isPaused: () => boolean = () => false,
) {
  const stateRef = useRef<string | null>(currentLiveState);
  stateRef.current = currentLiveState;

  useEffect(() => {
    if (!videoId) return;
    let stopped = false;

    const tick = async () => {
      try {
        const res = await postViewing(videoId, isPaused());
        if (stopped) return;
        const next = res.liveStreamState ?? null;
        if (stateRef.current !== null && next !== stateRef.current) {
          onLiveStateChanged(next);
        }
      } catch {
        /* heartbeat is best-effort */
      }
    };

    const timer = setInterval(tick, HEARTBEAT_MS);
    tick();
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, onLiveStateChanged]);
}
