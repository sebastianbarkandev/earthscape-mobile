import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { theme } from '@/common/theme';
import { shouldAutoplay } from '../autoplay';
import { useLivePlaylistRetry } from '../hooks/useLivePlaylistRetry';

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
  /**
   * The source is a live playlist (`live_stream_state === 'live'`). LIVE-028: it 404s until the
   * live server has produced a first segment, so this player needs the same status surface +
   * bounded reload the program tiles have — the URL never changes when the segments appear.
   */
  isLive?: boolean;
  /** Overlay (custom controls) rendered above the video surface. */
  children?: React.ReactNode;
}

/**
 * expo-video wrapper with NATIVE CONTROLS OFF (web parity: the web renders its
 * own PlaybackControlProgressBar). The player is the source of truth for
 * paused/rate/muted; Redux mirrors it via the events below.
 */
export const PlayerVideo = forwardRef<PlayerVideoHandle, Props>(function PlayerVideo(
  { sourceUri, onTimeUpdate, onPlayingChange, onRateChange, onMutedChange, onPlayToEnd, seek, isLive = false, children },
  ref,
) {
  const viewRef = useRef<VideoView>(null);
  // LIVE-029: `useVideoPlayer` re-creates the player (and re-runs this setup) on every sourceUri
  // change, and mid-view the source DOES change — `hls_stream_url` flips from
  // `/live/{id}/playlist.m3u8` to the recorded HLS as soon as the transcode lands, which is
  // precisely what the heartbeat and the 20s refresh exist to pick up. Nothing else re-applies the
  // viewer's intent to the new instance (the store deliberately never drives the player), so the
  // intent is kept HERE, written only by the imperative commands below — never by `playingChange`,
  // which also reports `false` for buffering. `shouldAutoplay` additionally keeps the new player
  // silent while the camera owns the audio session (LIVE-020/026: an unmuted auto-play behind
  // /golive is captured into the published AAC track as an echo of the primary).
  const intent = useRef({ paused: false, muted: false, rate: 1 });
  const player = useVideoPlayer(sourceUri, (p) => {
    p.timeUpdateEventInterval = 0.5;
    p.muted = intent.current.muted;
    p.playbackRate = intent.current.rate;
    if (shouldAutoplay(intent.current.paused)) p.play();
  });
  // Same status surface + bounded 10s reload as a ProgramStrip tile (shared hook, LIVE-028):
  // without it, swapping the primary to a phone that is still connecting left the viewport black
  // forever — AVPlayerItem fails the load once and the unchanged source string never re-creates it.
  // The hook itself refuses to reload while the camera owns the audio session (LIVE-033/REG-002:
  // this player is behind /golive then, and 30 playlist fetches would compete with the SRT uplink).
  const { connecting, exhausted, retry } = useLivePlaylistRetry(player, {
    source: sourceUri,
    isLive,
    canPlay: () => shouldAutoplay(intent.current.paused),
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
      play: () => {
        intent.current.paused = false;
        player.play();
      },
      pause: () => {
        intent.current.paused = true;
        player.pause();
      },
      togglePlay: () => {
        intent.current.paused = player.playing;
        return player.playing ? player.pause() : player.play();
      },
      setRate: (r) => {
        intent.current.rate = r;
        player.playbackRate = r;
      },
      setMuted: (m) => {
        intent.current.muted = m;
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
      {connecting && !exhausted && (
        <View style={styles.connecting} pointerEvents="none">
          <Text style={styles.connectingText}>Connecting…</Text>
        </View>
      )}
      {children}
      {/* LIVE-035: the bounded retry is spent (~5 min). Keeping "Connecting…" up for a player that
          has stopped trying is a lie, and nothing re-arms it by itself — a live program's playlist
          URL never changes, so neither the 20s refreshEvent nor `useVideoPlayer` re-keys. Rendered
          AFTER `children` because this one must be TAPPABLE: PlayerControls' root is an
          absoluteFill Pressable that would swallow the tap. `box-none` leaves everything but the
          pill transparent to touches, and the transport bar sits at the bottom, clear of it. */}
      {exhausted && (
        <View style={styles.connecting} pointerEvents="box-none">
          <Pressable onPress={retry} accessibilityRole="button" accessibilityLabel="Retry connecting" style={styles.retry}>
            <Text style={styles.connectingText}>Still connecting — tap to retry</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: theme.videoBg,
  },
  // Behind the controls overlay (rendered after it) and never touchable, so it cannot swallow taps.
  connecting: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  connectingText: { color: theme.overlayText, fontSize: 13, fontWeight: '600' },
  retry: { paddingHorizontal: 16, minHeight: 44, justifyContent: 'center', borderRadius: theme.radiusPill, backgroundColor: theme.overlayControl },
});
