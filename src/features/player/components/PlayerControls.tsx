import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, PanResponder, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { LiveBadge } from '@/common/components/LiveBadge';
import { formatTime } from '@/common/lib/formatTime';

const SPEEDS = [0.5, 1, 1.5, 2, 3]; // web PlaybackSpeedButton
const HIDE_AFTER_MS = 3000; // web PlaybackControlProgressBar auto-hide

interface Props {
  paused: boolean;
  rate: number;
  muted: boolean;
  hasAudio: boolean;
  isLive: boolean;
  canSeek: boolean;
  currentTime: number; // video seconds
  duration: number | null;
  onTogglePaused: () => void;
  onSeekTo: (videoTime: number) => void;
  onSeekBy: (seconds: number) => void;
  onRate: (rate: number) => void;
  onToggleMuted: () => void;
  onFullscreen: () => void;
  onGoLive: () => void;
}

/**
 * Port of the web PlaybackControlProgressBar transport: scrubber (video-seconds),
 * seek back/forward (10s playing, 1/30s paused), play/pause, time, speed, mute,
 * fullscreen; Live badge + "Go live" when live. Auto-hides 3s after activity
 * while playing; tapping the video reveals it again.
 */
export function PlayerControls(p: Props) {
  const [visible, setVisible] = useState(true);
  const lastActivity = useRef(Date.now());
  const [scrub, setScrub] = useState<number | null>(null); // video seconds while dragging
  const [barWidth, setBarWidth] = useState(0);

  const touch = useCallback(() => {
    lastActivity.current = Date.now();
    setVisible(true);
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      if (!p.paused && Date.now() - lastActivity.current > HIDE_AFTER_MS) setVisible(false);
    }, 1000);
    return () => clearInterval(t);
  }, [p.paused]);

  const duration = p.duration ?? 0;
  const timeToX = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) * barWidth : 0);
  const xToTime = (x: number) => (barWidth > 0 ? Math.min(1, Math.max(0, x / barWidth)) * duration : 0);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => p.canSeek && duration > 0,
      onMoveShouldSetPanResponder: () => p.canSeek && duration > 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        touch();
        setScrub(xToTime(e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => setScrub(xToTime(e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => {
        const t = xToTime(e.nativeEvent.locationX);
        setScrub(null);
        p.onSeekTo(t);
      },
      onPanResponderTerminate: () => setScrub(null),
    }),
  );
  // PanResponder captures the closures at creation; refresh when inputs change.
  pan.current = PanResponder.create({
    onStartShouldSetPanResponder: () => p.canSeek && duration > 0,
    onMoveShouldSetPanResponder: () => p.canSeek && duration > 0,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      touch();
      setScrub(xToTime(e.nativeEvent.locationX));
    },
    onPanResponderMove: (e) => setScrub(xToTime(e.nativeEvent.locationX)),
    onPanResponderRelease: (e) => {
      const t = xToTime(e.nativeEvent.locationX);
      setScrub(null);
      p.onSeekTo(t);
    },
    onPanResponderTerminate: () => setScrub(null),
  });

  const pickSpeed = () => {
    touch();
    const labels = SPEEDS.map((s) => `${s}×`);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...labels, 'Cancel'], cancelButtonIndex: labels.length, title: 'Playback speed' },
        (i) => {
          if (i < SPEEDS.length) p.onRate(SPEEDS[i]);
        },
      );
    } else {
      const next = SPEEDS[(SPEEDS.indexOf(p.rate) + 1) % SPEEDS.length];
      p.onRate(next);
    }
  };

  const shown = scrub ?? p.currentTime;
  const step = p.paused ? 1 / 30 : 10;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => (visible ? setVisible(false) : touch())}>
      {p.isLive && (
        <View style={styles.liveBadge} pointerEvents="none">
          <LiveBadge />
        </View>
      )}
      {visible && (
        <View style={styles.bar} onStartShouldSetResponder={() => true} onResponderGrant={touch}>
          {/* scrubber (video-seconds, like the web bar; the timeline below is UTC) */}
          <View
            style={styles.track}
            onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
            {...pan.current.panHandlers}
          >
            <View style={styles.trackBg} />
            <View style={[styles.trackFill, { width: timeToX(shown) }]} />
            {p.canSeek && <View style={[styles.knob, { left: timeToX(shown) - 7 }]} />}
          </View>

          <View style={styles.row}>
            <CtlButton icon="backward-step" disabled={!p.canSeek} onPress={() => { touch(); p.onSeekBy(-step); }} />
            <CtlButton icon={p.paused ? 'play' : 'pause'} onPress={() => { touch(); p.onTogglePaused(); }} big />
            <CtlButton icon="forward-step" disabled={!p.canSeek} onPress={() => { touch(); p.onSeekBy(step); }} />
            {p.hasAudio && (
              <CtlButton icon={p.muted ? 'volume-xmark' : 'volume-high'} onPress={() => { touch(); p.onToggleMuted(); }} />
            )}
            <Text style={styles.time}>
              {formatTime(shown, false)}
              {!p.isLive && duration > 0 ? ` / ${formatTime(duration, false)}` : ''}
            </Text>
            <View style={{ flex: 1 }} />
            {p.isLive && (
              <Pressable onPress={() => { touch(); p.onGoLive(); }} style={styles.goLive} hitSlop={8}>
                <Text style={styles.goLiveText}>Go live</Text>
              </Pressable>
            )}
            <Pressable onPress={pickSpeed} style={styles.speed} hitSlop={8}>
              <Text style={styles.speedText}>{p.rate}×</Text>
            </Pressable>
            <CtlButton icon="expand" onPress={() => { touch(); p.onFullscreen(); }} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

function CtlButton({
  icon,
  onPress,
  disabled,
  big,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
}) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={6} style={[styles.ctl, disabled && { opacity: 0.4 }]}>
      <Icon name={icon} size={big ? 22 : 16} color={theme.overlayText} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  liveBadge: { position: 'absolute', top: 10, left: 10 },
  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.overlayBg,
    paddingHorizontal: 8,
    paddingBottom: 6,
  },
  track: { height: 22, justifyContent: 'center', marginHorizontal: 4 },
  trackBg: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)' },
  trackFill: { position: 'absolute', left: 0, height: 3, borderRadius: 2, backgroundColor: theme.accent },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: 7, backgroundColor: theme.accent, top: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ctl: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  time: { color: theme.overlayText, fontSize: 12, fontVariant: ['tabular-nums'], marginLeft: 4 },
  speed: { paddingHorizontal: 8, height: 28, justifyContent: 'center', borderRadius: theme.radiusSm, backgroundColor: 'rgba(255,255,255,0.15)' },
  speedText: { color: theme.overlayText, fontSize: 12, fontWeight: '700' },
  goLive: { paddingHorizontal: 10, height: 28, justifyContent: 'center', borderRadius: theme.radiusPill, backgroundColor: theme.liveRed, marginRight: 6 },
  goLiveText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
});
