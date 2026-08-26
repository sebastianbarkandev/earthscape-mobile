import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { VideoCard } from '@/common/components/VideoCard';
import { EmptyState } from '@/common/components/EmptyState';
import { fetchVideos, setSort, type SortKey } from './librarySlice';
import { useOpenVideo } from './useOpenVideo';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'recently-uploaded', label: 'Recent' },
  { key: 'recently-recorded', label: 'Recorded' },
  { key: 'title-asc', label: 'A–Z' },
  { key: 'longest', label: 'Longest' },
];

export function LibraryScreen() {
  const dispatch = useAppDispatch();
  const { items, page, hasNext, sort, status, error, total } = useAppSelector((s) => s.library);
  const openVideo = useOpenVideo();

  useEffect(() => {
    dispatch(fetchVideos({ page: 1, sort }));
  }, [dispatch, sort]);

  const loadMore = useCallback(() => {
    // page 0 = first page not loaded yet (FlatList fires onEndReached on an empty list too).
    if (page > 0 && hasNext && status === 'idle') dispatch(fetchVideos({ page: page + 1, sort }));
  }, [dispatch, hasNext, status, page, sort]);

  return (
    <View style={styles.screen}>
      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable
            key={s.key}
            onPress={() => dispatch(setSort(s.key))}
            style={[styles.sortChip, sort === s.key && styles.sortChipActive]}
          >
            <Text style={[styles.sortText, sort === s.key && styles.sortTextActive]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.count}>{total ? `${total} videos` : ''}</Text>
      </View>

      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(v) => String(v.id)}
        renderItem={({ item }) => <VideoCard item={item} onPress={openVideo} />}
        contentContainerStyle={styles.list}
        onEndReached={loadMore}
        onEndReachedThreshold={0.6}
        refreshControl={
          <RefreshControl
            refreshing={status === 'loading' && items.length > 0}
            onRefresh={() => dispatch(fetchVideos({ page: 1, sort }))}
            tintColor={theme.accent}
          />
        }
        ListEmptyComponent={
          status === 'loading' ? (
            <ActivityIndicator style={styles.spinner} color={theme.accent} size="large" />
          ) : status === 'error' ? (
            <EmptyState title="Couldn't load the library" detail={error ?? undefined} />
          ) : (
            <EmptyState title="No videos yet" detail="Uploads from your organization appear here." />
          )
        }
        ListFooterComponent={
          status === 'loadingMore' ? (
            <ActivityIndicator style={styles.footer} color={theme.accent} />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  sortChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sortChipActive: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  sortText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  sortTextActive: { color: theme.accent },
  count: { marginLeft: 'auto', fontSize: 11, color: theme.textTertiary },
  list: { paddingHorizontal: 6, paddingBottom: 24, flexGrow: 1 },
  spinner: { marginTop: 80 },
  footer: { paddingVertical: 16 },
});
