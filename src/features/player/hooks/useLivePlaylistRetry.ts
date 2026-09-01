import { useCallback, useEffect, useRef, useState } from 'react';
import { isCaptureAudioFocusHeld, useCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';

/**
 * A live program's playlist 404s until its first segment exists: `GET /live/{id}/playlist.m3u8`
 * is `abort(404)` while the live server has produced nothing (backend views/live_streams.py), and
 * the URL does NOT change when segments appear. AVPlayer fails such a load once and never retries,
 * and `useVideoPlayer` keys on the (unchanged) source string, so nothing re-creates the player.
 *
 * This hook is the shared half of that recovery — used by BOTH the program tiles (LIVE-023) and
 * the main viewport (LIVE-028), which used to have no status handling at all: swapping the primary
 * to a phone that was still connecting left a permanently black viewport.
 *
 * Bounded on purpose: a stream that never produces segments must not keep reloading forever in the
 * background. LIVE_RETRY_MAX_ATTEMPTS · LIVE_RETRY_MS ≈ 5 minutes. Nothing would ever re-arm it
 * afterwards — the reset keys on the player and a live program's `/live/{id}/playlist.m3u8` never
 * changes — so the spent bound is reported as `exhausted` and `retry()` re-arms it from zero
 * (LIVE-035); a viewport that has stopped trying must not keep claiming it is connecting.
 *
 * LIVE-032/033: "may this player touch the shared audio session right now?" is asked HERE, not by
 * the caller — so every owner of a live player gets the rule and none can forget it (the main
 * viewport did). It is asked TWICE: when a reload is SCHEDULED (a hold means no fetch at all — the
 * second reason the tiles freeze, "two HLS downloads competing with the SRT uplink") and again in
 * the `replaceAsync` callback, which resolves off the main thread hundreds of ms later (expo-video's
 * `VideoPlayer.replaceCurrentItem` awaits the asset load). A hold taken inside that window is
 * invisible to a synchronous gate and would leave the player playing — and, the owner's freeze
 * effect having already run, permanently unfrozen — for the whole broadcast.
 */
export const LIVE_RETRY_MS = 10000;
export const LIVE_RETRY_MAX_ATTEMPTS = 30;
/** Seek past the end of a live playlist: AVPlayer clamps to the live edge (PlayerVideo.goLive). */
export const LIVE_EDGE_SEEK_SEC = 60 * 60 * 24;

export interface LiveRetryPlayer {
  play(): void;
  replaceAsync(source: string): Promise<unknown>;
  addListener(event: 'statusChange', cb: (e: { status: string }) => void): { remove: () => void };
}

interface Options {
  /** Resolved playable URL; '' disables the retry. */
  source: string;
  isLive: boolean;
  /** Owner's veto for the post-reload `play()` (see autoplay.shouldAutoplay). Default: allowed. */
  canPlay?: () => boolean;
}

export function useLivePlaylistRetry(player: LiveRetryPlayer, { source, isLive, canPlay }: Options): {
  status: string;
  /** The source is live and not playable (yet): show "Connecting…" instead of a black rectangle. */
  connecting: boolean;
  /** The bound is spent: still not playable, and nothing further is scheduled (LIVE-035). */
  exhausted: boolean;
  /** Re-arm the bounded loop from zero (a user-visible "tap to retry"). */
  retry: () => void;
} {
  const [status, setStatus] = useState<string>('loading');
  const [attempt, setAttempt] = useState(0);
  const canPlayRef = useRef(canPlay);
  canPlayRef.current = canPlay;
  // LIVE-024/032/033 — see the header: the camera's hold, re-read at fire time below.
  const captureHeld = useCaptureAudioFocusHeld();

  useEffect(() => {
    // A re-created player (source swap) starts unknown again — never inherit the old one's error.
    setStatus('loading');
    setAttempt(0);
    const sub = player.addListener('statusChange', (e: { status: string }) => setStatus(e.status));
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (captureHeld || !isLive || status !== 'error' || !source || attempt >= LIVE_RETRY_MAX_ATTEMPTS) return;
    const t = setTimeout(() => {
      player
        .replaceAsync(source)
        .then(() => {
          if (isCaptureAudioFocusHeld()) return;
          if (canPlayRef.current?.() ?? true) player.play();
        })
        .catch(() => undefined)
        .finally(() => setAttempt((n) => n + 1));
    }, LIVE_RETRY_MS);
    return () => clearTimeout(t);
  }, [player, isLive, status, source, attempt, captureHeld]);

  const retry = useCallback(() => setAttempt(0), []);

  return {
    status,
    connecting: isLive && (status === 'loading' || status === 'error'),
    exhausted: isLive && status === 'error' && attempt >= LIVE_RETRY_MAX_ATTEMPTS,
    retry,
  };
}
