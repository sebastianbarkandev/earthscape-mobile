import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon, type IconName } from '@/common/components/Icon';

interface Props {
  icon: IconName;
  title: string;
  /** Optional trailing link (web `.dash-section-link`, e.g. "See all"). */
  action?: { label: string; onPress: () => void };
}

/** Web dashboard/components/Headers.jsx SectionHeader: FA icon + title, optional right-aligned link. */
export function SectionHeader({ icon, title, action }: Props) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size={14} color={theme.accent} />
      <Text style={styles.title} numberOfLines={1}>
        {title}
      </Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          style={({ pressed }) => [styles.link, pressed && styles.linkPressed]}
          accessibilityRole="button"
          accessibilityLabel={action.label}
        >
          <Text style={styles.linkText}>{action.label}</Text>
          <Icon name="chevron-right" size={11} color={theme.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: theme.textPrimary },
  link: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 6, borderRadius: theme.radiusSm },
  linkPressed: { backgroundColor: theme.bgSubtle },
  linkText: { fontSize: 13, fontWeight: '600', color: theme.accent },
});
