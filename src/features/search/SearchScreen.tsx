import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { EmptyState } from '@/common/components/EmptyState';
import { VideoCard } from '@/common/components/VideoCard';
import { useOpenVideo } from '@/features/library/useOpenVideo';
import type { VideoListItem } from '@/features/library/librarySlice';
import { countFilters, getFilterChoices, searchVideos, SORT_OPTIONS, type FilterChoices, type SearchFilters, type SearchSort } from './api';
import { FilterSheet } from './FilterSheet';

interface Props {
  initialQuery?: string;
}

/**
 * Mobile version of the web VideosPage (video_search): keyword search bar,
 * Filters sheet, Sort picker, results count, thumbnail grid with infinite
 * scroll. Same endpoint and params as the web (GET /api/v1/videos/list?…).
 */
export function SearchScreen({ initialQuery = '' }: Props) {
  const openVideo = useOpenVideo();
  const [keyword, setKeyword] = useState(initialQuery);
  const [filters, setFilters] = useState<SearchFilters>({ q: initialQuery });
  const [sort, setSort] = useState<SearchSort>('recently-uploaded');
  const [choices, setChoices] = useState<FilterChoices | null>(null);
  const [sheet, setSheet] = useState(false);
  const [items, setItems] = useState<VideoListItem[]>([]);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [status, setStatus] = useState<'idle' | 'loading' | 'more' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [titleFallback, setTitleFallback] = useState(false);
  const reqId = useRef(0);

  // Header search bar navigations update ?q= → re-run.
  useEffect(() => {
    setKeyword(initialQuery);
    setFilters((f) => ({ ...f, q: initialQuery }));
  }, [initialQuery]);

  useEffect(() => {
    getFilterChoices().then(setChoices).catch(() => setChoices({ users: [], tags: [], categories: [], tail_numbers: [] }));
  }, []);

  const load = useCallback(
    async (nextPage: number, append: boolean, useTitleFallback = false) => {
      const id = ++reqId.current;
      setStatus(append ? 'more' : 'loading');
      setError(null);
      try {
        // Backend `q` is Postgres full-text (plainto_tsquery): filename-like titles such as
        // "falls_1.ts" never match "falls". When full-text finds nothing, retry as a
        // title-contains (ilike) search and label the result — the web has no such fallback.
        let effective: SearchFilters = useTitleFallback && filters.q?.trim() ? { ...filters, q: undefined, title: filters.q.trim() } : filters;
        let fallback = useTitleFallback;
        let res = await searchVideos(effective, sort, nextPage);
        if (!append && res.total === 0 && filters.q?.trim() && !filters.title?.trim()) {
          effective = { ...filters, q: undefined, title: filters.q.trim() };
          const retry = await searchVideos(effective, sort, nextPage);
          if (retry.total > 0) {
            res = retry;
            fallback = true;
          }
        }
        if (id !== reqId.current) return;
        setTitleFallback(fallback);
        setItems(append ? (prev) => prev.concat(res.items) : res.items);
        setPage(res.page);
        setTotal(res.total);
        setHasNext(res.has_next);
        setStatus('idle');
      } catch (e) {
        if (id !== reqId.current) return;
        setStatus('error');
        setError(e instanceof Error ? e.message : 'Search failed');
      }
    },
    [filters, sort],
  );

  useEffect(() => {
    load(1, false);
  }, [load]);

  const submitKeyword = () => setFilters((f) => ({ ...f, q: keyword.trim() }));
  const pickSort = () => {
    const labels = SORT_OPTIONS.map((o) => o.label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title: 'Sort by', options: [...labels, 'Cancel'], cancelButtonIndex: labels.length }, (i) => { if (i < SORT_OPTIONS.length) setSort(SORT_OPTIONS[i].value); });
    } else {
      Alert.alert('Sort by', undefined, [...SORT_OPTIONS.map((o) => ({ text: o.label, onPress: () => setSort(o.value) })), { text: 'Cancel', style: 'cancel' }]);
    }
  };

  const nFilters = countFilters(filters);
  const perPage = 24;
  const rangeStart = total ? 1 : 0;
  const rangeEnd = Math.min(total, items.length);
  const summary =
    status === 'loading'
      ? 'Loading…'
      : total > perPage
        ? `Showing ${rangeStart}–${rangeEnd} of ${total} results`
        : `${total} ${total === 1 ? 'result' : 'results'}`;

  return (
    <View style={styles.screen}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <TextInput
            style={styles.searchInput}
            value={keyword}
            onChangeText={setKeyword}
            onSubmitEditing={submitKeyword}
            returnKeyType="search"
            placeholder="Search videos…"
            placeholderTextColor={theme.textTertiary}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {keyword.length > 0 && (
            <Pressable onPress={() => { setKeyword(''); setFilters((f) => ({ ...f, q: '' })); }} hitSlop={6}>
              <Icon name="xmark" size={12} color={theme.textTertiary} />
            </Pressable>
          )}
          <Pressable onPress={submitKeyword} hitSlop={6} style={styles.searchBtn}>
            <Icon name="magnifying-glass" size={14} color={theme.accent} />
          </Pressable>
        </View>
        <Pressable onPress={() => setSheet(true)} style={[styles.chip, nFilters > 0 && styles.chipActive]} hitSlop={4}>
          <Icon name="filter" size={12} color={nFilters ? theme.accentActive : theme.textSecondary} />
          <Text style={[styles.chipText, nFilters > 0 && styles.chipTextActive]}>Filters{nFilters ? ` · ${nFilters}` : ''}</Text>
        </Pressable>
        <Pressable onPress={pickSort} style={styles.chip} hitSlop={4}>
          <Icon name="arrow-down-wide-short" size={12} color={theme.textSecondary} />
          <Text style={styles.chipText} numberOfLines={1}>{SORT_OPTIONS.find((o) => o.value === sort)?.label}</Text>
        </Pressable>
      </View>
      <Text style={styles.summary}>
        {summary}
        {filters.q ? <Text> for <Text style={styles.bold}>“{filters.q}”</Text></Text> : null}
        {titleFallback ? <Text style={styles.note}> · no full-text matches, showing titles containing it</Text> : null}
      </Text>

      <FlatList
        data={items}
        numColumns={2}
        keyExtractor={(v) => String(v.id)}
        renderItem={({ item }) => <VideoCard item={item} onPress={openVideo} />}
        contentContainerStyle={styles.list}
        onEndReached={() => { if (hasNext && status === 'idle') load(page + 1, true, titleFallback); }}
        onEndReachedThreshold={0.6}
        refreshControl={<RefreshControl refreshing={status === 'loading' && items.length > 0} onRefresh={() => load(1, false)} tintColor={theme.accent} />}
        ListEmptyComponent={
          status === 'loading' ? (
            <ActivityIndicator style={styles.spinner} color={theme.accent} size="large" />
          ) : status === 'error' ? (
            <EmptyState title="Search failed" detail={error ?? undefined} />
          ) : (
            <EmptyState title="No videos match" detail="Try a different keyword or clear some filters." />
          )
        }
        ListFooterComponent={status === 'more' ? <ActivityIndicator style={styles.footer} color={theme.accent} /> : null}
        keyboardShouldPersistTaps="handled"
      />

      <FilterSheet visible={sheet} choices={choices} value={filters} onClose={() => setSheet(false)} onApply={(f) => { setSheet(false); setFilters({ ...f, q: filters.q }); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 10 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingLeft: 12, paddingRight: 4, borderRadius: theme.radiusPill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  searchInput: { flex: 1, fontSize: 14, color: theme.textPrimary, paddingVertical: 0 },
  searchBtn: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 11, borderRadius: theme.radiusPill, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, maxWidth: 150 },
  chipActive: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  chipTextActive: { color: theme.accentActive },
  summary: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: theme.textSecondary },
  bold: { fontWeight: '700', color: theme.textPrimary },
  note: { color: theme.textTertiary },
  list: { paddingHorizontal: 6, paddingBottom: 24, flexGrow: 1 },
  spinner: { marginTop: 80 },
  footer: { paddingVertical: 16 },
});
