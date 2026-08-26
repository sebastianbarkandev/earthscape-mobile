import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { formatTime } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { fetchTranscript, startTranscription } from '../../eventThunks';
import { useSeek } from '../../hooks/useSeek';

const POLL_MS = 3000; // web EventLayoutDefault polls every 3s while processing
const PENDING = new Set(['queued', 'loading', 'processing', 'started']);

/** Web Transcript.jsx: word chips with active-word tracking, tap-to-seek, search, auto-scroll; Generate when absent. */
export function TranscriptPanel({ videoId }: { videoId: number }) {
  const dispatch = useAppDispatch();
  const seek = useSeek(videoId);
  const { status, words, loading } = useAppSelector((s) => s.player.transcript);
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  const listRef = useRef<FlatList<{ i: number }>>(null);

  // Initial fetch + polling while the job runs, paused while backgrounded.
  useEffect(() => {
    dispatch(fetchTranscript(videoId));
  }, [dispatch, videoId]);
  useEffect(() => {
    if (!status || !PENDING.has(status)) return;
    let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
      if (AppState.currentState === 'active') dispatch(fetchTranscript(videoId));
    }, POLL_MS);
    return () => { if (timer) clearInterval(timer); timer = null; };
  }, [status, dispatch, videoId]);

  const activeIndex = useMemo(() => {
    if (currentVideo == null) return -1;
    return words.findIndex((w) => w.start <= currentVideo && currentVideo <= w.end);
  }, [words, currentVideo]);

  useEffect(() => {
    if (follow && activeIndex >= 0 && !search) {
      listRef.current?.scrollToIndex({ index: Math.floor(activeIndex / 8), viewPosition: 0.5, animated: true });
    }
  }, [activeIndex, follow, search]);

  if (!words.length) {
    if (loading && !status) return <ActivityIndicator style={{ margin: 16 }} color={theme.accent} />;
    if (status && PENDING.has(status)) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={theme.accent} />
          <Text style={styles.muted}>Generating transcript…</Text>
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>{status === 'failed' ? 'Transcription failed.' : 'No transcript yet.'}</Text>
        <Pressable style={styles.primary} onPress={() => dispatch(startTranscription(videoId))}>
          <Icon name="closed-captioning" size={12} color={theme.textOnAccent} />
          <Text style={styles.primaryText}>Generate transcript</Text>
        </Pressable>
      </View>
    );
  }

  const q = search.trim().toLowerCase();
  const results = q ? words.map((w, i) => ({ w, i })).filter(({ w }) => w.word.toLowerCase().includes(q)).slice(0, 50) : [];
  // Render words in rows of 8 so FlatList can virtualize a long transcript.
  const rows = useMemo(() => Array.from({ length: Math.ceil(words.length / 8) }, (_, i) => ({ i })), [words.length]);

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Icon name="magnifying-glass" size={12} color={theme.textTertiary} />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search transcript…" placeholderTextColor={theme.textTertiary} autoCorrect={false} />
        </View>
        <Pressable onPress={() => setFollow((f) => !f)} style={[styles.follow, follow && styles.followOn]} hitSlop={4}>
          <Icon name={follow ? 'pause' : 'play'} size={10} color={follow ? theme.textOnAccent : theme.textSecondary} />
        </Pressable>
      </View>
      {q ? (
        <View style={styles.results}>
          {results.length === 0 ? <Text style={styles.muted}>No matches.</Text> : results.map(({ w, i }) => (
            <Pressable key={i} style={styles.result} onPress={() => seek.toVideo(w.start)}>
              <Text style={styles.resultTime}>{formatTime(w.start, false)}</Text>
              <Text style={styles.resultWord}>{w.word}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => String(r.i)}
          style={styles.list}
          nestedScrollEnabled
          onScrollToIndexFailed={() => undefined}
          renderItem={({ item }) => (
            <View style={styles.row}>
              {words.slice(item.i * 8, item.i * 8 + 8).map((w, j) => {
                const idx = item.i * 8 + j;
                return (
                  <Pressable key={idx} onPress={() => seek.toVideo(w.start)} style={[styles.word, idx === activeIndex && styles.wordActive]}>
                    <Text style={[styles.wordText, idx === activeIndex && styles.wordTextActive]}>{w.word}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 10, gap: 8 },
  center: { padding: 16, alignItems: 'center', gap: 10 },
  muted: { color: theme.textTertiary, fontSize: 13 },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 36, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  primaryText: { color: theme.textOnAccent, fontWeight: '700', fontSize: 13 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 10, borderRadius: theme.radiusSm, borderWidth: 1, borderColor: theme.borderStrong, backgroundColor: theme.surface },
  searchInput: { flex: 1, fontSize: 13, color: theme.textPrimary, paddingVertical: 0 },
  follow: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  followOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  results: { gap: 4 },
  result: { flexDirection: 'row', gap: 10, alignItems: 'center', paddingVertical: 4 },
  resultTime: { fontSize: 11, color: theme.accentActive, fontVariant: ['tabular-nums'], width: 44 },
  resultWord: { fontSize: 13, color: theme.textPrimary },
  list: { maxHeight: 240 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingVertical: 2 },
  word: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 4 },
  wordActive: { backgroundColor: theme.accent },
  wordText: { fontSize: 13, color: theme.textPrimary },
  wordTextActive: { color: theme.textOnAccent, fontWeight: '600' },
});
