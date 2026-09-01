import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { DENSE_MAX_FONT_SCALE, denseText } from '@/common/typography';
import { Icon } from '@/common/components/Icon';
import { formatTime } from '@/common/lib/formatTime';
import {
  TRANSCRIPT_FOLLOW_ROWS,
  TRANSCRIPT_WORDS_PER_ROW,
  activeWordIndex,
  followWordIndex,
  rowCountFor,
  rowOfWord,
  transcriptRowWindow,
} from '../../transcriptWindow';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { TranscriptWord } from '../../api';
import { fetchTranscript, startTranscription } from '../../eventThunks';
import { useSeek } from '../../hooks/useSeek';
import { touchSlop } from '@/common/touchTarget';

const POLL_MS = 3000; // web EventLayoutDefault polls every 3s while processing
const PENDING = new Set(['queued', 'loading', 'processing', 'started']);

/**
 * One row of word chips (RESP-024). The panel follows the 2 Hz playhead, but a row only
 * changes when the active word enters or leaves IT, so `activeIdx` is -1 for every other row
 * and `React.memo` keeps ~8 Pressables per row from re-rendering twice a second.
 * `words` comes straight from the store (stable identity) and `onSeek` is a stable callback.
 */
export const TranscriptRow = React.memo(function TranscriptRow({ words, row, activeIdx, onSeek }: { words: TranscriptWord[]; row: number; activeIdx: number; onSeek: (t: number) => void }) {
  const from = row * TRANSCRIPT_WORDS_PER_ROW;
  return (
    <View style={styles.row}>
      {words.slice(from, from + TRANSCRIPT_WORDS_PER_ROW).map((w, j) => {
        const idx = from + j;
        return (
          <Pressable
            key={idx}
            onPress={() => onSeek(w.start)}
            style={[styles.word, idx === activeIdx && styles.wordActive]}
            accessibilityRole="button"
            accessibilityLabel={`${w.word}, at ${formatTime(w.start, false)}`}
          >
            <Text style={[styles.wordText, idx === activeIdx && styles.wordTextActive]}>{w.word}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

/** Web Transcript.jsx: word chips with active-word tracking, tap-to-seek, search, auto-scroll; Generate when absent. */
export function TranscriptPanel({ videoId }: { videoId: number }) {
  const dispatch = useAppDispatch();
  const seek = useSeek(videoId);
  const { status, words, loading } = useAppSelector((s) => s.player.transcript);
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const [search, setSearch] = useState('');
  const [follow, setFollow] = useState(true);
  // UI-002: no inner scroll region — while following, a small window of rows centred on the
  // active word is rendered; browsing grows the window with "Show more".
  const [pages, setPages] = useState(1);

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

  // The highlight: -1 during a pause in speech, which is correct for a highlight.
  const activeIndex = useMemo(() => activeWordIndex(words, currentVideo), [words, currentVideo]);
  // The WINDOW must never be derived from `activeIndex` (REG-004): it is -1 in every silence
  // gap, so the rendered rows flipped between the follow window and the browse window at the
  // 2 Hz clock tick. The nearest word does not vanish between words.
  const followIndex = useMemo(() => followWordIndex(words, currentVideo), [words, currentVideo]);


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
        <Pressable hitSlop={touchSlop(36)} style={styles.primary} onPress={() => dispatch(startTranscription(videoId))}>
          <Icon name="closed-captioning" size={12} color={theme.textOnAccent} />
          <Text {...denseText} style={styles.primaryText}>Generate transcript</Text>
        </Pressable>
      </View>
    );
  }

  const q = search.trim().toLowerCase();
  const results = q ? words.map((w, i) => ({ w, i })).filter(({ w }) => w.word.toLowerCase().includes(q)).slice(0, 50) : [];
  const rowCount = rowCountFor(words.length);
  const win = transcriptRowWindow({ rowCount, activeRow: rowOfWord(followIndex), follow: follow && !q, pages });
  const rows = Array.from({ length: Math.max(0, win.end - win.start) }, (_, k) => win.start + k);

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Icon name="magnifying-glass" size={12} color={theme.textTertiary} />
          <TextInput maxFontSizeMultiplier={DENSE_MAX_FONT_SCALE} style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search transcript…" placeholderTextColor={theme.textTertiary} autoCorrect={false} />
        </View>
        <Pressable
          onPress={() => setFollow((f) => !f)}
          style={[styles.follow, follow && styles.followOn]}
          hitSlop={touchSlop(32)}
          accessibilityRole="button"
          accessibilityLabel={follow ? 'Stop following the playhead' : 'Follow the playhead'}
          accessibilityState={{ selected: follow }}
        >
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
        <View style={styles.list}>
          {win.following && rowCount > TRANSCRIPT_FOLLOW_ROWS && (
            <Text style={styles.windowNote}>Following the playhead — pause following to read the whole transcript.</Text>
          )}
          {rows.map((r) => (
            <TranscriptRow
              key={r}
              row={r}
              words={words}
              activeIdx={rowOfWord(activeIndex) === r ? activeIndex : -1}
              onSeek={seek.toVideo}
            />
          ))}
          {win.hidden > 0 && (
            <Pressable
              onPress={() => setPages((p) => p + 1)}
              style={styles.more}
              hitSlop={touchSlop(36)}
              accessibilityRole="button"
              accessibilityLabel={`Show more transcript (${win.hidden} rows hidden)`}
            >
              <Text style={styles.moreText}>Show more ({win.hidden} rows left)</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 10, gap: 8 },
  center: { padding: 16, alignItems: 'center', gap: 10 },
  muted: { color: theme.textTertiary, fontSize: 13 },
  primary: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, minHeight: 36, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  primaryText: { color: theme.textOnAccent, fontWeight: '700', fontSize: 13 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  search: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 32, paddingHorizontal: 10, borderRadius: theme.radiusSm, borderWidth: 1, borderColor: theme.borderStrong, backgroundColor: theme.surface },
  searchInput: { flex: 1, fontSize: 13, color: theme.textPrimary, paddingVertical: 0 },
  follow: { width: 32, height: 32, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  followOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  results: { gap: 4 },
  // UI-022: a search hit is a seek control, not prose — 24pt of padding + 13pt text was a
  // ~24pt strike.
  result: { flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 44, paddingVertical: 4 },
  resultTime: { fontSize: 11, color: theme.accentActive, fontVariant: ['tabular-nums'], width: 44 },
  resultWord: { fontSize: 13, color: theme.textPrimary },
  list: { gap: 2 },
  windowNote: { fontSize: 11, color: theme.textTertiary, paddingBottom: 2 },
  more: { minHeight: 36, marginTop: 4, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 12, fontWeight: '600', color: theme.accentActive },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingVertical: 2 },
  // UI-022 exception: transcript words are PROSE that happens to seek, not chrome. A 44pt box
  // per word would triple the panel and break the reading flow, so they stay a comfortable
  // ~29pt prose tap (the search field above gives a full-size row per hit). Recorded in
  // src/common/__tests__/touchTarget.test.ts (TOUCH_TARGET_EXCEPTIONS).
  word: { paddingHorizontal: 6, paddingVertical: 6, borderRadius: theme.radiusSm },
  wordActive: { backgroundColor: theme.accent },
  wordText: { fontSize: 13, color: theme.textPrimary },
  wordTextActive: { color: theme.textOnAccent, fontWeight: '600' },
});
