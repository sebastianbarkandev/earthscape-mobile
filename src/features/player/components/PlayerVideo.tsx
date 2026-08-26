import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { theme } from '@/common/theme';

export interface PlayerVideoHandle {
  enterFullscreen(): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setRate(rate: number): void;
  setMuted(muted: boolean): void;
  seekBy(seconds: number): void;
  /** Jump to the live edge (web Video.syncToLive). */
  goLive(): void;
  currentTime(): number;
  duration(): number;
}

interface Props {
  /** Fully resolved playable URL (VOD hls/mp4 or live playlist). */
  sourceUri: string;
  /** Video-time seconds from the native player, ~2x/sec. */
  onTimeUpdate: (videoTime: number) => void;
  /**
   * Player -> store mirrors (web: reverse sync into status.player). The store never
   * drives the player: a buffering-induced playingChange(false) written back as
   * "paused" would otherwise pause the player for real (web guards this with
   * pausedForBuffering). Controls act through the imperative handle instead.
   */
  onPlayingChange: (isPlaying: boolean) => void;
  onRateChange?: (rate: number) => void;
  onMutedChange?: (muted: boolean) => void;
  onPlayToEnd?: () => void;
  /** One-shot seek command ({videoTime, nonce}); nonce change triggers the seek. */
  seek: { videoTime: number; nonce: number } | null;
  /** Overlay (custom controls) rendered above the video surface. */
  children?: React.ReactNode;
}

/**
 * expo-video wrapper with NATIVE CONTROLS OFF (web parity: the web renders its
 * own PlaybackControlProgressBar). The player is the source of truth for
 * paused/rate/muted; Redux mirrors it via the events below.
 */
export const PlayerVideo = forwardRef<PlayerVideoHandle, Props>(function PlayerVideo(
  { sourceUri, onTimeUpdate, onPlayingChange, onRateChange, onMutedChange, onPlayToEnd, seek, children },
  ref,
) {
  const viewRef = useRef<VideoView>(null);
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

  useEffect(() => {
    const sub = player.addListener('playingChange', (e: { isPlaying: boolean }) => {
      onPlayingChange(e.isPlaying);
    });
    return () => sub.remove();
  }, [player, onPlayingChange]);

  useEffect(() => {
    if (!onPlayToEnd) return;
    const sub = player.addListener('playToEnd', () => onPlayToEnd());
    return () => sub.remove();
  }, [player, onPlayToEnd]);

  useEffect(() => {
    if (!onRateChange) return;
    const sub = player.addListener('playbackRateChange', (e: { playbackRate: number }) => onRateChange(e.playbackRate));
    return () => sub.remove();
  }, [player, onRateChange]);
  useEffect(() => {
    if (!onMutedChange) return;
    const sub = player.addListener('mutedChange', (e: { muted: boolean }) => onMutedChange(e.muted));
    return () => sub.remove();
  }, [player, onMutedChange]);

  // One-shot seek commands from the store (clipmark chips, timeline, ±10s).
  useEffect(() => {
    if (seek && Number.isFinite(seek.videoTime)) {
      player.currentTime = Math.max(0, seek.videoTime);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek?.nonce]);

  useImperativeHandle(
    ref,
    () => ({
      enterFullscreen: () => {
        viewRef.current?.enterFullscreen().catch(() => undefined);
      },
      play: () => player.play(),
      pause: () => player.pause(),
      togglePlay: () => (player.playing ? player.pause() : player.play()),
      setRate: (r) => {
        player.playbackRate = r;
      },
      setMuted: (m) => {
        player.muted = m;
      },
      seekBy: (s) => player.seekBy(s),
      goLive: () => player.seekBy(60 * 60 * 24), // AVPlayer clamps to the live edge
      currentTime: () => player.currentTime,
      duration: () => player.duration,
    }),
    [player],
  );

  return (
    <View style={styles.wrap}>
      <VideoView
        ref={viewRef}
        style={StyleSheet.absoluteFill}
        player={player}
        allowsFullscreen
        allowsPictureInPicture
        nativeControls={false}
        contentFit="contain"
      />
      {children}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.videoBg,
  },
});
