import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon, type IconName } from '@/common/components/Icon';
import { useAppSelector } from '@/store/hooks';
import type { EventVideo } from '../../api';
import { EventsPanel } from './EventsPanel';
import { TakChatPanel } from './TakChatPanel';
import { DrawingsPanel } from './DrawingsPanel';
import { TranscriptPanel } from './TranscriptPanel';

type TabId = 'events' | 'takchat' | 'drawings' | 'transcript';

interface Props {
  video: EventVideo;
  onOpenClipmark: (id: number) => void;
}

/**
 * Web PlayerSidePanel in its stacked (≤1100px) form: horizontal icon strip +
 * drawer. Tabs are data-gated exactly like the web (no permission/setting gates);
 * re-tapping the active tab collapses the drawer; the drawer starts collapsed
 * on phones (web starts open) so the action row stays reachable.
 */
export function SidePanel({ video, onOpenClipmark }: Props) {
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const events = useMemo(() => clipmarks.filter((c) => c.type !== 'tak_chat'), [clipmarks]);
  const chat = useMemo(() => clipmarks.filter((c) => c.type === 'tak_chat'), [clipmarks]);
  const drawings = video.drawn_objects ?? [];
  const showTranscript = !!video.has_audio && video.audio_enabled !== false;

  const tabs = useMemo(() => {
    const t: Array<{ id: TabId; label: string; icon: IconName; badge?: number }> = [];
    if (events.length) t.push({ id: 'events', label: 'Events', icon: 'bookmark', badge: events.length });
    if (chat.length) t.push({ id: 'takchat', label: 'TAK Chat', icon: 'comments', badge: chat.length });
    if (drawings.length) t.push({ id: 'drawings', label: 'Drawings', icon: 'pen-ruler', badge: drawings.length });
    if (showTranscript) t.push({ id: 'transcript', label: 'Transcript', icon: 'closed-captioning' });
    return t;
  }, [events.length, chat.length, drawings.length, showTranscript]);

  const [active, setActive] = useState<TabId | null>(null);
  useEffect(() => {
    // web tabKey effect: fall back when the current tab's content disappears
    if (active && !tabs.some((t) => t.id === active)) setActive(null);
  }, [tabs, active]);

  if (tabs.length === 0) return null;

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <Pressable key={t.id} onPress={() => setActive(on ? null : t.id)} style={[styles.tab, on && styles.tabOn]} hitSlop={4}>
              <Icon name={t.icon} size={12} color={on ? theme.accentActive : theme.textSecondary} />
              <Text style={[styles.tabText, on && styles.tabTextOn]}>{t.label}</Text>
              {t.badge != null && (
                <View style={[styles.badge, on && styles.badgeOn]}>
                  <Text style={[styles.badgeText, on && { color: theme.textOnAccent }]}>{t.badge}</Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
      {active && (
        <View style={styles.drawer}>
          <View style={styles.drawerHead}>
            <Text style={styles.drawerTitle}>{tabs.find((t) => t.id === active)?.label}</Text>
            <Pressable onPress={() => setActive(null)} hitSlop={8}><Icon name="xmark" size={14} color={theme.textSecondary} /></Pressable>
          </View>
          <ScrollView style={styles.drawerBody} nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {active === 'events' && <EventsPanel videoId={video.id} onOpenSheet={onOpenClipmark} />}
            {active === 'takchat' && <TakChatPanel videoId={video.id} />}
            {active === 'drawings' && <DrawingsPanel drawnObjects={drawings} />}
            {active === 'transcript' && <TranscriptPanel videoId={video.id} />}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border },
  strip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 11, borderRadius: theme.radiusPill },
  tabOn: { backgroundColor: theme.accentTint },
  tabText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  tabTextOn: { color: theme.accentActive },
  badge: { minWidth: 18, height: 18, paddingHorizontal: 5, borderRadius: 9, backgroundColor: theme.bgActive, alignItems: 'center', justifyContent: 'center' },
  badgeOn: { backgroundColor: theme.accent },
  badgeText: { fontSize: 10, fontWeight: '700', color: theme.textSecondary },
  drawer: { borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: theme.bg },
  drawerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 36 },
  drawerTitle: { fontSize: 12, fontWeight: '700', color: theme.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  drawerBody: { maxHeight: 340 },
});
