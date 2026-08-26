import { useCallback, useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import * as Location from 'expo-location';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { EarthscapeLive, addLiveListener, PRESETS, type PublishOptions, type VideoPreset } from '../../../modules/earthscape-live';
import { postTelemetry } from './api';
import {
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
      if (args.telemetry) startTelemetry(stream.id).catch(() => undefined);
      return true;
    },
    [dispatch, startTelemetry],
  );

  /** Stop publishing, flush the last fixes, and tell the server the stream is over. */
  const stop = useCallback(async () => {
    stopTelemetry();
    await EarthscapeLive.stopPublish().catch(() => undefined);
    if (streamId) await queue.current.flush((fixes) => postTelemetry(streamId, fixes)).catch(() => undefined);
    await dispatch(endBroadcast());
  }, [dispatch, stopTelemetry, streamId]);

  const leave = useCallback(async () => {
    stopTelemetry();
    await EarthscapeLive.stopPreview().catch(() => undefined);
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
