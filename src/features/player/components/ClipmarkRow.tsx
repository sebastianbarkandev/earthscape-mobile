import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { theme } from '@/common/theme';
import type { Clipmark } from '../api';

interface Props {
  clipmark: Clipmark;
  /** Seek target in video seconds (converted by the screen via TimeMapper). */
  onPress: (c: Clipmark) => void;
}

/** Tap-to-seek chip (mobile take on the web's event-card time chips). */
export function ClipmarkRow({ clipmark, onPress }: Props) {
  const label =
    clipmark.text?.trim() ||
    (clipmark.type === 'clip' ? 'Clip' : clipmark.type === 'plate' ? 'Plate' : 'Marker');
  return (
    <Pressable
      onPress={() => onPress(clipmark)}
      style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
    >
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: theme.surface,
    borderColor: theme.border,
    borderWidth: 1,
    borderRadius: theme.radiusSm,
    marginRight: 8,
    maxWidth: 200,
  },
  pressed: {
    backgroundColor: theme.accentTint,
    borderColor: theme.accent,
  },
  text: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.textPrimary,
  },
});
