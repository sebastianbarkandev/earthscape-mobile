import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { pagedSlice, showMoreLabel } from '@/common/showMore';
import { Icon } from '@/common/components/Icon';
import { formatTime, initialsOf } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setActiveClipmark } from '../../playerSlice';
import { useSeek } from '../../hooks/useSeek';
import { touchSlop } from '@/common/touchTarget';

/**
 * Web timeline/TakChatPanel: read-only history of `tak_chat` clipmarks from the
 * event payload (ingested from the stream's CoT track). No network of its own;
 * the global live TAK chat (features.tak_enabled) is out of scope.
 */
/** Messages rendered before the first "Show more" (UI-002). */
const CHAT_PAGE = 15;

export function TakChatPanel({ videoId }: { videoId: number }) {
  const dispatch = useAppDispatch();
  const seek = useSeek(videoId);
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const messages = useMemo(
    () => clipmarks.filter((c) => c.type === 'tak_chat').slice().sort((a, b) => (a.time_start ?? 0) - (b.time_start ?? 0)),
    [clipmarks],
  );
  // UI-002: the drawer does not scroll on its own — page the history instead of rendering
  // every CoT message of a long stream. Newest pages are revealed on demand.
  const [pages, setPages] = useState(1);
  const paged = pagedSlice(messages, CHAT_PAGE, pages);
  const moreLabel = showMoreLabel(paged, 'message');
  if (!messages.length) return <Text style={styles.empty}>No TAK chat messages.</Text>;
  return (
    <View style={styles.wrap}>
      {paged.shown.map((m) => {
        const d = m.the_json?.data;
        const sender = (d?.sender as string) || (m.text ? m.text.split(':')[0] : '') || 'Unknown';
        const body = (d?.message as string) ?? m.text ?? '';
        const t = m.video_position ?? (m.time_start != null ? seek.mapper?.utcToVideo(m.time_start) ?? null : null);
        return (
          <View key={m.id} style={styles.msg}>
            <View style={styles.avatar}><Text {...denseText} style={styles.avatarText}>{initialsOf(sender)}</Text></View>
            <View style={{ flex: 1, gap: 3 }}>
              <View style={styles.head}>
                <Text style={styles.sender} numberOfLines={1}>{sender}</Text>
                {d?.chatroom ? <Text style={styles.room} numberOfLines={1}>{String(d.chatroom)}</Text> : null}
              </View>
              <Text style={styles.body}>{body}</Text>
            </View>
            {t != null && (
              <Pressable
                style={styles.time}
                hitSlop={touchSlop(22)}
                onPress={() => { dispatch(setActiveClipmark(m.id)); if (m.video_position != null) seek.toVideo(m.video_position); else if (m.time_start != null) seek.toUtc(m.time_start); }}
              >
                <Icon name="clock" size={9} color={theme.accentActive} />
                <Text {...denseText} style={styles.timeText}>{formatTime(t, false)}</Text>
              </Pressable>
            )}
          </View>
        );
      })}
      {moreLabel && (
        <Pressable onPress={() => setPages((p) => p + 1)} style={styles.more} hitSlop={touchSlop(36)} accessibilityRole="button" accessibilityLabel={moreLabel}>
          <Text style={styles.moreText}>{moreLabel}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 10, gap: 8 },
  empty: { padding: 16, textAlign: 'center', color: theme.textTertiary, fontSize: 13 },
  more: { minHeight: 36, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 12, fontWeight: '600', color: theme.accentActive },
  msg: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border, padding: 10 },
  avatar: { width: 28, height: 28, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 11, fontWeight: '700', color: theme.accentActive },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sender: { fontSize: 12, fontWeight: '700', color: theme.textPrimary, flexShrink: 1 },
  // UI-006: a CoT chatroom name is arbitrary length — the pill shrinks and truncates
  // instead of pushing the sender out of the row / overflowing its own bounds.
  room: { fontSize: 10, color: theme.textTertiary, paddingHorizontal: 6, minHeight: 16, lineHeight: 16, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle, flexShrink: 1 },
  body: { fontSize: 13, color: theme.textPrimary, lineHeight: 18 },
  time: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 22, paddingHorizontal: 7, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle },
  timeText: { fontSize: 10, fontWeight: '600', color: theme.textPrimary, fontVariant: ['tabular-nums'] },
});
