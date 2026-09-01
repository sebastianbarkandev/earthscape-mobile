import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { denseText } from '@/common/typography';

/**
 * Footer tab-bar label. React Navigation scales `tabBarLabelStyle` text inside a fixed
 * 49pt bar, so at AX sizes the label wraps under the icon and is cut; this caps it at
 * the dense-chrome multiplier and keeps it on one line (RESP-005).
 */
export function TabLabel({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Text style={[styles.label, { color }]} numberOfLines={1} {...denseText}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11, fontWeight: '600', textAlign: 'center' },
});
