import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { verticalTouchSlop } from '@/common/touchTarget';

interface Props {
  /** The failure text from the rejected request, if any. */
  message?: string | null;
  /** Re-request the page that failed (never page 1 — that would wipe the list). */
  onRetry: () => void;
  /** What VoiceOver reads on the retry control. */
  retryLabel?: string;
}

/**
 * UI-029: the footer surface for a "load more" that failed with items already on screen.
 *
 * The paginated lists rendered their error only through `ListEmptyComponent`, i.e. only when
 * the list was EMPTY — so a page-2 failure showed nothing at all, and because paging is gated
 * on an idle status, no further page was ever requested: scrolling silently did nothing.
 * This is LiveListScreen's stale-refresh banner (UI-005) in footer form.
 */
export function LoadMoreError({ message, onRetry, retryLabel = 'Retry loading more' }: Props) {
  return (
    <View style={styles.row} accessibilityRole="alert">
      <Icon name="triangle-exclamation" size={12} color={theme.danger} />
      <Text style={styles.text} numberOfLines={2}>{`Couldn't load more${message ? ` (${message})` : ''}`}</Text>
      <Pressable onPress={onRetry} style={styles.btn} hitSlop={verticalTouchSlop(30)} accessibilityRole="button" accessibilityLabel={retryLabel}>
        <Text style={styles.retry}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 12, marginVertical: 12, paddingHorizontal: 10, paddingVertical: 8, borderRadius: theme.radiusSm, backgroundColor: theme.bgSubtle, borderWidth: 1, borderColor: theme.border },
  text: { flex: 1, fontSize: 11, color: theme.textSecondary },
  // UI-022: a bare 12pt label is a ~16pt strike; 30 + vertical slop is 44, and the slop stays
  // inside the banner's own 8pt padding (UI-024: it can never reach a horizontal neighbour).
  btn: { minHeight: 30, paddingHorizontal: 6, justifyContent: 'center' },
  retry: { fontSize: 12, fontWeight: '700', color: theme.accentActive },
});
