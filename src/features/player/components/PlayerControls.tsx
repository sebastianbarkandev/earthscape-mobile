import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, PanResponder, Platform, Pressable, StyleSheet, Text, View, type PanResponderInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/common/theme';
import { edgePadding } from '@/common/layout';
import { Icon } from '@/common/components/Icon';
import { LiveBadge } from '@/common/components/LiveBadge';
import { formatTime } from '@/common/lib/formatTime';
import { denseText } from '@/common/typography';
import { verticalTouchSlop } from '@/common/touchTarget';
import { useAppSelector } from '@/store/hooks';

const SPEEDS = [0.5, 1, 1.5, 2, 3]; // web PlaybackSpeedButton
const HIDE_AFTER_MS = 3000; // web PlaybackControlProgressBar auto-hide

interface Props {
  paused: boolean;
  rate: number;
  muted: boolean;
  hasAudio: boolean;
  isLive: boolean;
  canSeek: boolean;
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
  // RESP-019: in landscape the transport row would otherwise start/end inside the ~59pt
  // cut-out strip, clipping "Back 10 seconds" and "Fullscreen".
  const insets = useSafeAreaInsets();
  const barPad = edgePadding(insets, 8);

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

  // The clock is read HERE (not passed from PlayerScreen) so the 2 Hz timeUpdate only
  // re-renders this bar, not the whole page (RESP-002).
  const currentTime = useAppSelector((s) => s.player.time.currentVideo) ?? 0;

  const duration = p.duration ?? 0;
  const timeToX = (t: number) => (duration > 0 ? Math.min(1, Math.max(0, t / duration)) * barWidth : 0);

  // PanResponder is created ONCE and reads live values through a ref (TimelineCanvas does the
  // same); rebuilding it every render allocated a new responder on every timeUpdate tick.
  const latest = useRef({ canSeek: p.canSeek, duration, barWidth, onSeekTo: p.onSeekTo, touch });
  latest.current = { canSeek: p.canSeek, duration, barWidth, onSeekTo: p.onSeekTo, touch };
  // Lazy init: `useRef(PanResponder.create(...))` would still evaluate create() on every render.
  const pan = useRef<PanResponderInstance | null>(null);
  pan.current ??= PanResponder.create({
      onStartShouldSetPanResponder: () => latest.current.canSeek && latest.current.duration > 0,
      onMoveShouldSetPanResponder: () => latest.current.canSeek && latest.current.duration > 0,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e) => {
        latest.current.touch();
        setScrub(scrubTimeAt(latest.current, e.nativeEvent.locationX));
      },
      onPanResponderMove: (e) => setScrub(scrubTimeAt(latest.current, e.nativeEvent.locationX)),
      onPanResponderRelease: (e) => {
        const t = scrubTimeAt(latest.current, e.nativeEvent.locationX);
        setScrub(null);
        latest.current.onSeekTo(t);
      },
      onPanResponderTerminate: () => setScrub(null),
    });
  const panHandlers = pan.current.panHandlers;

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

  const shown = scrub ?? currentTime;
  const step = p.paused ? 1 / 30 : 10;

  // accessible={false}: VoiceOver must reach the individual controls, not one giant "button".
  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => (visible ? setVisible(false) : touch())} accessible={false}>
      {p.isLive && (
        <View testID="controls-live-badge" style={[styles.liveBadge, { left: Math.max(10, insets.left) }]} pointerEvents="none">
          <LiveBadge />
        </View>
      )}
      {visible && (
        <View testID="controls-bar" style={[styles.bar, barPad]} onStartShouldSetResponder={() => true} onResponderGrant={touch}>
          {/* scrubber (video-seconds, like the web bar; the timeline below is UTC) */}
          <View
            style={styles.track}
            onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
            {...panHandlers}
          >
            <View style={styles.trackBg} />
            <View style={[styles.trackFill, { width: timeToX(shown) }]} />
            {p.canSeek && <View style={[styles.knob, { left: timeToX(shown) - 7 }]} />}
          </View>

          <View style={styles.row}>
            <CtlButton icon="backward-step" label={p.paused ? 'Back one frame' : 'Back 10 seconds'} disabled={!p.canSeek} onPress={() => { touch(); p.onSeekBy(-step); }} />
            <CtlButton icon={p.paused ? 'play' : 'pause'} label={p.paused ? 'Play' : 'Pause'} onPress={() => { touch(); p.onTogglePaused(); }} big />
            <CtlButton icon="forward-step" label={p.paused ? 'Forward one frame' : 'Forward 10 seconds'} disabled={!p.canSeek} onPress={() => { touch(); p.onSeekBy(step); }} />
            {p.hasAudio && (
              <CtlButton icon={p.muted ? 'volume-xmark' : 'volume-high'} label={p.muted ? 'Unmute' : 'Mute'} onPress={() => { touch(); p.onToggleMuted(); }} />
            )}
            <Text style={styles.time} {...denseText} accessibilityLabel={`${formatTime(shown, false)}${!p.isLive && duration > 0 ? ` of ${formatTime(duration, false)}` : ''}`}>
              {formatTime(shown, false)}
              {!p.isLive && duration > 0 ? ` / ${formatTime(duration, false)}` : ''}
            </Text>
            <View style={{ flex: 1 }} />
            {p.isLive && (
              <Pressable onPress={() => { touch(); p.onGoLive(); }} style={styles.goLive} hitSlop={verticalTouchSlop(28)} accessibilityRole="button" accessibilityLabel="Go live">
                <Text style={styles.goLiveText} {...denseText}>Go live</Text>
              </Pressable>
            )}
            <Pressable onPress={pickSpeed} style={styles.speed} hitSlop={verticalTouchSlop(28)} accessibilityRole="button" accessibilityLabel={`Playback speed ${p.rate}×`}>
              <Text style={styles.speedText} {...denseText}>{p.rate}×</Text>
            </Pressable>
            <CtlButton icon="expand" label="Fullscreen" onPress={() => { touch(); p.onFullscreen(); }} />
          </View>
        </View>
      )}
    </Pressable>
  );
}

/** Scrubber x (pt, within the track) -> video seconds, from the latest bar geometry. */
function scrubTimeAt(g: { barWidth: number; duration: number }, x: number): number {
  return g.barWidth > 0 ? Math.min(1, Math.max(0, x / g.barWidth)) * g.duration : 0;
}

function CtlButton({
  icon,
  label,
  onPress,
  disabled,
  big,
}: {
  icon: React.ComponentProps<typeof Icon>['name'];
  /** VoiceOver name — the FontAwesome glyph carries no text (RESP-009). */
  label: string;
  onPress: () => void;
  disabled?: boolean;
  big?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={verticalTouchSlop(36)}
      style={[styles.ctl, disabled && { opacity: 0.4 }]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
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
  trackBg: { position: 'absolute', left: 0, right: 0, height: 3, borderRadius: theme.radiusPill, backgroundColor: theme.overlayTrack },
  trackFill: { position: 'absolute', left: 0, height: 3, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  knob: { position: 'absolute', width: 14, height: 14, borderRadius: theme.radiusPill, backgroundColor: theme.accent, top: 4 },
  // UI-024: `gap: 2` between 36pt controls — a symmetric slop put Forward's hit frame over
  // the right edge of Play, so every control here uses vertical-only slop.
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  ctl: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  time: { color: theme.overlayText, fontSize: 12, fontVariant: ['tabular-nums'], marginLeft: 4 },
  speed: { paddingHorizontal: 8, minHeight: 28, justifyContent: 'center', borderRadius: theme.radiusSm, backgroundColor: theme.overlayControl },
  speedText: { color: theme.overlayText, fontSize: 12, fontWeight: '700' },
  goLive: { paddingHorizontal: 10, minHeight: 28, justifyContent: 'center', borderRadius: theme.radiusPill, backgroundColor: theme.liveRed, marginRight: 6 },
  goLiveText: { color: theme.overlayText, fontSize: 12, fontWeight: '700' },
});
