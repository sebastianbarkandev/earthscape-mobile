import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, ActivityIndicator, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { BottomSheet } from '@/common/components/BottomSheet';
import { Icon } from '@/common/components/Icon';
import { TextPromptModal } from '@/common/components/TextPromptModal';
import { formatTime, parseTimestamp } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { clipToVideo, deleteClipmark, downloadClipmark, fetchClipFormats, updateClipmark } from '../../clipmarkThunks';
import { clearClipmarkError, setActiveClipmark } from '../../playerSlice';
import { useTimeMapper } from '../../hooks/useTimeMapper';
import { useSeek } from '../../hooks/useSeek';
import { canEditClipmark, formatDurationLabel, getEventType } from '../../timeline/clipmarkUtils';
import { selectCurrentUserId } from '../../timeline/selectors';
import { touchSlop, verticalTouchSlop } from '@/common/touchTarget';

interface Props {
  clipmarkId: number | null;
  videoId: number;
  onClose: () => void;
}

/**
 * Web EditTimelineEventModal + EventCardActions in one sheet: title/description,
 * start/end (mm:ss text or "Playhead" stamp, validated like the web), Make clip,
 * Download (formats probe → ts/mp4), Delete. Edits gated by canEditClipmark.
 */
export function ClipmarkSheet({ clipmarkId, videoId, onClose }: Props) {
  const dispatch = useAppDispatch();
  const c = useAppSelector((s) => s.player.clipmarks.find((x) => x.id === clipmarkId) ?? null);
  const op = useAppSelector((s) => s.player.clipmarkOp);
  const currentVideo = useAppSelector((s) => s.player.time.currentVideo);
  const duration = useAppSelector((s) => s.player.time.duration);
  const currentUserId = useAppSelector(selectCurrentUserId);
  const canUpdate = useAppSelector((s) => !!s.player.permissions?.videos.update);
  const mapper = useTimeMapper(videoId);
  const seek = useSeek(videoId);

  const [text, setText] = useState('');
  const [description, setDescription] = useState('');
  const [startStr, setStartStr] = useState('');
  const [endStr, setEndStr] = useState('');
  const [makeClip, setMakeClip] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!c) return;
    setText(c.text ?? '');
    setDescription(c.description ?? '');
    const s = c.time_start != null && mapper ? mapper.utcToVideo(c.time_start) : null;
    const e = c.time_end != null && mapper ? mapper.utcToVideo(c.time_end) : null;
    setStartStr(s != null ? formatTime(s, false) : '');
    setEndStr(e != null ? formatTime(e, false) : '');
    setErr(null);
  }, [c?.id, mapper]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (op.error) Alert.alert('Something went wrong', op.error, [{ text: 'OK', onPress: () => dispatch(clearClipmarkError()) }]);
  }, [op.error, dispatch]);

  if (!c) return null;
  const type = getEventType(c);
  const canEdit = canEditClipmark(c, currentUserId, canUpdate);
  const isClip = c.type === 'clip' && c.time_end != null;
  const busy = op.busyId === c.id && op.op != null;

  const save = () => {
    const start = startStr.trim() ? parseTimestamp(startStr) : NaN;
    const end = endStr.trim() ? parseTimestamp(endStr) : null;
    if (c.time_start != null && !Number.isFinite(start)) return setErr('Start time is required (mm:ss).');
    if (duration != null && Number.isFinite(start) && start > duration) return setErr('Start is past the end of the video.');
    if (end != null && (!Number.isFinite(end) || (Number.isFinite(start) && end <= start))) return setErr('End must be after start.');
    if (end != null && duration != null && end > duration) return setErr('End is past the end of the video.');
    const patch: { id: number; text: string; description: string; time_start?: number; time_end?: number | null } = { id: c.id, text: text.trim(), description: description.trim() };
    if (mapper && Number.isFinite(start)) patch.time_start = mapper.videoToUtc(start) ?? undefined;
    if (mapper && c.time_end != null && end != null) patch.time_end = mapper.videoToUtc(end);
    dispatch(updateClipmark(patch));
    onClose();
  };

  const download = async () => {
    const res = await dispatch(fetchClipFormats(c.id));
    const formats = fetchClipFormats.fulfilled.match(res) ? res.payload.formats : ['ts'];
    const go = (format: string) => dispatch(downloadClipmark({ id: c.id, format }));
    if (formats.length > 1 && Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: [...formats.map((f) => f.toUpperCase()), 'Cancel'], cancelButtonIndex: formats.length, title: 'Download format' },
        (i) => { if (i < formats.length) go(formats[i]); },
      );
    } else go(formats[0] ?? 'ts');
  };

  const remove = () =>
    Alert.alert('Delete event?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => { dispatch(deleteClipmark(c.id)); onClose(); } },
    ]);

  const stamp = (which: 'start' | 'end') => {
    const t = formatTime(currentVideo ?? 0, false);
    if (which === 'start') setStartStr(t); else setEndStr(t);
  };

  return (
    <BottomSheet onClose={onClose} cardStyle={styles.card}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            <View style={styles.head}>
              <View style={styles.pill}>
                <Icon name={type.icon} size={11} color={theme.accentActive} />
                <Text {...denseText} style={styles.pillText}>{type.label}</Text>
              </View>
              {isClip && <Text style={styles.dur}>{formatDurationLabel(c)}</Text>}
              <View style={{ flex: 1 }} />
              <Pressable onPress={onClose} hitSlop={touchSlop(16)} accessibilityRole="button" accessibilityLabel="Close event sheet"><Icon name="xmark" size={16} color={theme.textSecondary} /></Pressable>
            </View>

            <TextInput style={styles.input} value={text} onChangeText={setText} editable={canEdit} placeholder="Title" placeholderTextColor={theme.textTertiary} />
            <TextInput style={[styles.input, styles.multiline]} value={description} onChangeText={setDescription} editable={canEdit} multiline placeholder={canEdit ? 'Description' : 'No description'} placeholderTextColor={theme.textTertiary} />

            {c.time_start != null && (
              <View style={styles.times}>
                <TimeField label="Start" value={startStr} onChange={setStartStr} editable={canEdit} onStamp={() => stamp('start')} onSeek={() => c.time_start != null && seek.toUtc(c.time_start)} />
                {c.time_end != null && (
                  <TimeField label="End" value={endStr} onChange={setEndStr} editable={canEdit} onStamp={() => stamp('end')} onSeek={() => c.time_end != null && seek.toUtc(c.time_end)} />
                )}
              </View>
            )}
            {err && <Text style={styles.err}>{err}</Text>}

            <View style={styles.actions}>
              {canEdit && <Act icon="floppy-disk" label="Save" onPress={save} primary disabled={busy} />}
              {isClip && canEdit && <Act icon="film" label="Make clip" onPress={() => setMakeClip(true)} disabled={busy} />}
              {isClip && <Act icon="download" label="Download" onPress={download} disabled={busy} busy={busy && op.op === 'download'} />}
              {canEdit && <Act icon="trash" label="Delete" onPress={remove} danger disabled={busy} />}
              <Act icon="location-crosshairs" label="Highlight" onPress={() => { dispatch(setActiveClipmark(c.id)); onClose(); }} />
            </View>
          </ScrollView>
      <TextPromptModal
        visible={makeClip}
        title="Create video from clip"
        message="A new video will be rendered from this clip (server side). Give it a title."
        initialValue={text || 'New Clip'}
        confirmLabel="Create"
        onCancel={() => setMakeClip(false)}
        onConfirm={async (title) => {
          setMakeClip(false);
          const res = await dispatch(clipToVideo({ id: c.id, title: title.trim() || 'New Clip', description }));
          if (clipToVideo.fulfilled.match(res)) Alert.alert('Clip queued', `Video #${res.payload} is being rendered and will appear in the library when ready.`);
          else if (res.payload) Alert.alert('Could not create clip', String(res.payload));
        }}
      />
    </BottomSheet>
  );
}

function TimeField({ label, value, onChange, editable, onStamp, onSeek }: { label: string; value: string; onChange: (v: string) => void; editable: boolean; onStamp: () => void; onSeek: () => void }) {
  return (
    <View style={styles.timeField}>
      <Text style={styles.timeLabel}>{label}</Text>
      <TextInput style={[styles.input, styles.timeInput]} value={value} onChangeText={onChange} editable={editable} keyboardType="numbers-and-punctuation" placeholder="m:ss" placeholderTextColor={theme.textTertiary} />
      {editable && (
        <Pressable onPress={onStamp} style={styles.mini} hitSlop={verticalTouchSlop(30)}><Text {...denseText} style={styles.miniText}>Playhead</Text></Pressable>
      )}
      <Pressable onPress={onSeek} style={styles.mini} hitSlop={verticalTouchSlop(30)} accessibilityRole="button" accessibilityLabel={`Seek to ${label.toLowerCase()}`}><Icon name="play" size={10} color={theme.textSecondary} /></Pressable>
    </View>
  );
}

function Act({ icon, label, onPress, primary, danger, disabled, busy }: { icon: React.ComponentProps<typeof Icon>['name']; label: string; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean; busy?: boolean }) {
  const color = primary ? theme.textOnAccent : danger ? theme.danger : theme.textPrimary;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={[styles.act, primary && styles.actPrimary, danger && styles.actDanger, disabled && { opacity: 0.5 }]}>
      {busy ? <ActivityIndicator size="small" color={color} /> : <Icon name={icon} size={12} color={color} />}
      <Text {...denseText} style={[styles.actText, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, minHeight: 24, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint },
  pillText: { fontSize: 11, fontWeight: '700', color: theme.accentActive },
  dur: { fontSize: 12, color: theme.textSecondary, fontVariant: ['tabular-nums'] },
  input: { borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, paddingHorizontal: 10, paddingVertical: 9, fontSize: 14, color: theme.textPrimary },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  times: { gap: 8 },
  timeField: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeLabel: { width: 40, fontSize: 12, color: theme.textSecondary },
  timeInput: { flex: 1, paddingVertical: 6, fontVariant: ['tabular-nums'] },
  mini: { minHeight: 30, paddingHorizontal: 9, borderRadius: theme.radiusSm, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  miniText: { fontSize: 11, fontWeight: '600', color: theme.textSecondary },
  err: { color: theme.danger, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  // UI-024: a WRAPPING row (gap 8) — slop would overlap the row below it, so 44pt is real.
  act: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border },
  actPrimary: { backgroundColor: theme.accent, borderColor: theme.accent },
  actDanger: { borderColor: theme.danger },
  actText: { fontSize: 12, fontWeight: '600' },
});
