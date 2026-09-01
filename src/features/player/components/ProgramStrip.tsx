import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { theme } from '@/common/theme';
import { LiveBadge } from '@/common/components/LiveBadge';
import { resolveMediaUrl } from '@/common/config';
import { createTimeMapper } from '@/common/lib/TimeMapper';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { EventVideo } from '../api';
import { selectProgram } from '../playerSlice';
import { planProgramTiles, programLabel, type ProgramTile as TilePlan } from '../programs';
import { programTileWidth } from '../viewportLayout';
import { useCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';
import { shouldAutoplay } from '../autoplay';
import { LIVE_EDGE_SEEK_SEC, useLivePlaylistRetry } from '../hooks/useLivePlaylistRetry';

const DRIFT_TOLERANCE_SEC = 1.5;

interface Props {
  videos: EventVideo[];
  activeId: number;
  /** Test overrides only — the app reads these from the store (see ProgramStrip body). */
  currentUtc?: number | null;
  paused?: boolean;
  seekNonce?: number | null;
  /**
   * The ACTIVE program is live. Its currentUtc is `video.start + playerTime` where start is the
   * server's stream-creation time (before the first segment), i.e. skewed by the connect delay —
   * VOD tiles must not be pinned to that clock (they'd sit tens of seconds off).
   */
  activeIsLive?: boolean;
}

/**
 * Multi-program viewer (web VideoPlayer secondary column / Streams tab): every
 * other program of the event plays muted in a small tile; tap a tile to make it
 * the primary. Live tiles run at the live edge; VOD tiles are drift-corrected
 * against the primary's UTC clock through their own TimeMapper (the web only
 * re-syncs on explicit seeks and lets secondaries drift).
 * Only MAX_TILE_PLAYERS tiles decode (planProgramTiles); the rest are static
 * thumbnails, and programs that are `processing` never get a player.
 */
export function ProgramStrip({ videos, activeId, activeIsLive = false, ...override }: Props) {
  // Primary clock / paused / seek nonce are read HERE (not passed from PlayerScreen) so the
  // 2 Hz timeUpdate only re-renders the strip (RESP-002). Secondaries are kept within
  // DRIFT_TOLERANCE_SEC of currentUtc (VOD only); seekNonce forces an immediate resync (web: seekerUpdatedAt).
  const storeUtc = useAppSelector((s) => s.player.time.currentUtc);
  const storePaused = useAppSelector((s) => s.player.playback.paused);
  const storeNonce = useAppSelector((s) => s.player.seek?.nonce ?? null);
  const currentUtc = override.currentUtc !== undefined ? override.currentUtc : storeUtc;
  const paused = override.paused ?? storePaused;
  const seekNonce = override.seekNonce !== undefined ? override.seekNonce : storeNonce;
  // LIVE-024: while the Go Live screen owns the audio session for capture, every decoding tile is
  // frozen. expo-video re-asserts a process-wide `.playback` AVAudioSession on each playingChange
  // (VideoManager.setAudioSession sets the CATEGORY unconditionally — muted tiles and
  // `audioMixingMode` do not help), which would kill the publisher's microphone mid-broadcast.
  // A stalling tile or its 10s playlist retry is exactly such a state change. See audioFocus.ts.
  const suspended = useCaptureAudioFocusHeld();
  const tiles = useMemo(() => planProgramTiles(videos, activeId), [videos, activeId]);
  // Fixed tile width + horizontal scroll: tiles never shrink with the program count (RESP-010).
  const tileW = programTileWidth(useWindowDimensions().width);
  if (tiles.length === 0) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.stripBg} contentContainerStyle={styles.strip} testID="program-strip">
      {tiles.map((t) =>
        t.mode === 'player' ? (
          <ProgramTile key={t.video.id} video={t.video} width={tileW} currentUtc={currentUtc} paused={paused} seekNonce={seekNonce} activeIsLive={activeIsLive} suspended={suspended} />
        ) : (
          <StaticTile key={t.video.id} tile={t} width={tileW} />
        ),
      )}
    </ScrollView>
  );
}

/** Thumbnail-only tile (over the player cap, or a program still processing) — still swaps on tap. */
function StaticTile({ tile, width }: { tile: TilePlan; width: number }) {
  const dispatch = useAppDispatch();
  const { video } = tile;
  const thumb = resolveMediaUrl(video.thumbnail_url);
  const isLive = video.live_stream_state === 'live';
  // LIVE-023: a live video's `thumbnail_url` in the EVENT payload is double-prefixed by the
  // backend and 404s, so an over-cap live tile would be an unexplained black rectangle.
  // Try the image, but fall back to a labelled "tap to watch" placeholder when it fails/absent.
  const [thumbFailed, setThumbFailed] = useState(false);
  const showThumb = !!thumb && !thumbFailed;
  return (
    <Pressable onPress={() => { void dispatch(selectProgram(video.id)); }} style={[styles.tile, { width }]} accessibilityRole="button" accessibilityLabel={`Show ${programLabel(video)}`}>
      {showThumb ? (
        <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setThumbFailed(true)} />
      ) : null}
      {tile.mode === 'processing' ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>Processing…</Text>
        </View>
      ) : !showThumb ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>{isLive ? 'Tap to watch' : 'Tap to play'}</Text>
        </View>
      ) : null}
      <View style={styles.label} pointerEvents="none">
        {isLive && <LiveBadge />}
        <Text style={styles.labelText} numberOfLines={1}>{programLabel(video)}</Text>
      </View>
    </Pressable>
  );
}

function ProgramTile({ video, width, currentUtc, paused, seekNonce, activeIsLive, suspended }: { video: EventVideo; width: number; currentUtc: number | null; paused: boolean; seekNonce: number | null; activeIsLive: boolean; suspended: boolean }) {
  const dispatch = useAppDispatch();
  const spec = useAppSelector((s) => s.player.timeMappers[video.id]);
  const mapper = useMemo(() => {
    if (!spec) return null;
    try {
      return createTimeMapper(spec.startUtc, spec.videoTimeUtcTimeMap);
    } catch {
      return createTimeMapper(spec.startUtc, null);
    }
  }, [spec]);
  const source = resolveMediaUrl(video.hls_stream_url) ?? resolveMediaUrl(video.mp4_url) ?? '';
  const isLive = video.live_stream_state === 'live';
  // LIVE-026: `setup` re-runs for every newly mounted tile AND every source change (a phone
  // joining, or one whose stream ended and whose URL flipped to the recorded HLS) — which is
  // exactly what the 20s refreshEvent produces DURING a broadcast. An unconditional play() here
  // was the hole in the LIVE-024 freeze: the freeze effect below only covers tiles that already
  // existed when the hold was taken. shouldAutoplay() closes it for tiles created while it is held;
  // the effect then parks the new player, and the thaw branch reloads it at the live edge.
  const pausedIntent = !isLive && paused;
  const pausedIntentRef = useRef(pausedIntent);
  pausedIntentRef.current = pausedIntent;
  const player = useVideoPlayer(source, (p) => {
    p.muted = true;
    p.loop = false;
    p.timeUpdateEventInterval = 0;
    if (shouldAutoplay(pausedIntentRef.current)) p.play();
  });

  // Mirror pause/play for VOD programs (live tiles keep running at the edge).
  useEffect(() => {
    if (isLive || suspended) return;
    if (paused && player.playing) player.pause();
    else if (!paused && !player.playing) player.play();
  }, [player, paused, isLive, suspended]);

  // LIVE-024: freeze/thaw around a phone broadcast. Pausing is what stops expo-video from
  // touching the shared AVAudioSession (a paused player emits no further playingChange), and it
  // also stops two HLS downloads competing with the SRT uplink. pause() is unconditional: a tile
  // that is merely buffering would otherwise start playing while the mic is live.
  // On the way back a LIVE tile RELOADS its playlist — a fresh live playlist starts at the live
  // edge, and the seek past the end clamps there too — so it never resumes minutes behind.
  const wasSuspended = useRef(false);
  useEffect(() => {
    if (suspended) {
      wasSuspended.current = true;
      player.pause();
      return;
    }
    if (!wasSuspended.current) return;
    wasSuspended.current = false;
    if (!isLive) {
      if (!paused) player.play();
      return;
    }
    if (!source) return;
    player
      .replaceAsync(source)
      .then(() => {
        // LIVE-032: `replaceAsync` resolves off the main thread (expo-video awaits the asset load),
        // so the hold may have been RE-taken meanwhile — leave /golive and tap "Add my camera"
        // again, and the freeze effect has already run for that hold and will not run again. Ask the
        // one rule at FIRE time; a live tile's pausedIntent is false, so this is exactly the hold.
        if (!shouldAutoplay(pausedIntentRef.current)) return;
        player.play();
        player.seekBy(LIVE_EDGE_SEEK_SEC);
      })
      .catch(() => undefined);
  }, [player, suspended, isLive, source, paused]);

  // Drift correction against the primary clock (VOD tile under a VOD primary only), plus an
  // immediate resync on primary seeks. Skipped while the active program is live (see Props).
  useEffect(() => {
    if (isLive || activeIsLive || suspended || !mapper || currentUtc == null) return;
    const target = mapper.utcToVideo(currentUtc);
    if (target == null || !Number.isFinite(target)) return;
    if (Math.abs(player.currentTime - target) > DRIFT_TOLERANCE_SEC) player.currentTime = Math.max(0, target);
  }, [player, mapper, currentUtc, isLive, activeIsLive, suspended, seekNonce]);

  // Live tiles: the playlist 404s until the first segment exists (a phone that is still
  // connecting) and may stall when the stream ends — show the truth and retry the source.
  // Shared with the main viewport (LIVE-028) so both paths behave identically. The hook consults
  // the capture hold itself (LIVE-032/033), at schedule AND at fire time — nothing to pass here.
  const { connecting } = useLivePlaylistRetry(player, { source, isLive });

  return (
    <Pressable onPress={() => { void dispatch(selectProgram(video.id)); }} style={[styles.tile, { width }]} accessibilityRole="button" accessibilityLabel={`Show ${programLabel(video)}`}>
      <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="cover" />
      {connecting ? (
        <View style={styles.overlay} pointerEvents="none">
          <Text style={styles.overlayText}>Connecting…</Text>
        </View>
      ) : null}
      <View style={styles.label} pointerEvents="none">
        {isLive && <LiveBadge />}
        <Text style={styles.labelText} numberOfLines={1}>{programLabel(video)}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stripBg: { flexGrow: 0, backgroundColor: theme.videoBg },
  strip: { flexDirection: 'row', gap: 6, padding: 6 },
  tile: { aspectRatio: 16 / 9, borderRadius: theme.radiusSm, overflow: 'hidden', backgroundColor: theme.videoBg, borderWidth: 1, borderColor: theme.overlayHairline },
  label: { position: 'absolute', left: 6, right: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelText: { color: theme.overlayText, fontSize: 11, fontWeight: '700', textShadowColor: theme.overlayShadow, textShadowRadius: 3, flexShrink: 1 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.scrim },
  overlayText: { color: theme.overlayText, fontSize: 11, fontWeight: '600' },
});
