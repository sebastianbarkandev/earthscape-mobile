import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Keyboard, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { Icon, type IconName } from '@/common/components/Icon';
import { EmptyState } from '@/common/components/EmptyState';
import { formatTime } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { EarthscapeLive, EarthscapeLivePreviewView, PRESETS, type PermissionStatus, type VideoPreset } from '../../../modules/earthscape-live';
import { useBroadcast } from './useBroadcast';
import { END_MAX_ATTEMPTS, endBroadcast, setTelemetryEnabled } from './broadcastSlice';
import { defaultProgramLabel } from './programLabel';
import { useJoinGate } from './useJoinGate';
import { useHoldCaptureAudioFocus } from './audioFocus';
import { bannerTop, bottomBarInset, bottomBlockMaxHeight } from './goLiveChrome';
import { useKeyboardHeight } from '@/common/hooks/useKeyboardHeight';
import { edgeOffset, edgePadding } from '@/common/layout';
import { touchSlop, verticalTouchSlop } from '@/common/touchTarget';
import { poseSource } from './pose/poseSource';
import { AirLinkOverlay } from './airlink/AirLinkOverlay';

interface Props {
  /** Join this live event as an additional program. */
  eventId?: number;
  eventTitle?: string;
  /** Labels of the programs already on that event — the default camera name is de-duplicated against them. */
  programs?: string[];
}

type Quality = keyof typeof PRESETS;
const QUALITY_LABEL: Record<Quality, string> = { auto: 'Auto', '1080p': '1080p', '720p': '720p', '480p': '480p' };
const LATENCY = [
  { label: 'Cellular · 400 ms', ms: 400, hint: 'Best on LTE/5G: absorbs jitter and short dropouts.' },
  { label: 'Fast · 200 ms', ms: 200, hint: 'Solid Wi-Fi only.' },
  { label: 'Robust · 800 ms', ms: 800, hint: 'Poor coverage, moving fast.' },
];
/** Height of the "Adding your camera to" banner + gap, so the ground↔air card sits under it. */
const AIRLINK_BELOW_BANNER = 40;

/**
 * Phone-as-source. Camera preview + Go Live. Two modes: create a new live event,
 * or join the event you came from as an extra program (shown side by side on
 * every viewer). The native engine handles SRT, ABR and reconnects; this screen
 * shows the truth about the link and never hides a degraded state.
 */
export function GoLiveScreen({ eventId, eventTitle, programs }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const landscape = width > height;
  // Landscape iPhones carry the notch / Dynamic Island on the sides (RESP-006): keep the
  // close button, status pill, banner and controls out of the cut-out and the rounded corners.
  const sideInsets = edgePadding(insets, 12);
  // RESP-030: the centred cards and the plain top bar of the early-return states are the ONLY
  // exit from this route (`fullScreenModal`, `gestureEnabled: false`, no header), so their own
  // gutters have to clear the strip too — an absolutely positioned card needs it on left/right.
  const cardInsets = edgeOffset(insets, 24);
  // UI-001: the controls are absolutely positioned over the preview, so no
  // KeyboardAvoidingView can reach them — lift the bar by the keyboard height ourselves.
  const keyboardHeight = useKeyboardHeight();
  // LIVE-024: this screen owns the phone's audio session — startPreview() below puts it in
  // .playAndRecord/.videoRecording for the mic. expo-video re-asserts a process-wide .playback
  // session on ANY player state change (see audioFocus.ts), so every other player in the app
  // (the player screen's ProgramStrip tiles) freezes while this hold is held. Taken on mount,
  // i.e. BEFORE the preview claims the session, and released when the screen goes away.
  useHoldCaptureAudioFocus();
  const { broadcast, start, confirmStop, leave, retryTelemetry } = useBroadcast();
  const liveEnabled = useAppSelector((s) => s.auth.bootstrap?.features?.live_enabled ?? true);
  const user = useAppSelector((s) => s.auth.bootstrap?.current_user ?? null);
  const [perm, setPerm] = useState<PermissionStatus | null>(null);
  const [quality, setQuality] = useState<Quality>('auto');
  const [latency, setLatency] = useState(LATENCY[0]);
  // Joining phones get a distinguishing default ("Mobile · <first name>", numbered on collision);
  // it is sent as stream_name AND program_type so tiles and recordings tell the cameras apart.
  const [name, setName] = useState(() => (eventId ? defaultProgramLabel(user, programs ?? []) : ''));
  const [camera, setCamera] = useState<'back' | 'front'>('back');
  const [torch, setTorch] = useState(false);
  const [muted, setMuted] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  // Settings start collapsed in landscape: the ~270pt block would cover ~70% of a 393pt-tall preview.
  const [controlsOpen, setControlsOpen] = useState(() => !landscape);
  const supported = EarthscapeLive.isSupported;
  const preset: VideoPreset = PRESETS[quality];
  // SEC-017: the deep-link join path runs the same gate as the PlayerScreen button (primary live + UPDATE on it).
  // Until it passes, neither the camera nor "Join live" starts; a denial shows the reason instead of the preview.
  const joinGate = useJoinGate(eventId, supported && liveEnabled);
  const gateReady = joinGate.status === 'none' || joinGate.status === 'allowed';
  // SEC-017, second layer: `onStart` must read the gate as it is WHEN THE PRESS LANDS. A press
  // handler captured while the gate said `allowed` (a finger already down when the event ends,
  // or a render the gate answer has not reached yet) would otherwise close over a stale
  // `allowed` and post the join anyway.
  const gateStatusRef = useRef(joinGate.status);
  gateStatusRef.current = joinGate.status;

  const phase = broadcast.phase;
  const publisher = broadcast.publisher;
  const isLive = phase === 'live';
  const busy = phase === 'creating' || phase === 'ending';

  // Permissions + camera preview on mount (join: once the gate allows it); tear everything down on unmount.
  useEffect(() => {
    if (!supported || !gateReady) return;
    let cancelled = false;
    (async () => {
      const p = await EarthscapeLive.requestPermissions();
      if (cancelled) return;
      setPerm(p);
      if (p.camera === 'granted') {
        try {
          await EarthscapeLive.startPreview({ camera, orientation: 'auto', preset });
        } catch (e) {
          setPreviewError(e instanceof Error ? e.message : 'Could not start the camera');
        }
      }
    })();
    return () => {
      cancelled = true;
      leave().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, gateReady]);

  const onStart = useCallback(async () => {
    if (eventId && gateStatusRef.current !== 'allowed') return; // SEC-017: never POST a join the gate refused
    if (!perm || perm.camera !== 'granted') {
      Alert.alert('Camera required', 'Allow camera access in Settings to go live.', [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel' }]);
      return;
    }
    const label = name.trim() || undefined;
    await start({ eventId, streamName: label, programType: eventId ? label : undefined, preset, latencyMs: latency.ms, telemetry: broadcast.telemetry.enabled });
  }, [perm, start, eventId, joinGate.status, name, preset, latency.ms, broadcast.telemetry.enabled]);

  /**
   * The one affordance for a GPS denial. It has to live in the UNCONDITIONAL hint area below
   * the stats: the "GPS" stat itself only renders while `controlsOpen`, which starts false in
   * landscape — the phone-on-a-mount orientation where this is most likely to be noticed.
   */
  const onEnableGps = useCallback(() => { retryTelemetry().catch(() => undefined); }, [retryTelemetry]);

  const onToggleTelemetry = useCallback(() => {
    const next = !broadcast.telemetry.enabled;
    dispatch(setTelemetryEnabled(next));
    // A remembered iOS denial is answered silently, so flipping the intent alone would leave
    // GPS off with no prompt and no explanation: ask again (or open Settings) right here.
    if (next && broadcast.telemetry.denied) retryTelemetry().catch(() => undefined);
  }, [broadcast.telemetry.enabled, broadcast.telemetry.denied, dispatch, retryTelemetry]);

  const onClose = useCallback(() => {
    if (isLive || phase === 'creating') {
      Alert.alert('You are live', 'End the stream before leaving?', [
        { text: 'Stay', style: 'cancel' },
        { text: 'End & leave', style: 'destructive', onPress: () => { confirmStop(); } },
      ]);
      return;
    }
    router.back();
  }, [isLive, phase, confirmStop, router]);

  // A streaming aircraft is nearby: become a program of ITS event instead of opening a new one.
  // Same route with join params — this screen unmounts (preview stops, nothing to end yet) and
  // the join gate (SEC-017) runs exactly as it does for "Add my camera".
  const onJoinNearby = useCallback((id: number, title: string) => {
    router.replace({ pathname: '/golive', params: { eventId: String(id), title } } as never);
  }, [router]);

  const flip = async () => {
    try {
      const next = await EarthscapeLive.switchCamera();
      setCamera(next);
      poseSource.setCamera(next); // the footprint follows the lens that publishes (front looks back at the user)
      if (next === 'front' && torch) setTorch(false);
    } catch { /* ignore */ }
  };
  const toggleTorch = async () => { const v = !torch; setTorch(v); await EarthscapeLive.setTorch(v).catch(() => undefined); };
  const toggleMute = async () => { const v = !muted; setMuted(v); await EarthscapeLive.setMuted(v).catch(() => undefined); };

  const status = useMemo(() => {
    if (phase === 'creating') return { label: 'Preparing stream…', color: theme.textOnAccent, bg: theme.overlayBg };
    if (phase === 'ending') return { label: broadcast.error ? 'Ending — retrying…' : 'Ending…', color: theme.textOnAccent, bg: theme.overlayBg };
    if (phase === 'ended') return broadcast.fatalReason
      ? { label: 'Stopped', color: theme.textOnAccent, bg: theme.danger }
      : { label: 'Ended', color: theme.textOnAccent, bg: theme.overlayBg };
    if (phase === 'error') return { label: 'Error', color: theme.textOnAccent, bg: theme.danger };
    // 'ready' + a server stream still 'starting' = waiting (up to 20s) for the live server to
    // claim the stream; a bare "Ready" pill would misreport that window.
    if (phase === 'ready' && broadcast.stream?.status === 'starting') return { label: 'Waiting for live server…', color: theme.textOnAccent, bg: theme.overlayBg };
    switch (publisher) {
      case 'connecting': return { label: 'Connecting…', color: theme.textOnAccent, bg: theme.accentActive };
      case 'reconnecting': return { label: `Reconnecting${broadcast.reconnectAttempt ? ` (${broadcast.reconnectAttempt})` : ''}…`, color: theme.textOnAccent, bg: theme.warning };
      case 'publishing': return { label: `LIVE ${formatTime(broadcast.stats?.elapsedSec ?? 0, false)}`, color: theme.textOnAccent, bg: theme.liveRed };
      default: return { label: eventId ? 'Ready to join' : 'Ready', color: theme.textOnAccent, bg: theme.overlayBg };
    }
  }, [phase, publisher, broadcast.reconnectAttempt, broadcast.stats?.elapsedSec, broadcast.error, broadcast.fatalReason, broadcast.stream?.status, eventId]);

  if (!supported) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <TopBar onClose={() => router.back()} title="Go live" inset={sideInsets} />
        <EmptyState title="Live publishing isn't available on this device" detail="Streaming from the phone is iOS-only for now and needs a build that includes the EarthscapeLive module." />
      </View>
    );
  }
  if (!liveEnabled) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <TopBar onClose={() => router.back()} title="Go live" inset={sideInsets} />
        <EmptyState title="Live streaming is disabled" detail="Your organization has live streaming turned off." />
      </View>
    );
  }
  if (joinGate.status === 'denied') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <TopBar onClose={() => router.back()} title="Add my camera" inset={sideInsets} />
        <EmptyState title="You can't add a camera to this event" detail={joinGate.reason} />
      </View>
    );
  }
  if (joinGate.status === 'checking') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <TopBar onClose={() => router.back()} title="Add my camera" inset={sideInsets} />
        <View style={styles.checking}><ActivityIndicator color={theme.accent} /></View>
      </View>
    );
  }

  const net = broadcast.network;
  const stats = broadcast.stats;
  const s = broadcast.stream;
  // LIVE-031: a fatal failure (listener never came up, server ended it early, startPublish rejected)
  // is followed at once by POST /end, whose reducers clear `error` — `fatalReason` is the surviving
  // cause and must be what the user reads, with the /end trouble (if any) as a secondary line.
  const fatalReason = broadcast.fatalReason;
  const endTrouble = broadcast.error && broadcast.error !== fatalReason ? broadcast.error : null;
  const endedDetail = fatalReason
    ? `${fatalReason}${endTrouble ? ` The server could not be told the stream ended (${endTrouble}); it closes streams without data automatically after 15 minutes.` : ''}`
    : broadcast.error
      ? `The server could not be told the stream ended (${broadcast.error}). It closes streams without data automatically after 15 minutes.`
      : `The recording is being processed and will appear in the library. ${broadcast.telemetry.sent ? `${broadcast.telemetry.sent} GPS fixes were attached.` : ''}`;

  return (
    <View style={styles.screen}>
      {/* Full-bleed dark preview: the app-wide dark status bar would be unreadable here (RESP-007). */}
      <StatusBar style="light" />
      <EarthscapeLivePreviewView style={StyleSheet.absoluteFill} videoGravity="resizeAspectFill" />

      {/* Top bar */}
      <View testID="golive-top" style={[styles.top, { paddingTop: insets.top + 6 }, sideInsets]} pointerEvents="box-none">
        <Pressable onPress={onClose} style={styles.roundBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close"><Icon name="xmark" size={16} color={theme.overlayText} /></Pressable>
        <View style={[styles.pill, { backgroundColor: status.bg }]} accessibilityRole="text" accessibilityLiveRegion="polite">
          {publisher === 'publishing' && <View style={styles.liveDot} />}
          <Text style={[styles.pillText, { color: status.color }]} {...denseText}>{status.label}</Text>
        </View>
        <View style={styles.netBadge}>
          <Icon name={net?.interface === 'cellular' ? 'signal' : net?.interface === 'wifi' ? 'wifi' : 'globe'} size={12} color={net && net.status !== 'satisfied' ? theme.danger : theme.overlayText} />
          {stats && isLive ? <Text style={styles.netText} {...denseText}>{Math.round(stats.sendRateKbps)} kbps · {Math.round(stats.rttMs)} ms</Text> : null}
        </View>
      </View>

      {eventId ? (
        <View style={[styles.banner, { top: bannerTop(insets), left: sideInsets.paddingLeft, right: sideInsets.paddingRight }]} pointerEvents="none">
          <Icon name="layer-group" size={12} color={theme.overlayText} />
          <Text style={styles.bannerText} numberOfLines={1}>Adding your camera to: {eventTitle ?? `event ${eventId}`}</Text>
        </View>
      ) : null}
      {/* Ground <-> air: in-frame / bearing to the aircraft's target / teammates (join), or the
          nearest streaming aircraft to join (new event). Sits under the banner, above the cards. */}
      <AirLinkOverlay
        eventId={eventId}
        ownVideoId={s?.video_id ?? null}
        telemetryEnabled={broadcast.telemetry.enabled}
        visible={perm?.camera === 'granted' && !previewError && phase !== 'ended' && phase !== 'error'}
        top={bannerTop(insets) + (eventId ? AIRLINK_BELOW_BANNER : 0)}
        sideInsets={{ paddingLeft: sideInsets.paddingLeft, paddingRight: sideInsets.paddingRight }}
        landscape={landscape}
        onJoinNearby={!isLive && !busy ? onJoinNearby : undefined}
      />

      {perm && perm.camera !== 'granted' && (
        <View style={[styles.centerCard, cardInsets]}>
          <Icon name="camera" size={22} color={theme.textSecondary} />
          <Text style={styles.cardTitle}>Camera access needed</Text>
          <Text style={styles.cardText}>Allow the camera (and microphone) in Settings to stream from this phone.</Text>
          <Pressable hitSlop={touchSlop(40)} style={styles.primary} onPress={() => Linking.openSettings()}><Text style={styles.primaryText}>Open Settings</Text></Pressable>
        </View>
      )}
      {previewError && perm?.camera === 'granted' && (
        <View style={[styles.centerCard, cardInsets]}>
          <Text style={styles.cardTitle}>Camera unavailable</Text>
          <Text style={styles.cardText}>{previewError}</Text>
        </View>
      )}

      {phase === 'ended' && (
        <View style={[styles.centerCard, cardInsets]}>
          <Icon name={fatalReason ? 'triangle-exclamation' : 'circle-check'} size={22} color={fatalReason ? theme.danger : theme.success} />
          <Text style={styles.cardTitle}>{fatalReason ? 'Stream stopped' : 'Stream ended'}</Text>
          <Text style={styles.cardText}>{endedDetail}</Text>
          <View style={styles.row}>
            {s?.event_id ? (
              <Pressable hitSlop={touchSlop(40)} style={styles.secondary} onPress={() => router.replace({ pathname: '/video/[eventId]', params: { eventId: String(s.event_id), videoId: String(s.video_id ?? '') } } as never)}>
                <Text style={styles.secondaryText}>View event</Text>
              </Pressable>
            ) : null}
            <Pressable hitSlop={touchSlop(40)} style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Done</Text></Pressable>
          </View>
        </View>
      )}
      {phase === 'ending' && (broadcast.error || fatalReason) && (
        <View style={[styles.centerCard, cardInsets]}>
          <Icon name="triangle-exclamation" size={22} color={theme.danger} />
          <Text style={styles.cardTitle}>{broadcast.error ? "Couldn't end the stream" : 'Stream stopped'}</Text>
          {fatalReason ? <Text style={styles.cardText}>{fatalReason}</Text> : null}
          {broadcast.error ? <Text style={styles.cardText}>{`${broadcast.error} — retrying (${broadcast.endAttempts}/${END_MAX_ATTEMPTS})…`}</Text> : null}
          <View style={styles.row}>
            <Pressable hitSlop={touchSlop(40)} style={styles.secondary} onPress={() => router.back()}><Text style={styles.secondaryText}>Leave</Text></Pressable>
            <Pressable hitSlop={touchSlop(40)} style={styles.primary} onPress={() => dispatch(endBroadcast())}><Text style={styles.primaryText}>Retry now</Text></Pressable>
          </View>
        </View>
      )}
      {phase === 'error' && (broadcast.error || fatalReason) && (
        <View style={[styles.centerCard, cardInsets]}>
          <Icon name="triangle-exclamation" size={22} color={theme.danger} />
          <Text style={styles.cardTitle}>Stream problem</Text>
          <Text style={styles.cardText}>{broadcast.error ?? fatalReason}</Text>
          <Pressable hitSlop={touchSlop(40)} style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Close</Text></Pressable>
        </View>
      )}

      {/* Bottom sheet: settings before start, stats + controls while live */}
      {/* RESP-026: the block grows upward from `bottom: keyboardHeight`, so it is capped at the
          room actually left above the keyboard and below the top bar — without the cap the
          settings pushed the camera-name field off the top of a landscape screen. */}
      <View testID="golive-bottom" style={[styles.bottom, bottomBarInset(keyboardHeight, insets.bottom), sideInsets, { maxHeight: bottomBlockMaxHeight({ height, keyboardHeight, insetsTop: insets.top }) }]}>
        {isLive && stats && controlsOpen && (
          <Pressable
            testID="golive-stats"
            onPress={() => setControlsOpen((v) => !v)}
            style={styles.statsRow}
            accessibilityRole="button"
            accessibilityLabel={`Stream statistics: sending ${Math.round(stats.sendRateKbps)} kilobits per second, round trip ${Math.round(stats.rttMs)} milliseconds`}
            accessibilityHint="Hides the stream statistics"
          >
            <Stat label="Bitrate" value={`${stats.videoBitrateKbps} kbps`} />
            <Stat label="Sending" value={`${Math.round(stats.sendRateKbps)} kbps`} />
            <Stat label="RTT" value={`${Math.round(stats.rttMs)} ms`} />
            <Stat label="Loss" value={`${stats.lost + stats.dropped}`} warn={stats.lost + stats.dropped > 0} />
            <Stat label="Buffer" value={`${stats.sendBufferMs} ms`} warn={stats.sendBufferMs > latency.ms / 2} />
            <Stat label="GPS" value={broadcast.telemetry.enabled ? `${broadcast.telemetry.sent}` : 'off'} />
          </Pressable>
        )}
        {isLive && stats && controlsOpen && (
          <View testID="golive-congestion" style={styles.congestionTrack}>
            <View style={[styles.congestionFill, { width: `${Math.round(Math.min(1, stats.congestion) * 100)}%`, backgroundColor: stats.congestion > 0.6 ? theme.danger : stats.congestion > 0.3 ? theme.accent : theme.success }]} />
          </View>
        )}
        {publisher === 'reconnecting' && (
          <Text style={styles.reconnectText}>
            Link lost{broadcast.publisherReason ? ` (${broadcast.publisherReason})` : ''} — retrying{broadcast.nextRetryMs ? ` in ${Math.ceil(broadcast.nextRetryMs / 1000)}s` : ''}. The camera keeps running; the server keeps the stream open.
          </Text>
        )}
        {s && !s.playlist_ready && isLive && publisher === 'publishing' && (
          <Text style={styles.hint}>Connected · waiting for the server to publish the first segment…</Text>
        )}
        {s?.playlist_ready && isLive && publisher === 'publishing' && <Text style={styles.hintOk}>Viewers can watch now.</Text>}
        {/* Not inside the stats block on purpose (see `onEnableGps`): a denial there is invisible
            in landscape, which is exactly how a mounted phone streams. */}
        {isLive && !broadcast.telemetry.enabled && (
          <Pressable
            testID="golive-gps-hint"
            onPress={onEnableGps}
            hitSlop={verticalTouchSlop(15)}
            accessibilityRole="button"
            accessibilityLabel="GPS off — tap to enable location"
            accessibilityHint="Asks for location access again. If iOS no longer prompts, this opens Settings — changing location access there restarts the app and ends the stream."
          >
            <Text style={styles.hintAction} {...denseText}>GPS off — tap to enable location</Text>
          </Pressable>
        )}

        {!isLive && phase !== 'ended' && phase !== 'error' && controlsOpen && (
          // RESP-026: the ONLY shrinkable region of the block — the controls row and the
          // Go live / Join live button below stay pinned, the settings scroll instead.
          <ScrollView
            testID="golive-settings"
            style={styles.settingsScroll}
            contentContainerStyle={styles.settings}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
          >
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder={eventId ? 'Camera name (shown on the tile)' : 'Stream name (optional)'}
              placeholderTextColor={theme.textTertiary}
              autoCapitalize="words"
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={() => Keyboard.dismiss()}
            />
            <View style={styles.chips}>
              {(Object.keys(PRESETS) as Quality[]).map((q) => (
                <Chip key={q} label={QUALITY_LABEL[q]} on={quality === q} onPress={() => setQuality(q)} disabled={busy} />
              ))}
            </View>
            <View style={styles.chips}>
              {LATENCY.map((l) => <Chip key={l.ms} label={l.label} on={latency.ms === l.ms} onPress={() => setLatency(l)} disabled={busy} />)}
            </View>
            <Text style={styles.hint}>{latency.hint} Adaptive bitrate {preset.minBitrateKbps}–{preset.maxBitrateKbps} kbps, H.264 {preset.height}p{preset.fps}.</Text>
            <Pressable
              onPress={onToggleTelemetry}
              style={styles.toggleRow}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: broadcast.telemetry.enabled }}
              accessibilityLabel="Attach my GPS position"
            >
              <Icon name={broadcast.telemetry.enabled ? 'square-check' : 'square'} size={16} color={theme.overlayText} />
              <Text style={styles.toggleText}>{eventId ? 'Attach my GPS position and camera direction (your footprint joins the event map)' : 'Attach my GPS position and camera direction (shows on the map like an aircraft, footprint included)'}</Text>
            </Pressable>
          </ScrollView>
        )}

        <View style={styles.controls}>
          <Ctl icon="camera-rotate" label="Switch camera" onPress={flip} disabled={busy} />
          <Ctl icon={torch ? 'bolt' : 'bolt-lightning'} label={torch ? 'Torch off' : 'Torch on'} onPress={toggleTorch} disabled={busy || camera === 'front'} active={torch} />
          {phase === 'ended' || phase === 'error' ? (
            <View style={{ width: 84 }} />
          ) : isLive ? (
            <Pressable onPress={confirmStop} style={[styles.goLive, styles.stopBtn, busy && { opacity: 0.7 }]} disabled={busy} accessibilityRole="button" accessibilityLabel="End stream">
              <Icon name="stop" size={18} color={theme.overlayText} />
              <Text style={styles.goLiveText} {...denseText}>End</Text>
            </Pressable>
          ) : (
            <Pressable
              onPress={onStart}
              style={[styles.goLive, busy && { opacity: 0.7 }]}
              disabled={busy || !perm || perm.camera !== 'granted'}
              accessibilityRole="button"
              accessibilityLabel={eventId ? 'Join live' : 'Go live'}
              accessibilityState={{ disabled: busy || !perm || perm.camera !== 'granted', busy }}
            >
              {busy ? <ActivityIndicator color={theme.overlayText} /> : <View style={styles.liveDotBig} />}
              <Text style={styles.goLiveText} {...denseText}>{eventId ? 'Join live' : 'Go live'}</Text>
            </Pressable>
          )}
          <Ctl icon={muted ? 'microphone-slash' : 'microphone'} label={muted ? 'Unmute microphone' : 'Mute microphone'} onPress={toggleMute} active={muted} />
          {/* UI-036: the 5th slot follows the phase — before start it shows/hides the settings block,
              while live it shows/hides the stats; the ended/error screens have nothing to toggle, so
              a 44pt spacer keeps the row's `space-between` geometry instead of a dead control. */}
          {phase === 'ended' || phase === 'error' ? (
            <View style={{ width: 44 }} />
          ) : (
            <Ctl
              icon={controlsOpen ? 'chevron-down' : isLive ? 'chart-simple' : 'sliders'}
              label={isLive
                ? (controlsOpen ? 'Hide stream statistics' : 'Show stream statistics')
                : (controlsOpen ? 'Hide settings' : 'Show settings')}
              onPress={() => setControlsOpen((v) => !v)}
            />
          )}
        </View>
      </View>
    </View>
  );
}

function TopBar({ onClose, title, inset }: { onClose: () => void; title: string; inset: { paddingLeft: number; paddingRight: number } }) {
  return (
    <View style={[styles.topPlain, inset]}>
      <Pressable onPress={onClose} hitSlop={8} style={styles.roundBtnDark} accessibilityRole="button" accessibilityLabel="Close"><Icon name="xmark" size={16} color={theme.textPrimary} /></Pressable>
      <Text style={styles.topTitle}>{title}</Text>
    </View>
  );
}

function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, on && styles.chipOn, disabled && styles.chipDisabled]}
      hitSlop={verticalTouchSlop(34)}
      accessibilityRole="radio"
      accessibilityState={{ selected: on, disabled }}
      accessibilityLabel={label}
    >
      <Text style={[styles.chipText, on && styles.chipTextOn]} {...denseText}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel} {...denseText}>{label}</Text>
      <Text style={[styles.statValue, warn && { color: theme.warningText }]} {...denseText}>{value}</Text>
    </View>
  );
}

function Ctl({ icon, label, onPress, disabled, active }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[styles.ctl, active && styles.ctlActive, disabled && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected: active }}
    >
      <Icon name={icon} size={18} color={theme.overlayText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.videoBg },
  checking: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 8 },
  topPlain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: theme.surface },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  roundBtn: { width: 36, height: 36, borderRadius: theme.radiusPill, backgroundColor: theme.overlayBg, alignItems: 'center', justifyContent: 'center' },
  roundBtnDark: { width: 36, height: 36, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32, paddingHorizontal: 14, borderRadius: theme.radiusPill },
  pillText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  liveDot: { width: 8, height: 8, borderRadius: theme.radiusPill, backgroundColor: theme.overlayText },
  netBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: theme.radiusPill, backgroundColor: theme.overlayBg },
  netText: { color: theme.overlayText, fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  banner: { position: 'absolute', left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.overlayBg, borderRadius: theme.radiusSm, paddingHorizontal: 10, paddingVertical: 7 },
  bannerText: { color: theme.overlayText, fontSize: 12, fontWeight: '600', flex: 1 },
  centerCard: { position: 'absolute', left: 24, right: 24, top: '30%', backgroundColor: theme.surface, borderRadius: theme.radiusLg, padding: 20, gap: 10, alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  cardText: { fontSize: 13, color: theme.textSecondary, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8 },
  primary: { minHeight: 40, paddingHorizontal: 18, borderRadius: theme.radiusPill, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.textOnAccent, fontWeight: '700', fontSize: 13 },
  secondary: { minHeight: 40, paddingHorizontal: 16, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.textPrimary, fontWeight: '600', fontSize: 13 },
  bottom: { position: 'absolute', left: 0, right: 0, backgroundColor: theme.overlayBgStrong, paddingHorizontal: 14, paddingTop: 10, gap: 10 },
  // Six stats must be able to wrap (Split View / Larger Text) instead of pushing "GPS" off-screen (RESP-016).
  statsRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 6, columnGap: 8 },
  stat: { alignItems: 'center', minWidth: 48, flexGrow: 1 },
  statLabel: { color: theme.overlayTextMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { color: theme.overlayText, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  congestionTrack: { height: 3, borderRadius: theme.radiusPill, backgroundColor: theme.overlayControl, overflow: 'hidden' },
  congestionFill: { height: 3, borderRadius: theme.radiusPill },
  reconnectText: { color: theme.warningText, fontSize: 12, lineHeight: 16 },
  hint: { color: theme.overlayTextMuted, fontSize: 11, lineHeight: 15 },
  hintOk: { color: theme.successText, fontSize: 11, fontWeight: '600' },
  // A hint line that is also a control: 15pt box, grown to 44pt by `verticalTouchSlop` (UI-007).
  hintAction: { color: theme.warningText, fontSize: 11, lineHeight: 15, fontWeight: '700', textDecorationLine: 'underline' },
  /** RESP-026: shrinks (and then scrolls) before the pinned controls row does. */
  settingsScroll: { flexGrow: 0, flexShrink: 1 },
  settings: { gap: 8 },
  input: { minHeight: 38, paddingHorizontal: 12, borderRadius: theme.radiusSm, backgroundColor: theme.overlayField, color: theme.overlayText, fontSize: 14 },
  // UI-028: a WRAPPING row — once it wraps, the chip below is a VERTICAL neighbour, so a
  // 30pt box's 7pt slop overlapped the line above by 8pt. 34pt box (5pt slop) + rowGap 10.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, rowGap: 10 },
  chip: { minHeight: 34, paddingHorizontal: 11, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.overlayBorder, justifyContent: 'center' },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  /** UI-019: while the stream is being created every setting is locked — say so visually. */
  chipDisabled: { opacity: 0.45 },
  chipText: { color: theme.overlayText, fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: theme.textOnAccent },
  // UI-022: a text row with a 16pt checkbox glyph and no box of its own.
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  toggleText: { color: theme.overlayText, fontSize: 12, flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  ctl: { width: 44, height: 44, borderRadius: theme.radiusPill, backgroundColor: theme.overlayControl, alignItems: 'center', justifyContent: 'center' },
  ctlActive: { backgroundColor: theme.accent },
  goLive: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52, paddingHorizontal: 22, borderRadius: theme.radiusPill, backgroundColor: theme.liveRed },
  stopBtn: { backgroundColor: theme.textPrimary },
  goLiveText: { color: theme.overlayText, fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  liveDotBig: { width: 12, height: 12, borderRadius: theme.radiusPill, backgroundColor: theme.overlayText },
});
