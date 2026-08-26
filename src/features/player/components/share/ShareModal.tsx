import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { getApiHost } from '@/common/config';
import { formatTime, parseTimestamp } from '@/common/lib/formatTime';
import { useAppSelector } from '@/store/hooks';
import type { EventVideo } from '../../api';
import { PublicShareTab } from './PublicShareTab';

const START_PARAM = 't';

interface Props {
  video: EventVideo;
  onClose: () => void;
}

/**
 * Port of the web ShareLink two-tab modal:
 *  • Copy link (default) — the org-host video URL for people who already have
 *    access, with a YouTube-style "Start at" that defaults ON, seeded from the
 *    playhead when the modal opened, editable as m:ss / h:mm:ss.
 *  • Public share — PublicShareTab (same component as the info card's tab).
 */
export function ShareModal({ video, onClose }: Props) {
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const [tab, setTab] = useState<'link' | 'public'>('link');
  const [startAtEnabled, setStartAtEnabled] = useState(true);
  const [startAt, setStartAt] = useState('0:00');
  const [copied, setCopied] = useState(false);

  // Seed once from the playhead (web: frozen at mount).
  useEffect(() => {
    if (currentVideo != null && Number.isFinite(currentVideo) && currentVideo > 0) setStartAt(formatTime(currentVideo, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const baseUrl = useMemo(() => `${getApiHost()}/videos/${video.id}`, [video.id]);
  const startSeconds = parseTimestamp(startAt);
  const shareUrl = startAtEnabled && Number.isFinite(startSeconds) && startSeconds > 0 ? `${baseUrl}?${START_PARAM}=${Math.floor(startSeconds)}` : baseUrl;

  const copy = async () => {
    await Clipboard.setStringAsync(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <View style={styles.header}>
            <Text style={styles.title}>Share</Text>
            <Pressable onPress={onClose} hitSlop={8}><Icon name="xmark" size={16} color={theme.textSecondary} /></Pressable>
          </View>
          <View style={styles.tabs}>
            <TabBtn icon="link" label="Copy link" on={tab === 'link'} onPress={() => setTab('link')} />
            <TabBtn icon="globe" label="Public share" on={tab === 'public'} onPress={() => setTab('public')} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            {tab === 'link' ? (
              <>
                <View style={styles.linkBar}>
                  <Text style={styles.linkText} numberOfLines={1} selectable>{shareUrl}</Text>
                  <Pressable onPress={copy} style={[styles.copyBtn, copied && styles.copyBtnDone]} hitSlop={4}>
                    <Icon name={copied ? 'check' : 'copy'} size={12} color={theme.textOnAccent} />
                    <Text style={styles.copyText}>{copied ? 'Copied' : 'Copy'}</Text>
                  </Pressable>
                </View>
                <View style={styles.startRow}>
                  <Switch value={startAtEnabled} onValueChange={setStartAtEnabled} trackColor={{ true: theme.accent }} />
                  <Text style={styles.startLabel}>Start at</Text>
                  <TextInput
                    style={[styles.timeInput, !startAtEnabled && styles.disabled]}
                    value={startAt}
                    onChangeText={setStartAt}
                    editable={startAtEnabled}
                    keyboardType="numbers-and-punctuation"
                    placeholder="0:00"
                    placeholderTextColor={theme.textTertiary}
                  />
                  {startAtEnabled && !Number.isFinite(startSeconds) && <Text style={styles.error}>m:ss</Text>}
                </View>
                <Pressable onPress={() => Share.share({ url: shareUrl, message: shareUrl, title: video.title }).catch(() => undefined)} style={styles.secondary}>
                  <Icon name="share" size={12} color={theme.textPrimary} />
                  <Text style={styles.secondaryText}>Share…</Text>
                </Pressable>
                <Text style={styles.hint}>This link opens the video for people who already have access. Use the Public share tab to create a link anyone can view.</Text>
              </>
            ) : (
              <PublicShareTab />
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TabBtn({ icon, label, on, onPress }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, on && styles.tabOn]} hitSlop={4}>
      <Icon name={icon} size={12} color={on ? theme.accentActive : theme.textSecondary} />
      <Text style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.surface, borderTopLeftRadius: theme.radiusLg, borderTopRightRadius: theme.radiusLg, paddingBottom: 28, maxHeight: '88%' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: '700', color: theme.textPrimary },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: theme.border },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 40, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabOn: { borderBottomColor: theme.accent },
  tabText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
  tabTextOn: { color: theme.accentActive },
  body: { padding: 16, gap: 12 },
  linkBar: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, paddingLeft: 10, paddingRight: 4, height: 40, backgroundColor: theme.bgSubtle },
  linkText: { flex: 1, fontSize: 13, color: theme.textPrimary },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: theme.radiusSm, backgroundColor: theme.accent },
  copyBtnDone: { backgroundColor: theme.success },
  copyText: { color: theme.textOnAccent, fontSize: 12, fontWeight: '700' },
  startRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  startLabel: { fontSize: 14, color: theme.textPrimary },
  timeInput: { width: 90, height: 34, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, paddingHorizontal: 10, fontSize: 14, color: theme.textPrimary, fontVariant: ['tabular-nums'] },
  disabled: { opacity: 0.5 },
  error: { fontSize: 11, color: theme.danger },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 40, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border },
  secondaryText: { color: theme.textPrimary, fontWeight: '600', fontSize: 13 },
  hint: { fontSize: 12, color: theme.textTertiary, lineHeight: 17 },
});
