import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { EarthscapeLive, addLiveListener, PRESETS, type PublishOptions, type VideoPreset } from '../../../modules/earthscape-live';
import { postTelemetry } from './api';
import {
  beginEnding,
  createBroadcast,
  endBroadcast,
  networkPath,
  publisherError,
  publisherStateChanged,
  publisherStats,
  refreshBroadcast,
  resetBroadcast,
  telemetryProgress,
} from './broadcastSlice';
import { TelemetryQueue, fixFromLocation } from './telemetry';
import { endStreamWithRetry } from './endRetry';
import { LISTENER_POLL_MS, LISTENER_WAIT_MS, waitForStreamStarted } from './waitForStarted';

const KEEP_AWAKE_TAG = 'earthscape-broadcast';
const STATUS_POLL_MS = 4000;
const TELEMETRY_FLUSH_MS = 2000;

export interface StartBroadcastArgs {
  /** Join this live event as an extra program; omit to create a new event. */
  eventId?: number;
  streamName?: string;
  programType?: string;
  preset: VideoPreset;
  /** SRT latency for the phone (ms). 400 is a good cellular default; 200 on solid Wi-Fi. */
  latencyMs: number;
  telemetry: boolean;
}

/**
 * Orchestrates one broadcast: server stream → native SRT publisher → GPS
 * telemetry → status polling, and mirrors everything into the `broadcast` slice.
 * Mount once per Go Live screen.
 */
export function useBroadcast() {
  const dispatch = useAppDispatch();
  const broadcast = useAppSelector((s) => s.broadcast);
  const queue = useRef(new TelemetryQueue());
  const locationSub = useRef<Location.LocationSubscription | null>(null);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamId = broadcast.stream?.id ?? null;
  const live = broadcast.phase === 'live';
  // Latest state for callbacks that must not go stale (start guard, unmount teardown).
  const broadcastRef = useRef(broadcast);
  broadcastRef.current = broadcast;
  /**
   * REG-007: `start()` awaits the listener gate for up to 20 s and the screen can be closed
   * during it. Neither `broadcast` nor `broadcastRef` can be trusted to say so — after unmount
   * react-redux stops re-rendering, so the `resetBroadcast()` from `leave()` never reaches the
   * ref, and a ref that has not re-rendered yet reads a phase from BEFORE this start. These two
   * do: `alive` is false once the screen is gone, and `teardownToken` is bumped by every
   * stop()/leave(), so a start still in its gate knows it has been superseded.
   */
  const alive = useRef(true);
  const teardownToken = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Native publisher events → Redux.
  useEffect(() => {
    const subs = [
      addLiveListener('onStateChange', (e) => dispatch(publisherStateChanged(e))),
      addLiveListener('onStats', (e) => dispatch(publisherStats(e))),
      addLiveListener('onError', (e) => dispatch(publisherError(e))),
      addLiveListener('onNetworkPath', (e) => dispatch(networkPath(e))),
    ];
    return () => subs.forEach((s) => s.remove());
  }, [dispatch]);

  // Server status polling while a stream exists and hasn't ended.
  useEffect(() => {
    if (!streamId || broadcast.phase === 'ended' || broadcast.phase === 'error') return;
    pollTimer.current = setInterval(() => dispatch(refreshBroadcast()), STATUS_POLL_MS);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = null;
    };
  }, [dispatch, streamId, broadcast.phase]);

  // Server says the stream is over (admin ended it, or the 15-min no-data expiry) → stop publishing.
  const serverStatus = broadcast.stream?.status;
  useEffect(() => {
    if ((serverStatus === 'ending' || serverStatus === 'ended') && (broadcast.publisher === 'publishing' || broadcast.publisher === 'reconnecting' || broadcast.publisher === 'connecting')) {
      EarthscapeLive.stopPublish().catch(() => undefined);
    }
  }, [serverStatus, broadcast.publisher]);

  // `/end` failed (the link died exactly when the user tapped End): retry with bounded backoff,
  // and immediately when the network path comes back. The slice keeps phase 'ending' meanwhile.
  useEffect(() => {
    if (broadcast.phase !== 'ending' || !broadcast.error || broadcast.endAttempts === 0) return;
    const delay = Math.min(1000 * 2 ** (broadcast.endAttempts - 1), 15000);
    const t = setTimeout(() => dispatch(endBroadcast()), delay);
    return () => clearTimeout(t);
  }, [dispatch, broadcast.phase, broadcast.error, broadcast.endAttempts]);
  const netStatus = broadcast.network?.status;
  useEffect(() => {
    const b = broadcastRef.current;
    if (netStatus === 'satisfied' && b.phase === 'ending' && b.error) dispatch(endBroadcast());
  }, [dispatch, netStatus]);

  // Keep the screen on while live.
  useEffect(() => {
    if (live) activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    else deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => {
      deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    };
  }, [live]);

  const stopTelemetry = useCallback(() => {
    locationSub.current?.remove();
    locationSub.current = null;
    if (flushTimer.current) clearInterval(flushTimer.current);
    flushTimer.current = null;
  }, []);

  // Terminal phase (fatal publisher error, or the server ended the stream): the publisher is gone
  // and the GPS checkbox is hidden in both phases, so nothing would otherwise stop the
  // BestForNavigation watch and the 2 s flush timer until the user leaves the screen — they would
  // keep sampling location and POSTing to a dead stream (SEC-022). A clean stop() has already
  // flushed by the time it reaches 'ended', so whatever is still queued here is undeliverable: drop
  // it (leave()'s pre-/end flush then sees an empty queue and posts nothing, no duplicate batch).
  const terminal = broadcast.phase === 'ended' || broadcast.phase === 'error';
  useEffect(() => {
    if (!terminal) return;
    stopTelemetry();
    queue.current.clear();
  }, [terminal, stopTelemetry]);

  const startTelemetry = useCallback(
    async (id: number) => {
      stopTelemetry();
      const perm = await Location.requestForegroundPermissionsAsync();
      if (!perm.granted) {
        dispatch(telemetryProgress({ enabled: false }));
        return;
      }
      const q = queue.current;
      locationSub.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 0 },
        (loc) => {
          if (q.push(fixFromLocation(loc))) dispatch(telemetryProgress({ pending: q.pending, lastFixAt: Date.now() }));
        },
      );
      flushTimer.current = setInterval(async () => {
        await q.flush((fixes) => postTelemetry(id, fixes));
        dispatch(telemetryProgress({ sent: q.sent, pending: q.pending, failures: q.failures }));
      }, TELEMETRY_FLUSH_MS);
    },
    [dispatch, stopTelemetry],
  );

  /** Create the server-side stream (new event or join) and connect the publisher. */
  const start = useCallback(
    async (args: StartBroadcastArgs) => {
      // Phase guard (LIVE-005): one server stream per screen. 'ready' (created, publisher not yet
      // connected) and 'ending' (stop in progress) both re-enable the button briefly without this.
      const current = broadcastRef.current;
      if (current.phase === 'creating' || current.phase === 'ready' || current.phase === 'live' || current.phase === 'ending') return false;
      const token = teardownToken.current;
      const orphan = current.stream;
      if (orphan && orphan.status !== 'ended' && orphan.status !== 'ending') {
        // A fatal publisher error left a server stream open: close it before opening another.
        endStreamWithRetry(orphan.id).catch(() => undefined);
      }
      queue.current = new TelemetryQueue();
      const created = await dispatch(
        createBroadcast({
          stream_name: args.streamName,
          event_id: args.eventId,
          program_type: args.programType ?? 'Mobile',
          latency_ms: args.latencyMs,
        }),
      );
      if (!createBroadcast.fulfilled.match(created)) return false;
      const stream = created.payload;
      // Don't dial until the live server reports the listener up (`started`): the
      // caller handshake against a port nobody listens on yet can hang in
      // "Connecting…" instead of failing (seen 2026-08-27 after a 12 h idle).
      if (stream.status !== 'started') {
        const outcome = await waitForStreamStarted(
          async () => {
            const r = await dispatch(refreshBroadcast());
            return refreshBroadcast.fulfilled.match(r) ? r.payload : null;
          },
          { timeoutMs: LISTENER_WAIT_MS, intervalMs: LISTENER_POLL_MS },
        );
        // Did the user leave / stop while we were waiting? `leave()` has already stopped the
        // preview, ended the server stream and reset the slice by now, so resuming would
        // publish to a dead stream and — worse — open a BestForNavigation GPS watch plus a 2 s
        // telemetry interval that nothing can ever clear, because the teardown that owns them
        // has already run (REG-007). This has to cover the 'started' outcome too: that path
        // used to fall straight through to startPublish + startTelemetry.
        if (!alive.current || teardownToken.current !== token) return false;
        if (outcome !== 'started') {
          const phaseNow = broadcastRef.current.phase;
          // The user already left / stopped while we were waiting — nothing to report.
          if (phaseNow === 'ending' || phaseNow === 'ended' || phaseNow === 'idle') return false;
          dispatch(
            publisherError({
              code: outcome === 'ended' ? 'server_ended_early' : 'server_not_started',
              message:
                outcome === 'ended'
                  ? 'The live server ended the stream before it started. Try again.'
                  : 'The live server did not start the stream in time. Check that live streaming is available and try again.',
              fatal: true,
            }),
          );
          dispatch(endBroadcast());
          return false;
        }
      }
      const options: PublishOptions = {
        url: stream.ingest.url,
        preset: args.preset,
        audioBitrateKbps: 96,
        keyframeIntervalSec: 2,
        adaptiveBitrate: true,
        autoReconnect: true,
        maxReconnectAttempts: 0,
      };
      try {
        await EarthscapeLive.startPublish(options);
      } catch (e) {
        dispatch(publisherError({ code: 'start_failed', message: e instanceof Error ? e.message : 'Could not start publishing', fatal: true }));
        // Don't leave a dangling server stream.
        dispatch(endBroadcast());
        return false;
      }
      // Same window, one await later: `startPublish` can also resolve after the screen is gone.
      if (args.telemetry && alive.current && teardownToken.current === token) startTelemetry(stream.id).catch(() => undefined);
      return true;
    },
    [dispatch, startTelemetry],
  );

  /** Stop publishing, flush the last fixes, and tell the server the stream is over. */
  const stop = useCallback(async () => {
    teardownToken.current += 1; // supersede a start() still waiting on the listener gate (REG-007)
    dispatch(beginEnding()); // before the native 'preview' event can bounce the phase back to 'ready'
    stopTelemetry();
    await EarthscapeLive.stopPublish().catch(() => undefined);
    if (streamId) await queue.current.flush((fixes) => postTelemetry(streamId, fixes)).catch(() => undefined);
    await dispatch(endBroadcast());
  }, [dispatch, stopTelemetry, streamId]);

  /**
   * Screen unmount / back gesture / deep link away. Stops the camera and — if a server
   * stream is still open (ready, live, a stuck 'ending', or a fatal error) — ends it with
   * detached bounded retries, so viewers never keep a black/frozen LIVE tile for 15 minutes (LIVE-004).
   */
  const leave = useCallback(async () => {
    teardownToken.current += 1; // supersede a start() still waiting on the listener gate (REG-007)
    stopTelemetry();
    const b = broadcastRef.current;
    const id = b.stream?.id;
    const status = b.stream?.status;
    const needsEnd = id != null && b.phase !== 'ended' && status !== 'ended' && status !== 'ending';
    await EarthscapeLive.stopPreview().catch(() => undefined);
    if (id != null && needsEnd) {
      const q = queue.current;
      q.flush((fixes) => postTelemetry(id, fixes))
        .catch(() => undefined)
        .then(() => endStreamWithRetry(id))
        .catch(() => undefined);
    }
    dispatch(resetBroadcast());
  }, [dispatch, stopTelemetry]);

  useEffect(() => () => stopTelemetry(), [stopTelemetry]);

  const confirmStop = useCallback(() => {
    Alert.alert('End live stream?', 'Viewers will see the stream end and the recording will be processed.', [
      { text: 'Keep streaming', style: 'cancel' },
      { text: 'End stream', style: 'destructive', onPress: () => { stop().catch(() => undefined); } },
    ]);
  }, [stop]);

  return { broadcast, start, stop, confirmStop, leave, presets: PRESETS };
}
