import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { theme } from '@/common/theme';
import { LiveBadge } from '@/common/components/LiveBadge';

interface Props {
  /** Fully resolved playable URL (VOD hls/mp4 or live playlist). */
  sourceUri: string;
  isLive: boolean;
  /** Video-time seconds from the native player, ~2x/sec. */
  onTimeUpdate: (videoTime: number) => void;
  /** One-shot seek command ({videoTime, ts}); ts change triggers the seek. */
  seek: { videoTime: number; ts: number } | null;
}

/**
 * expo-video wrapper. Native controls handle play/pause/scrub/fullscreen
 * (v1 decision: native + minimal overlay). timeUpdate drives the map sync.
 */
export function PlayerVideo({ sourceUri, isLive, onTimeUpdate, seek }: Props) {
  const player = useVideoPlayer(sourceUri, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('timeUpdate', (e: { currentTime: number }) => {
      onTimeUpdate(e.currentTime);
    });
    return () => sub.remove();
  }, [player, onTimeUpdate]);

  // Clipmark tap-to-seek: consume one-shot seek commands from the store.
  useEffect(() => {
    if (seek && Number.isFinite(seek.videoTime)) {
      player.currentTime = seek.videoTime;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.ts]);

  return (
    <View style={styles.wrap}>
      <VideoView
        style={StyleSheet.absoluteFill}
        player={player}
        allowsFullscreen
        allowsPictureInPicture
        nativeControls
        contentFit="contain"
      />
      {isLive && (
        <View style={styles.badge} pointerEvents="none">
          <LiveBadge />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: theme.videoBg,
  },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
  },
});
