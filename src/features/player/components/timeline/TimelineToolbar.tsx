import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon, type IconName } from '@/common/components/Icon';

interface Props {
  canClip: boolean;
  tool: 'scrub' | 'clip';
  onToolChange: (t: 'scrub' | 'clip') => void;
  clipInActive: boolean;
  onMark: () => void;
  onClipIn: () => void;
  onClipOut: () => void;
  onCancelClipIn: () => void;
  hasEvents: boolean;
  onPrev: () => void;
  onNext: () => void;
  zoomed: boolean;
  onResetZoom: () => void;
  clipmarksVisible: boolean;
  onToggleClipmarks: () => void;
  sensorsAvailable: boolean;
  sensorVisibility: Record<1 | 2 | 3, boolean>;
  onToggleSensor: (v: 1 | 2 | 3) => void;
  busy: boolean;
}

/** Web Lower toolbar: ButtonBar (Mark / Clip in / Clip out) + prev/next event + sensor toggles; mobile adds zoom reset + clip tool. */
export function TimelineToolbar(p: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {p.canClip && (
        <>
          <Btn icon="thumbtack" label="Mark" onPress={p.onMark} disabled={p.busy} />
          {p.clipInActive ? (
            <>
              <Btn icon="scissors" label="Clip out" onPress={p.onClipOut} primary disabled={p.busy} />
              <Btn icon="xmark" onPress={p.onCancelClipIn} />
            </>
          ) : (
            <Btn icon="scissors" label="Clip in" onPress={p.onClipIn} disabled={p.busy} />
          )}
          <View style={styles.segmented}>
            {(['scrub', 'clip'] as const).map((t) => (
              <Pressable key={t} onPress={() => p.onToolChange(t)} style={[styles.segment, p.tool === t && styles.segmentActive]} hitSlop={4}>
                <Icon name={t === 'scrub' ? 'hand-pointer' : 'crop-simple'} size={11} color={p.tool === t ? theme.textPrimary : theme.textSecondary} />
                <Text style={[styles.segmentText, p.tool === t && styles.segmentTextActive]}>{t === 'scrub' ? 'Scrub' : 'Clip'}</Text>
              </Pressable>
            ))}
          </View>
          <View style={styles.divider} />
        </>
      )}
      <Btn icon="backward-step" onPress={p.onPrev} disabled={!p.hasEvents} />
      <Btn icon="forward-step" onPress={p.onNext} disabled={!p.hasEvents} />
      <Btn icon={p.clipmarksVisible ? 'eye' : 'eye-slash'} onPress={p.onToggleClipmarks} />
      {p.zoomed && <Btn icon="magnifying-glass-minus" label="Reset zoom" onPress={p.onResetZoom} />}
      {p.sensorsAvailable && (
        <>
          <View style={styles.divider} />
          {([1, 2, 3] as const).map((v) => (
            <Pressable key={v} onPress={() => p.onToggleSensor(v)} style={[styles.sensor, !p.sensorVisibility[v] && styles.sensorOff]} hitSlop={4}>
              <View style={[styles.swatch, { backgroundColor: v === 1 ? 'rgb(173,216,230)' : v === 2 ? '#FFCDD2' : '#FFF176' }]} />
              <Text style={styles.sensorText}>Sensor {v}</Text>
            </Pressable>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Btn({ icon, label, onPress, disabled, primary }: { icon: IconName; label?: string; onPress: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} hitSlop={4} style={({ pressed }) => [styles.btn, primary && styles.btnPrimary, pressed && styles.btnPressed, disabled && { opacity: 0.4 }]}>
      <Icon name={icon} size={13} color={primary ? theme.textOnAccent : theme.textPrimary} />
      {label ? <Text style={[styles.btnText, primary && { color: theme.textOnAccent }]}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 },
  btn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
  btnPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  btnPressed: { backgroundColor: theme.bgSubtle },
  btnText: { fontSize: 12, fontWeight: '600', color: theme.textPrimary },
  segmented: { flexDirection: 'row', backgroundColor: theme.bgSubtle, borderRadius: theme.radiusPill, padding: 2 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, height: 26, borderRadius: theme.radiusPill },
  segmentActive: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  segmentText: { fontSize: 11, fontWeight: '600', color: theme.textSecondary },
  segmentTextActive: { color: theme.textPrimary },
  divider: { width: 1, height: 20, backgroundColor: theme.border, marginHorizontal: 2 },
  sensor: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 28, paddingHorizontal: 8, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border },
  sensorOff: { opacity: 0.45 },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  sensorText: { fontSize: 11, color: theme.textSecondary },
});
