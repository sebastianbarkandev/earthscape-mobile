import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { getClosestPointValueOrNull } from '@/common/lib/timeSeries';
import { useAppSelector } from '@/store/hooks';
import { selectActiveSeries } from '../../timeline/selectors';
import { formatReadoutValue } from '../../timeline/readout';

/**
 * Web InfoBox as native rows: swatch · name · value at the skimmer (or playhead).
 * RESP-024: the playhead is subscribed to HERE, not in TimelineCard — this list is the only
 * part of the card that has to follow the 2 Hz clock, and the card's toolbar / metadata well
 * used to re-render with it.
 */
export function ReadoutList({ skimUtc }: { skimUtc: number | null }) {
  const series = useAppSelector(selectActiveSeries);
  const currentUtc = useAppSelector((s) => s.player.time.currentUtc);
  const atUtc = skimUtc ?? currentUtc;
  if (!series.length) return null;
  return (
    <View style={styles.wrap}>
      {series.map((s) => {
        const v = atUtc != null ? getClosestPointValueOrNull(s.series, atUtc) : null;
        return (
          <View key={s.key} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: s.meta.color }]} />
            <Text style={styles.name} numberOfLines={1}>
              {s.name}
            </Text>
            <Text style={styles.value} numberOfLines={1}>
              {formatReadoutValue(s.name, s.meta, v)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 12, paddingVertical: 6, gap: 3, backgroundColor: theme.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 10, height: 10, borderRadius: theme.radiusXs },
  name: { flex: 1, fontSize: 12, color: theme.textSecondary },
  value: { fontSize: 12, fontWeight: '600', color: theme.textPrimary, fontVariant: ['tabular-nums'] },
});
