import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';

interface Props {
  title: string;
  detail?: string;
  compact?: boolean;
}

/** Empty screens are an invitation to act — plain, direct, no mood. */
export function EmptyState({ title, detail, compact }: Props) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  compact: { padding: 16 },
  title: { fontSize: 14, fontWeight: '600', color: theme.textSecondary },
  detail: { fontSize: 12, color: theme.textTertiary, textAlign: 'center' },
});
