import React, { useCallback, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { theme } from '@/common/theme';
import { verticalTouchSlop } from '@/common/touchTarget';
import { edgePadding, gridColumns } from '@/common/layout';
import { denseText } from '@/common/typography';
import { VideoCard } from '@/common/components/VideoCard';
import { EmptyState } from '@/common/components/EmptyState';
import { LoadMoreError } from '@/common/components/LoadMoreError';
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
  const cols = gridColumns(useWindowDimensions().width); // 2 on phones, 3–4 on iPad (RESP-011)
  const insets = useSafeAreaInsets(); // RESP-019: landscape grid must clear the cut-out strip

  useEffect(() => {
    dispatch(fetchVideos({ page: 1, sort }));
  }, [dispatch, sort]);

  // UI-029: `error` is part of the gate — a failed page keeps the list on screen with an
  // idle status, and `onEndReached` fires continuously at the bottom, which would retry the
  // failed page forever. The footer banner's Retry is the only way back in.
  const loadMore = useCallback(() => {
    // page 0 = first page not loaded yet (FlatList fires onEndReached on an empty list too).
    if (page > 0 && hasNext && status === 'idle' && !error) dispatch(fetchVideos({ page: page + 1, sort }));
  }, [dispatch, hasNext, status, page, sort, error]);

  /** Re-request the page that failed — `page` is still the last page that SUCCEEDED, and the
   *  reducer merges by id, so a retry can never duplicate a row. */
  const retryMore = useCallback(() => dispatch(fetchVideos({ page: page + 1, sort })), [dispatch, page, sort]);

  return (
    <View style={styles.screen}>
      {/* RESP-028: the chips used to sit in a rigid row — nothing could wrap, shrink or scroll,
          so at AX3 "Longest" left the screen entirely (and the count already overflowed at
          iPad Split View's 320pt). They now scroll like every other dense strip in the app;
          the vertical padding stays on the contentContainer so the chips' hitSlop is inside
          the strip's own frame (UI-023: a ScrollView clips slop that reaches outside it). */}
      <View testID="library-sort-bar" style={[styles.sortBar, edgePadding(insets, 12)]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.sortScroll}
          contentContainerStyle={styles.sortRow}
        >
          {SORTS.map((s) => (
            <Pressable
              key={s.key}
              onPress={() => dispatch(setSort(s.key))}
              style={[styles.sortChip, sort === s.key && styles.sortChipActive]}
              hitSlop={verticalTouchSlop(34)}
              accessibilityRole="tab"
              accessibilityState={{ selected: sort === s.key }}
            >
              <Text {...denseText} style={[styles.sortText, sort === s.key && styles.sortTextActive]}>
                {s.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        <Text {...denseText} style={styles.count} numberOfLines={1}>{total ? `${total} videos` : ''}</Text>
      </View>

      <FlatList
        data={items}
        numColumns={cols}
        key={cols}
        keyExtractor={(v) => String(v.id)}
        renderItem={({ item }) => <VideoCard item={item} columns={cols} onPress={openVideo} />}
        contentContainerStyle={[styles.list, edgePadding(insets, 6)]}
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
            <EmptyState title="Couldn't load the library" detail={error ?? undefined} action={{ label: 'Try again', onPress: () => dispatch(fetchVideos({ page: 1, sort })) }} />
          ) : (
            <EmptyState title="No videos yet" detail="Uploads from your organization appear here." />
          )
        }
        ListFooterComponent={
          status === 'loadingMore' ? (
            <ActivityIndicator style={styles.footer} color={theme.accent} />
          ) : error && items.length > 0 ? (
            <LoadMoreError message={error} onRetry={retryMore} retryLabel="Retry loading more videos" />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  /** The bar: side gutter (safe-area aware) + the right-aligned count. */
  sortBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  /** The scroller shrinks before the count does, and scrolls its chips instead of clipping them. */
  sortScroll: { flexGrow: 0, flexShrink: 1 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  // UI-022: paddingVertical + a 12pt label was a ~26pt strike; 34 + vertical slop is 44,
  // and the slop stays inside the row's own 10pt padding (gap 8 to the next chip).
  sortChip: {
    minHeight: 34,
    justifyContent: 'center',
    paddingHorizontal: 12,
    borderRadius: theme.radiusPill,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
  },
  sortChipActive: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  sortText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  sortTextActive: { color: theme.accent },
  count: { marginLeft: 'auto', paddingLeft: 8, flexShrink: 0, fontSize: 11, color: theme.textTertiary },
  list: { paddingHorizontal: 6, paddingBottom: 24, flexGrow: 1 },
  spinner: { marginTop: 80 },
  footer: { paddingVertical: 16 },
});
