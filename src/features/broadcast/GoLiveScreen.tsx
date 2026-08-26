import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/common/theme';
import { Icon, type IconName } from '@/common/components/Icon';
import { EmptyState } from '@/common/components/EmptyState';
import { formatTime } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { EarthscapeLive, EarthscapeLivePreviewView, PRESETS, type PermissionStatus, type VideoPreset } from '../../../modules/earthscape-live';
import { useBroadcast } from './useBroadcast';
import { setTelemetryEnabled } from './broadcastSlice';

interface Props {
  /** Join this live event as an additional program. */
  eventId?: number;
  eventTitle?: string;
}

type Quality = keyof typeof PRESETS;
const QUALITY_LABEL: Record<Quality, string> = { auto: 'Auto', '1080p': '1080p', '720p': '720p', '480p': '480p' };
const LATENCY = [
  { label: 'Cellular · 400 ms', ms: 400, hint: 'Best on LTE/5G: absorbs jitter and short dropouts.' },
  { label: 'Fast · 200 ms', ms: 200, hint: 'Solid Wi-Fi only.' },
  { label: 'Robust · 800 ms', ms: 800, hint: 'Poor coverage, moving fast.' },
];

/**
 * Phone-as-source. Camera preview + Go Live. Two modes: create a new live event,
 * or join the event you came from as an extra program (shown side by side on
 * every viewer). The native engine handles SRT, ABR and reconnects; this screen
 * shows the truth about the link and never hides a degraded state.
 */
export function GoLiveScreen({ eventId, eventTitle }: Props) {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const insets = useSafeAreaInsets();
  const { broadcast, start, confirmStop, leave } = useBroadcast();
  const liveEnabled = useAppSelector((s) => s.auth.bootstrap?.features?.live_enabled ?? true);
  const [perm, setPerm] = useState<PermissionStatus | null>(null);
  const [quality, setQuality] = useState<Quality>('auto');
  const [latency, setLatency] = useState(LATENCY[0]);
  const [name, setName] = useState('');
  const [camera, setCamera] = useState<'back' | 'front'>('back');
  const [torch, setTorch] = useState(false);
  const [muted, setMuted] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [controlsOpen, setControlsOpen] = useState(true);
  const supported = EarthscapeLive.isSupported;
  const preset: VideoPreset = PRESETS[quality];

  const phase = broadcast.phase;
  const publisher = broadcast.publisher;
  const isLive = phase === 'live';
  const busy = phase === 'creating' || phase === 'ending';

  // Permissions + camera preview on mount; tear everything down on unmount.
  useEffect(() => {
    if (!supported) return;
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
  }, [supported]);

  const onStart = useCallback(async () => {
    if (!perm || perm.camera !== 'granted') {
      Alert.alert('Camera required', 'Allow camera access in Settings to go live.', [{ text: 'Open Settings', onPress: () => Linking.openSettings() }, { text: 'Cancel' }]);
      return;
    }
    await start({ eventId, streamName: name.trim() || undefined, preset, latencyMs: latency.ms, telemetry: broadcast.telemetry.enabled });
  }, [perm, start, eventId, name, preset, latency.ms, broadcast.telemetry.enabled]);

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

  const flip = async () => {
    try {
      const next = await EarthscapeLive.switchCamera();
      setCamera(next);
      if (next === 'front' && torch) setTorch(false);
    } catch { /* ignore */ }
  };
  const toggleTorch = async () => { const v = !torch; setTorch(v); await EarthscapeLive.setTorch(v).catch(() => undefined); };
  const toggleMute = async () => { const v = !muted; setMuted(v); await EarthscapeLive.setMuted(v).catch(() => undefined); };

  const status = useMemo(() => {
    if (phase === 'creating') return { label: 'Preparing stream…', color: theme.textOnAccent, bg: theme.overlayBg };
    if (phase === 'ending') return { label: 'Ending…', color: theme.textOnAccent, bg: theme.overlayBg };
    if (phase === 'ended') return { label: 'Ended', color: theme.textOnAccent, bg: theme.overlayBg };
    if (phase === 'error') return { label: 'Error', color: '#FFFFFF', bg: theme.danger };
    switch (publisher) {
      case 'connecting': return { label: 'Connecting…', color: theme.textOnAccent, bg: theme.accentActive };
      case 'reconnecting': return { label: `Reconnecting${broadcast.reconnectAttempt ? ` (${broadcast.reconnectAttempt})` : ''}…`, color: '#FFFFFF', bg: '#B26A00' };
      case 'publishing': return { label: `LIVE ${formatTime(broadcast.stats?.elapsedSec ?? 0, false)}`, color: '#FFFFFF', bg: theme.liveRed };
      default: return { label: eventId ? 'Ready to join' : 'Ready', color: theme.textOnAccent, bg: theme.overlayBg };
    }
  }, [phase, publisher, broadcast.reconnectAttempt, broadcast.stats?.elapsedSec, eventId]);

  if (!supported) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <TopBar onClose={() => router.back()} title="Go live" />
        <EmptyState title="Live publishing isn't available on this device" detail="Streaming from the phone is iOS-only for now and needs a build that includes the EarthscapeLive module." />
      </View>
    );
  }
  if (!liveEnabled) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top }]}>
        <TopBar onClose={() => router.back()} title="Go live" />
        <EmptyState title="Live streaming is disabled" detail="Your organization has live streaming turned off." />
      </View>
    );
  }

  const net = broadcast.network;
  const stats = broadcast.stats;
  const s = broadcast.stream;

  return (
    <View style={styles.screen}>
      <EarthscapeLivePreviewView style={StyleSheet.absoluteFill} videoGravity="resizeAspectFill" />

      {/* Top bar */}
      <View style={[styles.top, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
        <Pressable onPress={onClose} style={styles.roundBtn} hitSlop={8}><Icon name="xmark" size={16} color="#FFF" /></Pressable>
        <View style={[styles.pill, { backgroundColor: status.bg }]}>
          {publisher === 'publishing' && <View style={styles.liveDot} />}
          <Text style={[styles.pillText, { color: status.color }]}>{status.label}</Text>
        </View>
        <View style={styles.netBadge}>
          <Icon name={net?.interface === 'cellular' ? 'signal' : net?.interface === 'wifi' ? 'wifi' : 'globe'} size={12} color={net && net.status !== 'satisfied' ? theme.danger : '#FFF'} />
          {stats && isLive ? <Text style={styles.netText}>{Math.round(stats.sendRateKbps)} kbps · {Math.round(stats.rttMs)} ms</Text> : null}
        </View>
      </View>

      {eventId ? (
        <View style={styles.banner} pointerEvents="none">
          <Icon name="layer-group" size={12} color="#FFF" />
          <Text style={styles.bannerText} numberOfLines={1}>Adding your camera to: {eventTitle ?? `event ${eventId}`}</Text>
        </View>
      ) : null}

      {perm && perm.camera !== 'granted' && (
        <View style={styles.centerCard}>
          <Icon name="camera" size={22} color={theme.textSecondary} />
          <Text style={styles.cardTitle}>Camera access needed</Text>
          <Text style={styles.cardText}>Allow the camera (and microphone) in Settings to stream from this phone.</Text>
          <Pressable style={styles.primary} onPress={() => Linking.openSettings()}><Text style={styles.primaryText}>Open Settings</Text></Pressable>
        </View>
      )}
      {previewError && perm?.camera === 'granted' && (
        <View style={styles.centerCard}>
          <Text style={styles.cardTitle}>Camera unavailable</Text>
          <Text style={styles.cardText}>{previewError}</Text>
        </View>
      )}

      {phase === 'ended' && (
        <View style={styles.centerCard}>
          <Icon name="circle-check" size={22} color={theme.success} />
          <Text style={styles.cardTitle}>Stream ended</Text>
          <Text style={styles.cardText}>
            {broadcast.error
              ? `Stopped: ${broadcast.error}`
              : `The recording is being processed and will appear in the library. ${broadcast.telemetry.sent ? `${broadcast.telemetry.sent} GPS fixes were attached.` : ''}`}
          </Text>
          <View style={styles.row}>
            {s?.event_id ? (
              <Pressable style={styles.secondary} onPress={() => router.replace({ pathname: '/video/[eventId]', params: { eventId: String(s.event_id), videoId: String(s.video_id ?? '') } } as never)}>
                <Text style={styles.secondaryText}>View event</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Done</Text></Pressable>
          </View>
        </View>
      )}
      {phase === 'error' && broadcast.error && (
        <View style={styles.centerCard}>
          <Icon name="triangle-exclamation" size={22} color={theme.danger} />
          <Text style={styles.cardTitle}>Stream problem</Text>
          <Text style={styles.cardText}>{broadcast.error}</Text>
          <Pressable style={styles.primary} onPress={() => router.back()}><Text style={styles.primaryText}>Close</Text></Pressable>
        </View>
      )}

      {/* Bottom sheet: settings before start, stats + controls while live */}
      <View style={[styles.bottom, { paddingBottom: insets.bottom + 12 }]}>
        {isLive && stats && (
          <Pressable onPress={() => setControlsOpen((v) => !v)} style={styles.statsRow}>
            <Stat label="Bitrate" value={`${stats.videoBitrateKbps} kbps`} />
            <Stat label="Sending" value={`${Math.round(stats.sendRateKbps)} kbps`} />
            <Stat label="RTT" value={`${Math.round(stats.rttMs)} ms`} />
            <Stat label="Loss" value={`${stats.lost + stats.dropped}`} warn={stats.lost + stats.dropped > 0} />
            <Stat label="Buffer" value={`${stats.sendBufferMs} ms`} warn={stats.sendBufferMs > latency.ms / 2} />
            <Stat label="GPS" value={broadcast.telemetry.enabled ? `${broadcast.telemetry.sent}` : 'off'} />
          </Pressable>
        )}
        {isLive && stats && (
          <View style={styles.congestionTrack}>
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
        {s?.playlist_ready && isLive && <Text style={styles.hintOk}>Viewers can watch now.</Text>}

        {!isLive && phase !== 'ended' && phase !== 'error' && controlsOpen && (
          <View style={styles.settings}>
            {!eventId && (
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Stream name (optional)" placeholderTextColor={theme.textTertiary} autoCapitalize="words" editable={!busy} />
            )}
            <View style={styles.chips}>
              {(Object.keys(PRESETS) as Quality[]).map((q) => (
                <Chip key={q} label={QUALITY_LABEL[q]} on={quality === q} onPress={() => setQuality(q)} disabled={busy} />
              ))}
            </View>
            <View style={styles.chips}>
              {LATENCY.map((l) => <Chip key={l.ms} label={l.label} on={latency.ms === l.ms} onPress={() => setLatency(l)} disabled={busy} />)}
            </View>
            <Text style={styles.hint}>{latency.hint} Adaptive bitrate {preset.minBitrateKbps}–{preset.maxBitrateKbps} kbps, H.264 {preset.height}p{preset.fps}.</Text>
            <Pressable onPress={() => dispatch(setTelemetryEnabled(!broadcast.telemetry.enabled))} style={styles.toggleRow} hitSlop={4}>
              <Icon name={broadcast.telemetry.enabled ? 'square-check' : 'square'} size={16} color="#FFF" />
              <Text style={styles.toggleText}>Attach my GPS position (shows on the map like an aircraft track)</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.controls}>
          <Ctl icon="camera-rotate" onPress={flip} disabled={busy} />
          <Ctl icon={torch ? 'bolt' : 'bolt-lightning'} onPress={toggleTorch} disabled={busy || camera === 'front'} active={torch} />
          {phase === 'ended' || phase === 'error' ? (
            <View style={{ width: 84 }} />
          ) : isLive ? (
            <Pressable onPress={confirmStop} style={[styles.goLive, styles.stopBtn]} disabled={busy}>
              <Icon name="stop" size={18} color="#FFF" />
              <Text style={styles.goLiveText}>End</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onStart} style={[styles.goLive, busy && { opacity: 0.7 }]} disabled={busy || !perm || perm.camera !== 'granted'}>
              {busy ? <ActivityIndicator color="#FFF" /> : <View style={styles.liveDotBig} />}
              <Text style={styles.goLiveText}>{eventId ? 'Join live' : 'Go live'}</Text>
            </Pressable>
          )}
          <Ctl icon={muted ? 'microphone-slash' : 'microphone'} onPress={toggleMute} active={muted} />
          <Ctl icon={controlsOpen ? 'chevron-down' : 'sliders'} onPress={() => setControlsOpen((v) => !v)} />
        </View>
      </View>
    </View>
  );
}

function TopBar({ onClose, title }: { onClose: () => void; title: string }) {
  return (
    <View style={styles.topPlain}>
      <Pressable onPress={onClose} hitSlop={8} style={styles.roundBtnDark}><Icon name="xmark" size={16} color={theme.textPrimary} /></Pressable>
      <Text style={styles.topTitle}>{title}</Text>
    </View>
  );
}

function Chip({ label, on, onPress, disabled }: { label: string; on: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.chip, on && styles.chipOn]} hitSlop={4}>
      <Text style={[styles.chipText, on && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, warn && { color: '#FFB74D' }]}>{value}</Text>
    </View>
  );
}

function Ctl({ icon, onPress, disabled, active }: { icon: IconName; onPress: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.ctl, active && styles.ctlActive, disabled && { opacity: 0.4 }]} hitSlop={6}>
      <Icon name={icon} size={18} color="#FFF" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.videoBg },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 8 },
  topPlain: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, backgroundColor: theme.surface },
  topTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  roundBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.overlayBg, alignItems: 'center', justifyContent: 'center' },
  roundBtnDark: { width: 36, height: 36, borderRadius: 18, backgroundColor: theme.bgSubtle, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 14, borderRadius: theme.radiusPill },
  pillText: { fontSize: 13, fontWeight: '800', letterSpacing: 0.3, fontVariant: ['tabular-nums'] },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FFF' },
  netBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10, borderRadius: theme.radiusPill, backgroundColor: theme.overlayBg },
  netText: { color: '#FFF', fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  banner: { position: 'absolute', top: 96, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: theme.overlayBg, borderRadius: theme.radiusSm, paddingHorizontal: 10, paddingVertical: 7 },
  bannerText: { color: '#FFF', fontSize: 12, fontWeight: '600', flex: 1 },
  centerCard: { position: 'absolute', left: 24, right: 24, top: '30%', backgroundColor: theme.surface, borderRadius: theme.radiusLg, padding: 20, gap: 10, alignItems: 'center' },
  cardTitle: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  cardText: { fontSize: 13, color: theme.textSecondary, textAlign: 'center', lineHeight: 18 },
  row: { flexDirection: 'row', gap: 8 },
  primary: { height: 40, paddingHorizontal: 18, borderRadius: theme.radiusPill, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.textOnAccent, fontWeight: '700', fontSize: 13 },
  secondary: { height: 40, paddingHorizontal: 16, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.textPrimary, fontWeight: '600', fontSize: 13 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: theme.overlayBgStrong, paddingHorizontal: 14, paddingTop: 10, gap: 10 },
  statsRow: { flexDirection: 'row', justifyContent: 'space-between' },
  stat: { alignItems: 'center', minWidth: 48 },
  statLabel: { color: theme.overlayTextMuted, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.4 },
  statValue: { color: '#FFF', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  congestionTrack: { height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.15)', overflow: 'hidden' },
  congestionFill: { height: 3, borderRadius: 2 },
  reconnectText: { color: '#FFB74D', fontSize: 12, lineHeight: 16 },
  hint: { color: theme.overlayTextMuted, fontSize: 11, lineHeight: 15 },
  hintOk: { color: '#81C784', fontSize: 11, fontWeight: '600' },
  settings: { gap: 8 },
  input: { height: 38, paddingHorizontal: 12, borderRadius: theme.radiusSm, backgroundColor: 'rgba(255,255,255,0.12)', color: '#FFF', fontSize: 14 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { height: 30, paddingHorizontal: 11, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', justifyContent: 'center' },
  chipOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  chipText: { color: '#FFF', fontSize: 12, fontWeight: '600' },
  chipTextOn: { color: theme.textOnAccent },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleText: { color: '#FFF', fontSize: 12, flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 },
  ctl: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.15)', alignItems: 'center', justifyContent: 'center' },
  ctlActive: { backgroundColor: theme.accent },
  goLive: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 52, paddingHorizontal: 22, borderRadius: theme.radiusPill, backgroundColor: theme.liveRed },
  stopBtn: { backgroundColor: theme.textPrimary },
  goLiveText: { color: '#FFF', fontWeight: '800', fontSize: 16, letterSpacing: 0.3 },
  liveDotBig: { width: 12, height: 12, borderRadius: 6, backgroundColor: '#FFF' },
});
