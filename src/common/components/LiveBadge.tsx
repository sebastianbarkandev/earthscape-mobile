import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { useReduceMotion } from '@/common/hooks/useReduceMotion';

/** Pulsing LIVE pill — mobile twin of the web's .pl-live-badge. Static under Reduce Motion (RESP-008). */
export function LiveBadge() {
  const pulse = useRef(new Animated.Value(1)).current;
  const reduceMotion = useReduceMotion();
  useEffect(() => {
    // null = not known yet: stay static rather than flash a pulse at a user who opted out.
    if (reduceMotion !== false) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, reduceMotion]);

  return (
    <View style={styles.badge} accessibilityRole="text" accessibilityLabel="Live">
      <Animated.View style={[styles.dot, { opacity: pulse }]} />
      <Text style={styles.text} {...denseText}>LIVE</Text>
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
  dot: { width: 7, height: 7, borderRadius: theme.radiusPill, backgroundColor: theme.textOnAccent },
  text: {
    color: theme.textOnAccent,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.4,
  },
});
