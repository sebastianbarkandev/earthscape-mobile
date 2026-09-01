import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { touchSlop } from '@/common/touchTarget';

interface Props {
  title: string;
  detail?: string;
  compact?: boolean;
  /** Optional recovery affordance — a failed load must offer a retry, not just a sentence (UI-005). */
  action?: { label: string; onPress: () => void };
}

/** Empty screens are an invitation to act — plain, direct, no mood. */
export function EmptyState({ title, detail, compact, action }: Props) {
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <Text style={styles.title}>{title}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
      {action ? (
        <Pressable onPress={action.onPress} style={styles.action} hitSlop={touchSlop(36)} accessibilityRole="button" accessibilityLabel={action.label}>
          <Text style={styles.actionText}>{action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 6 },
  compact: { padding: 16 },
  // textAlign: a two-line title (long org/video names, Larger Text) stayed left-ragged
  // inside the centred column (UI-020).
  title: { fontSize: 14, fontWeight: '600', color: theme.textSecondary, textAlign: 'center' },
  detail: { fontSize: 12, color: theme.textTertiary, textAlign: 'center' },
  action: { marginTop: 6, minHeight: 36, paddingHorizontal: 18, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.accent, backgroundColor: theme.accentTint, alignItems: 'center', justifyContent: 'center' },
  actionText: { fontSize: 13, fontWeight: '700', color: theme.accentActive },
});
