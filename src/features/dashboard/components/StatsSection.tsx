import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon, type IconName } from '@/common/components/Icon';
import type { DashboardStats } from '../api';
import { formatMiles } from '../dashboardModel';
import { SectionHeader } from './SectionHeader';

export type StatsWindow = '7d' | '30d';
const WINDOWS: ReadonlyArray<{ key: StatsWindow; label: string }> = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
];

interface Props {
  stats: DashboardStats;
}

/**
 * Web dashboard/components/StatsSection.jsx: "Distance flown" (miles), "Videos uploaded" and
 * "Library" (all-time total). The web gives each panel its own 7d/30d tab; the backend only
 * sends the two scalars per window (no series), so one shared toggle drives both panels here.
 */
export function StatsSection({ stats }: Props) {
  const [win, setWin] = useState<StatsWindow>('7d');
  const distance = win === '7d' ? stats.dist7days : stats.dist30days;
  const uploaded = win === '7d' ? stats.vid7days : stats.vid1month;
  return (
    <View style={styles.section}>
      <SectionHeader icon="chart-line" title="Flight stats" />
      <View style={styles.toggle} accessibilityRole="tablist">
        {WINDOWS.map((w) => {
          const on = w.key === win;
          return (
            <Pressable
              key={w.key}
              onPress={() => setWin(w.key)}
              style={[styles.toggleBtn, on && styles.toggleBtnOn]}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.toggleText, on && styles.toggleTextOn]}>{w.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.panels}>
        <StatPanel icon="route" label="Distance flown" value={formatMiles(distance)} unit="mi" />
        <StatPanel icon="upload" label="Videos uploaded" value={uploaded.toLocaleString()} />
        <StatPanel icon="folder" label="Library" value={stats.vidtotal.toLocaleString()} unit="videos" />
      </View>
    </View>
  );
}

function StatPanel({ icon, label, value, unit }: { icon: IconName; label: string; value: string; unit?: string }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHead}>
        <Icon name={icon} size={12} color={theme.textTertiary} />
        <Text style={styles.panelLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <View style={styles.valueRow}>
        <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {unit ? <Text style={styles.unit}>{unit}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: 8 },
  // Wraps to stacked full-width segments at AX text sizes (RESP-028: no rigid mapped row).
  toggle: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  toggleBtn: {
    flexGrow: 1,
    flexBasis: 140,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: theme.radiusPill,
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: theme.surface,
  },
  toggleBtnOn: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  toggleText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
  toggleTextOn: { color: theme.accentActive },
  // Wraps to one panel per row on narrow phones at large text sizes; three across otherwise.
  panels: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  panel: {
    flexGrow: 1,
    flexBasis: 100,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 12,
    gap: 6,
  },
  panelHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  panelLabel: { flex: 1, fontSize: 12, color: theme.textSecondary },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  value: { fontSize: 26, fontWeight: '700', color: theme.textPrimary, fontVariant: ['tabular-nums'] },
  unit: { fontSize: 12, color: theme.textTertiary },
});
