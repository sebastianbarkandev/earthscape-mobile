import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { Icon, type IconName } from '@/common/components/Icon';
import { LiveBadge } from '@/common/components/LiveBadge';
import { TextPromptModal } from '@/common/components/TextPromptModal';
import { resolveMediaUrl } from '@/common/config';
import { formatDate, formatFileSize, formatTime, initialsOf } from '@/common/lib/formatTime';
import { userDisplayName } from '@/features/auth/bootstrap';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { EventVideo } from '../api';
import type { VideoCapabilities, DashboardLayout } from '../videoCapabilities';
import { clearOpFeedback, setLayout, toggleMapOption } from '../playerSlice';
import { downloadVideo, suggestDeletion, takeScreenshot, updateEventInfo } from '../eventThunks';
import { touchSlop, verticalTouchSlop } from '@/common/touchTarget';

interface Props {
  video: EventVideo;
  caps: VideoCapabilities;
  layout: DashboardLayout;
  layoutLocked: boolean; // !has_map or !has_video -> hide the segmented control (web LayoutButtons)
  clipmarkCount: number;
  onShare: () => void;
  /** Present only when this event is live and the device can publish: adds the phone camera as a second program. */
  onAddCamera?: () => void;
}

/**
 * Port of the web PlayerActionRow (REGION 2): lede (avatar · title · live badge ·
 * meta) + actions (Video/Split/Map · Share · Download · Screenshot · ⋮).
 * Export Data is deferred (see plan). Title edits: long-press (web: double-click).
 */
export function ActionRow({ video, caps, layout, layoutLocked, clipmarkCount, onShare, onAddCamera }: Props) {
  const dispatch = useAppDispatch();
  const op = useAppSelector((s) => s.player.op);
  const toggles = useAppSelector((s) => s.player.toggles);
  const drawnCount = video.drawn_objects?.length ?? 0;
  const tz = useAppSelector((s) => s.auth.bootstrap?.settings?.tz ?? null);
  const [editTitle, setEditTitle] = useState(false);
  const [deleteReason, setDeleteReason] = useState(false);

  // Surface thunk feedback exactly once (web: alert/toast), then clear it.
  useEffect(() => {
    if (op.error) Alert.alert('Something went wrong', op.error, [{ text: 'OK', onPress: () => dispatch(clearOpFeedback()) }]);
    else if (op.notice) Alert.alert(op.notice, undefined, [{ text: 'OK', onPress: () => dispatch(clearOpFeedback()) }]);
  }, [op.error, op.notice, dispatch]);

  const userName = userDisplayName(video.user);
  const avatar = resolveMediaUrl(video.user?.profile_img_url);
  const meta = [
    video.duration ? formatTime(video.duration) : null,
    video.start ? formatDate(video.start, tz) : null,
    userName,
    `${clipmarkCount} ${clipmarkCount === 1 ? 'event' : 'events'}`,
  ].filter(Boolean);

  const openMore = () => {
    const items: Array<{ label: string; onPress?: () => void; destructive?: boolean; disabled?: boolean }> = [
      { label: `${toggles.overlays ? '☑' : '☐'}  Map overlays`, onPress: () => dispatch(toggleMapOption('overlays')) },
    ];
    if (drawnCount > 0)
      items.push({ label: `${toggles.mapDrawings ? '☑' : '☐'}  Show map drawings`, onPress: () => dispatch(toggleMapOption('mapDrawings')) });
    const size = formatFileSize(video.uploaded_filesize);
    if (size) items.push({ label: `File size: ${size}`, disabled: true });
    items.push({
      label: 'Copy video ID',
      onPress: () => {
        Clipboard.setStringAsync(String(video.id)).then(() => Alert.alert('Copied', `Video ID ${video.id}`));
      },
    });
    if (caps.canDelete) items.push({ label: 'Suggest deletion', destructive: true, onPress: () => setDeleteReason(true) });

    const options = [...items.map((i) => i.label), 'Cancel'];
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: items.findIndex((i) => i.destructive) >= 0 ? items.findIndex((i) => i.destructive) : undefined,
          disabledButtonIndices: items.map((i, idx) => (i.disabled ? idx : -1)).filter((i) => i >= 0),
        },
        (idx) => items[idx]?.onPress?.(),
      );
    } else {
      Alert.alert('More', undefined, [...items.filter((i) => !i.disabled).map((i) => ({ text: i.label, onPress: i.onPress, style: i.destructive ? ('destructive' as const) : undefined })), { text: 'Cancel', style: 'cancel' }]);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.lede}>
        <View style={styles.avatar}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatarImg} /> : <Text {...denseText} style={styles.avatarText}>{initialsOf(userName)}</Text>}
        </View>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <Pressable
              onLongPress={caps.canEdit ? () => setEditTitle(true) : undefined}
              delayLongPress={350}
              style={{ flexShrink: 1 }}
            >
              <Text style={styles.title} numberOfLines={2}>
                {video.title || 'Untitled video'}
              </Text>
            </Pressable>
            {video.live_stream_state === 'live' && <LiveBadge />}
            {video.live_stream_state === 'processing' && (
              <View style={styles.endedBadge}>
                <Text style={styles.endedText} {...denseText}>Live ended</Text>
              </View>
            )}
          </View>
          <Text style={styles.meta} numberOfLines={2}>
            {meta.join(' · ')}
          </Text>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actions}>
        {!layoutLocked && (
          <View style={styles.segmented} accessibilityRole="tablist">
            {(['video', 'split', 'map'] as DashboardLayout[]).map((l) => (
              <Pressable
                key={l}
                onPress={() => dispatch(setLayout(l))}
                style={[styles.segment, layout === l && styles.segmentActive]}
                hitSlop={verticalTouchSlop(32)}
                accessibilityRole="tab"
                accessibilityState={{ selected: layout === l }}
                accessibilityLabel={`${l === 'video' ? 'Video' : l === 'split' ? 'Split' : 'Map'} layout`}
              >
                <Text style={[styles.segmentText, layout === l && styles.segmentTextActive]} {...denseText}>
                  {l === 'video' ? 'Video' : l === 'split' ? 'Split' : 'Map'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
        {onAddCamera && <ActionButton icon="video" label="Add my camera" onPress={onAddCamera} accent />}
        <ActionButton icon="share" label="Share" onPress={onShare} />
        {caps.showDownload && (
          <ActionButton
            icon="download"
            label={formatFileSize(video.uploaded_filesize) ? `Download · ${formatFileSize(video.uploaded_filesize)}` : 'Download'}
            busy={op.busy === 'download'}
            onPress={() => dispatch(downloadVideo(undefined))}
          />
        )}
        {/* LIVE-021: the screenshot endpoint 404s for a video without `duration` — every live
            program AND the whole `processing` transcode window after a phone stops publishing
            (caps.canScreenshot mirrors the backend's own rule) — show WHY instead of a button
            that can only fail. */}
        {!caps.canScreenshot ? (
          <ActionButton
            icon="camera"
            label="Screenshot"
            muted
            a11yHint={caps.isLive ? 'Unavailable while this program is live' : 'Unavailable until the recording is ready'}
            onPress={() => Alert.alert(caps.isLive ? 'Not available while live' : 'Not available yet', 'Screenshots can be taken once the live recording is ready.')}
          />
        ) : (
          <ActionButton icon="camera" label="Screenshot" busy={op.busy === 'screenshot'} onPress={() => dispatch(takeScreenshot())} />
        )}
        <ActionButton icon="ellipsis-vertical" a11yLabel="More actions" onPress={openMore} />
      </ScrollView>

      <TextPromptModal
        visible={editTitle}
        title="Edit title"
        initialValue={video.title}
        onCancel={() => setEditTitle(false)}
        onConfirm={(v) => {
          setEditTitle(false);
          if (v.trim() && v.trim() !== video.title) dispatch(updateEventInfo({ title: v.trim() }));
        }}
      />
      <TextPromptModal
        visible={deleteReason}
        title="Suggest deletion"
        message="Tell an administrator why this video should be deleted."
        placeholder="Reason"
        multiline
        confirmLabel="Send"
        destructive
        onCancel={() => setDeleteReason(false)}
        onConfirm={(v) => {
          setDeleteReason(false);
          dispatch(suggestDeletion(v.trim()));
        }}
      />
    </View>
  );
}

function ActionButton({ icon, label, a11yLabel, a11yHint, onPress, busy, accent, muted }: { icon: IconName; label?: string; /** Icon-only buttons: what VoiceOver says (RESP-009). */ a11yLabel?: string; a11yHint?: string; onPress: () => void; busy?: boolean; accent?: boolean; /** Action the backend cannot serve right now: dimmed, still tappable so the press can explain why. */ muted?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => [styles.action, accent && styles.actionAccent, muted && styles.actionMuted, pressed && styles.actionPressed]}
      hitSlop={touchSlop(36)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityHint={a11yHint}
      accessibilityState={{ busy: !!busy, disabled: !!busy }}
    >
      {busy ? <ActivityIndicator size="small" color={theme.textSecondary} /> : <Icon name={icon} size={14} color={accent ? theme.textOnAccent : muted ? theme.textTertiary : theme.textPrimary} />}
      {label ? <Text style={[styles.actionLabel, accent && { color: theme.textOnAccent }, muted && { color: theme.textTertiary }]} {...denseText}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, borderBottomWidth: 1, borderBottomColor: theme.border, paddingTop: 10, paddingBottom: 8, gap: 10 },
  lede: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingHorizontal: 12 },
  avatar: { width: 36, height: 36, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImg: { width: 36, height: 36 },
  avatarText: { color: theme.accentActive, fontWeight: '700', fontSize: 13 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: theme.textPrimary, lineHeight: 20 },
  endedBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: theme.radiusPill, backgroundColor: theme.bgActive },
  endedText: { fontSize: 11, fontWeight: '700', color: theme.textSecondary },
  meta: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
  // UI-023: the strip's frame CLIPS hit-testing, so its own vertical padding (not the
  // children's hitSlop) is what makes a 36pt-tall child a 44pt target inside a ScrollView.
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 4 },
  segmented: { flexDirection: 'row', backgroundColor: theme.bgSubtle, borderRadius: theme.radiusPill, padding: 2 },
  // UI-022: a text-sized box (paddingVertical + a 12pt label) was ~26pt; 32 + the strip's
  // padding is 44. The slop is vertical-only — the three segments sit at gap 0 (UI-024).
  segment: { minHeight: 32, paddingHorizontal: 12, justifyContent: 'center', borderRadius: theme.radiusPill },
  segmentActive: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border },
  segmentText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  segmentTextActive: { color: theme.textPrimary },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface },
  actionPressed: { backgroundColor: theme.bgSubtle },
  actionMuted: { backgroundColor: theme.bgSubtle, borderColor: theme.border },
  actionAccent: { backgroundColor: theme.liveRed, borderColor: theme.liveRed },
  actionLabel: { fontSize: 12, fontWeight: '600', color: theme.textPrimary },
});
