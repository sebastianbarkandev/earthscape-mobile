import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { resolveMediaUrl } from '@/common/config';
import { formatDuration, isoToDate } from '@/common/lib/normalizeDate';
import { LiveBadge } from './LiveBadge';
import type { VideoListItem } from '@/features/library/librarySlice';

interface Props {
  item: VideoListItem;
  live?: boolean;
  onPress: (item: VideoListItem) => void;
}

/** Thumbnail card shared by Library and Live grids (web: video-thumbnail-container). */
export function VideoCard({ item, live, onPress }: Props) {
  const recorded = isoToDate(item.start ?? item.date_posted);
  // '/static/thumbnails/...' on on-premise orgs, absolute CDN URL otherwise.
  const thumb = resolveMediaUrl(item.thumbnail_url);
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.thumbWrap}>
        {thumb ? (
          <Image source={{ uri: thumb }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View style={[styles.thumb, styles.thumbFallback]} />
        )}
        {live ? (
          <View style={styles.liveBadge}>
            <LiveBadge />
          </View>
        ) : item.duration ? (
          <View style={styles.duration}>
            <Text style={styles.durationText}>{formatDuration(item.duration)}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.meta}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {[item.user?.full_name, item.tail, recorded?.toLocaleDateString()]
            .filter(Boolean)
            .join(' · ')}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: theme.surface,
    borderRadius: theme.radiusMd,
    borderWidth: 1,
    borderColor: theme.border,
    overflow: 'hidden',
    margin: 6,
  },
  pressed: { borderColor: theme.borderStrong, backgroundColor: theme.bgSubtle },
  thumbWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.videoBg },
  thumb: { width: '100%', height: '100%' },
  thumbFallback: { backgroundColor: theme.bgActive },
  liveBadge: { position: 'absolute', top: 8, left: 8 },
  duration: {
    position: 'absolute',
    bottom: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  durationText: { color: '#FFFFFF', fontSize: 11, fontVariant: ['tabular-nums'] },
  meta: { padding: 10, gap: 3 },
  title: { fontSize: 13, fontWeight: '600', color: theme.textPrimary, lineHeight: 17 },
  sub: { fontSize: 11, color: theme.textSecondary },
});
