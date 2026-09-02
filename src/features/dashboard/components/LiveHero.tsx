import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { resolveMediaUrl } from '@/common/config';
import { Icon } from '@/common/components/Icon';
import { LiveBadge } from '@/common/components/LiveBadge';
import type { VideoListItem } from '@/features/library/librarySlice';
import type { DashboardVideo } from '../api';
import { toListItem } from '../dashboardModel';

interface Props {
  video: DashboardVideo;
  onPress: (item: VideoListItem) => void;
}

/** Web dashboard/components/LiveHero.jsx: the first live stream, full-width with a LIVE badge and a "Watch now" call to action. */
export function LiveHero({ video, onPress }: Props) {
  const thumb = resolveMediaUrl(video.thumbnail_url);
  const who = video.user?.full_name || video.user?.username || null;
  return (
    <Pressable
      onPress={() => onPress(toListItem(video))}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={`Watch live: ${video.title}`}
    >
      <View style={styles.thumbWrap}>
        {thumb ? <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.thumbFallback]} />}
        <View style={styles.badge}>
          <LiveBadge />
        </View>
      </View>
      <View style={styles.meta}>
        <View style={styles.text}>
          <Text style={styles.title} numberOfLines={2}>
            {video.title}
          </Text>
          <Text style={styles.sub} numberOfLines={1}>
            {[who, video.tail].filter(Boolean).join(' · ') || 'Live now'}
          </Text>
        </View>
        <View style={styles.cta}>
          <Icon name="play" size={12} color={theme.textOnAccent} />
          <Text style={styles.ctaText}>Watch now</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 44,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
  },
  pressed: { borderColor: theme.borderStrong, backgroundColor: theme.bgSubtle },
  thumbWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.videoBg },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { backgroundColor: theme.bgActive },
  badge: { position: 'absolute', top: 10, left: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  text: { flex: 1, gap: 3 },
  title: { fontSize: 15, fontWeight: '700', color: theme.textPrimary },
  sub: { fontSize: 12, color: theme.textSecondary },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 10, borderRadius: theme.radiusPill, backgroundColor: theme.liveRed },
  ctaText: { fontSize: 13, fontWeight: '700', color: theme.textOnAccent },
});
