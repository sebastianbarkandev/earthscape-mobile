import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';

/** Pulsing LIVE pill — mobile twin of the web's .pl-live-badge. */
export function LiveBadge() {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <View style={styles.badge}>
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
      <Text style={styles.text}>LIVE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.liveRed,
    borderRadius: theme.radiusPill,
    paddingHorizontal: 10,
    paddingVertical: 3,
    gap: 6,
  },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#FFFFFF' },
  text: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
