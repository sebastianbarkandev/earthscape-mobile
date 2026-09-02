import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { resolveMediaUrl } from '@/common/config';
import { isoToDate } from '@/common/lib/normalizeDate';
import type { DashboardImage } from '../api';

interface Props {
  images: DashboardImage[];
}

/**
 * Web dashboard ImageCard row (recent screenshots). Read-only tiles: the web links each to
 * its image page, which the app does not have — no dead Pressables (UI-005).
 */
export function ImageStrip({ images }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
      {images.map((img) => {
        const uri = resolveMediaUrl(img.thumbnail_url);
        const when = isoToDate(img.date_posted);
        return (
          <View key={img.id} style={styles.tile}>
            {uri ? <Image source={{ uri }} style={styles.thumb} resizeMode="cover" /> : <View style={[styles.thumb, styles.thumbFallback]} />}
            <Text style={styles.title} numberOfLines={1}>
              {img.title || 'Screenshot'}
            </Text>
            {when ? (
              <Text style={styles.sub} numberOfLines={1}>
                {when.toLocaleDateString()}
              </Text>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const TILE_W = 150;

const styles = StyleSheet.create({
  strip: { gap: 10 },
  tile: { width: TILE_W, backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border, overflow: 'hidden', paddingBottom: 8 },
  thumb: { width: '100%', aspectRatio: 16 / 9, backgroundColor: theme.videoBg },
  thumbFallback: { backgroundColor: theme.bgActive },
  title: { fontSize: 12, fontWeight: '600', color: theme.textPrimary, paddingHorizontal: 8, paddingTop: 6 },
  sub: { fontSize: 11, color: theme.textSecondary, paddingHorizontal: 8 },
});
