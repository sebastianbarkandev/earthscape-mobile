import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { theme } from '@/common/theme';
import { LiveBadge } from '@/common/components/LiveBadge';
import { resolveMediaUrl } from '@/common/config';
import { createTimeMapper } from '@/common/lib/TimeMapper';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { EventVideo } from '../api';
import { setActiveVideo } from '../playerSlice';

const DRIFT_TOLERANCE_SEC = 1.5;

interface Props {
  videos: EventVideo[];
  activeId: number;
  /** Primary playhead in UTC — secondaries are kept within DRIFT_TOLERANCE_SEC of it (VOD only). */
  currentUtc: number | null;
  /** Primary playback paused state, mirrored to VOD secondaries. */
  paused: boolean;
  /** Primary seek nonce — forces an immediate resync (web: seekerUpdatedAt). */
  seekNonce: number | null;
}

/**
 * Multi-program viewer (web VideoPlayer secondary column / Streams tab): every
 * other program of the event plays muted in a small tile; tap a tile to make it
 * the primary. Live tiles run at the live edge; VOD tiles are drift-corrected
 * against the primary's UTC clock through their own TimeMapper (the web only
 * re-syncs on explicit seeks and lets secondaries drift).
 */
export function ProgramStrip({ videos, activeId, currentUtc, paused, seekNonce }: Props) {
  const secondaries = useMemo(
    () => videos.filter((v) => v.id !== activeId && (v.hls_stream_url || v.mp4_url) && v.has_video !== false),
    [videos, activeId],
  );
  if (secondaries.length === 0) return null;
  return (
    <View style={styles.strip}>
      {secondaries.map((v) => (
        <ProgramTile key={v.id} video={v} currentUtc={currentUtc} paused={paused} seekNonce={seekNonce} />
      ))}
    </View>
  );
}

function ProgramTile({ video, currentUtc, paused, seekNonce }: { video: EventVideo; currentUtc: number | null; paused: boolean; seekNonce: number | null }) {
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
  const player = useVideoPlayer(source, (p) => {
    p.muted = true;
    p.loop = false;
    p.timeUpdateEventInterval = 0;
    p.play();
  });

  // Mirror pause/play for VOD programs (live tiles keep running at the edge).
  useEffect(() => {
    if (isLive) return;
    if (paused && player.playing) player.pause();
    else if (!paused && !player.playing) player.play();
  }, [player, paused, isLive]);

  // Drift correction against the primary clock (VOD only), plus an immediate resync on primary seeks.
  useEffect(() => {
    if (isLive || !mapper || currentUtc == null) return;
    const target = mapper.utcToVideo(currentUtc);
    if (target == null || !Number.isFinite(target)) return;
    if (Math.abs(player.currentTime - target) > DRIFT_TOLERANCE_SEC) player.currentTime = Math.max(0, target);
  }, [player, mapper, currentUtc, isLive, seekNonce]);

  return (
    <Pressable onPress={() => dispatch(setActiveVideo(video.id))} style={styles.tile} accessibilityLabel={`Show ${video.program_type ?? video.title}`}>
      <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls={false} contentFit="cover" />
      <View style={styles.label} pointerEvents="none">
        {isLive && <LiveBadge />}
        <Text style={styles.labelText} numberOfLines={1}>{video.program_type || video.title}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', gap: 6, padding: 6, backgroundColor: theme.videoBg },
  tile: { flex: 1, maxWidth: '50%', aspectRatio: 16 / 9, borderRadius: theme.radiusSm, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  label: { position: 'absolute', left: 6, right: 6, bottom: 6, flexDirection: 'row', alignItems: 'center', gap: 6 },
  labelText: { color: '#FFF', fontSize: 11, fontWeight: '700', textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3, flexShrink: 1 },
});
