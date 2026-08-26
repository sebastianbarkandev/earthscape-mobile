import React, { useMemo, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { formatTime } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { Clipmark } from '../../api';
import { deleteClipmark, updateClipmark } from '../../clipmarkThunks';
import { setActiveClipmark, setFocusCoordinates } from '../../playerSlice';
import { useSeek } from '../../hooks/useSeek';
import { canEditClipmark, clipmarkTitle, formatDurationLabel, getAuthor, getEventType } from '../../timeline/clipmarkUtils';
import { eventAuthors, filterEvents, type EventSort, type EventTypeFilter } from '../../timeline/eventFilters';
import { selectCurrentUserId } from '../../timeline/selectors';

interface Props {
  videoId: number;
  onOpenSheet: (id: number) => void;
}

const TYPE_OPTIONS: Array<{ key: EventTypeFilter; label: string }> = [
  { key: 'all', label: 'All types' }, { key: 'clip', label: 'Clips' }, { key: 'timepoint', label: 'Timepoints' },
  { key: 'note', label: 'Notes' }, { key: 'plate', label: 'Plates' }, { key: 'marker', label: 'Markers' }, { key: 'hardware', label: 'Hardware' },
];
const SORT_OPTIONS: Array<{ key: EventSort; label: string }> = [
  { key: 'time', label: 'Time (earliest first)' }, { key: 'last', label: 'Time (latest first)' }, { key: 'recent', label: 'Recently added' }, { key: 'oldest', label: 'Oldest added' },
];

/** Web TimelineEvents + TimelineEventsRow/EventCard*: search, filters, cards with seek chips and inline actions. */
export function EventsPanel({ videoId, onOpenSheet }: Props) {
  const dispatch = useAppDispatch();
  const seek = useSeek(videoId);
  const clipmarks = useAppSelector((s) => s.player.clipmarks);
  const activeId = useAppSelector((s) => s.player.timeline.activeClipmarkId);
  const currentUserId = useAppSelector(selectCurrentUserId);
  const canUpdate = useAppSelector((s) => !!s.player.permissions?.videos.update);
  const [search, setSearch] = useState('');
  const [type, setType] = useState<EventTypeFilter>('all');
  const [user, setUser] = useState<string | null>(null);
  const [sort, setSort] = useState<EventSort>('time');
  const [expanded, setExpanded] = useState<number | null>(null);

  const rows = useMemo(() => filterEvents(clipmarks, { search, type, user, sort }), [clipmarks, search, type, user, sort]);
  const authors = useMemo(() => eventAuthors(clipmarks), [clipmarks]);

  const pick = <T,>(title: string, options: Array<{ key: T; label: string }>, onPick: (k: T) => void) => {
    const labels = options.map((o) => o.label);
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions({ title, options: [...labels, 'Cancel'], cancelButtonIndex: labels.length }, (i) => { if (i < options.length) onPick(options[i].key); });
    } else {
      Alert.alert(title, undefined, [...options.map((o) => ({ text: o.label, onPress: () => onPick(o.key) })), { text: 'Cancel', style: 'cancel' }]);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.toolbar}>
        <View style={styles.search}>
          <Icon name="magnifying-glass" size={12} color={theme.textTertiary} />
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search timeline events…" placeholderTextColor={theme.textTertiary} autoCorrect={false} />
        </View>
        <Chip label={TYPE_OPTIONS.find((o) => o.key === type)?.label ?? 'Type'} active={type !== 'all'} onPress={() => pick('Filter by type', TYPE_OPTIONS, setType)} />
        {authors.length > 1 && (
          <Chip label={user ?? 'Anyone'} active={!!user} onPress={() => pick('Filter by user', [{ key: null as string | null, label: 'Anyone' }, ...authors.map((a) => ({ key: a as string | null, label: a }))], setUser)} />
        )}
        <Chip label="Sort" icon="arrow-down-wide-short" onPress={() => pick('Sort by', SORT_OPTIONS, setSort)} />
      </View>
      {rows.length === 0 ? (
        <Text style={styles.empty}>No timeline events</Text>
      ) : (
        rows.map((c) => (
          <EventCard
            key={c.id}
            c={c}
            active={c.id === activeId}
            expanded={expanded === c.id}
            canEdit={canEditClipmark(c, currentUserId, canUpdate)}
            videoSeconds={(utc: number) => seek.mapper?.utcToVideo(utc) ?? null}
            onToggle={() => { setExpanded(expanded === c.id ? null : c.id); dispatch(setActiveClipmark(c.id)); }}
            onSeekUtc={(t) => seek.toUtc(t)}
            onSeekVideo={(t) => seek.toVideo(t)}
            onFocus={(lat, lon) => dispatch(setFocusCoordinates({ lat, lon }))}
            onEdit={() => onOpenSheet(c.id)}
            onDelete={() => Alert.alert('Delete event?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => dispatch(deleteClipmark(c.id)) }])}
            onSaveDescription={(d) => dispatch(updateClipmark({ id: c.id, description: d }))}
          />
        ))
      )}
    </View>
  );
}

function Chip({ label, icon, active, onPress }: { label: string; icon?: React.ComponentProps<typeof Icon>['name']; active?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, active && styles.chipActive]} hitSlop={4}>
      {icon && <Icon name={icon} size={11} color={theme.textSecondary} />}
      <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>{label}</Text>
      {!icon && <Icon name="chevron-down" size={9} color={theme.textTertiary} />}
    </Pressable>
  );
}

interface CardProps {
  c: Clipmark; active: boolean; expanded: boolean; canEdit: boolean;
  videoSeconds: (utc: number) => number | null;
  onToggle: () => void; onSeekUtc: (t: number) => void; onSeekVideo: (t: number) => void;
  onFocus: (lat: number, lon: number) => void; onEdit: () => void; onDelete: () => void; onSaveDescription: (d: string) => void;
}

/** Web TimelineEventsRow: pill · title · actions · chevron; expanded → time chips, description (blur-save), author. */
function EventCard({ c, active, expanded, canEdit, videoSeconds, onToggle, onSeekUtc, onSeekVideo, onFocus, onEdit, onDelete, onSaveDescription }: CardProps) {
  const type = getEventType(c);
  const author = getAuthor(c);
  const [desc, setDesc] = useState(c.description ?? '');
  const seekStart = () => (c.video_position != null ? onSeekVideo(c.video_position) : c.time_start != null && onSeekUtc(c.time_start));
  const seekEnd = () => c.time_end != null && onSeekUtc(c.time_end); // web divided by 1000 here — a bug not replicated
  const label = (utc: number | null | undefined, videoPos?: number | null) => {
    const v = videoPos ?? (utc != null ? videoSeconds(utc) : null);
    return v != null ? formatTime(v, false) : '—';
  };
  const hasCoords = c.latitude != null && c.longitude != null;

  return (
    <View style={[styles.card, active && styles.cardActive]}>
      <Pressable onPress={onToggle} style={styles.cardHead}>
        <View style={styles.pill}>
          <Icon name={type.icon} size={10} color={theme.accentActive} />
          <Text style={styles.pillText}>{type.label}</Text>
        </View>
        <Text style={styles.title} numberOfLines={expanded ? undefined : 1}>{clipmarkTitle(c)}</Text>
        {canEdit && (
          <View style={styles.actions}>
            <Pressable onPress={onEdit} hitSlop={6}><Icon name="pen" size={12} color={theme.textSecondary} /></Pressable>
            <Pressable onPress={onDelete} hitSlop={6}><Icon name="xmark" size={13} color={theme.danger} /></Pressable>
          </View>
        )}
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={11} color={theme.textTertiary} />
      </Pressable>
      <View style={styles.chips}>
        {c.time_start != null && c.time_end != null ? (
          <>
            <TimeChip label={label(c.time_start, c.video_position)} onPress={seekStart} />
            <Text style={styles.arrow}>⟶</Text>
            <TimeChip label={label(c.time_end)} onPress={seekEnd} />
            <Text style={styles.dur}>{formatDurationLabel(c)}</Text>
          </>
        ) : c.time_start != null ? (
          <TimeChip label={`at ${label(c.time_start, c.video_position)}`} onPress={seekStart} />
        ) : hasCoords ? (
          <TimeChip label={`${(c.latitude as number).toFixed(4)}, ${(c.longitude as number).toFixed(4)}`} icon="location-crosshairs" onPress={() => onFocus(c.latitude as number, c.longitude as number)} />
        ) : null}
        {author && <Text style={styles.author} numberOfLines={1}>· {author.fullname}</Text>}
      </View>
      {expanded && (
        <View style={styles.body}>
          {c.the_json?.data?.notes ? <Text style={styles.desc}>{String(c.the_json.data.notes)}</Text> : null}
          {canEdit ? (
            <TextInput
              style={styles.descInput}
              value={desc}
              onChangeText={setDesc}
              onBlur={() => { if (desc.trim() !== (c.description ?? '').trim()) onSaveDescription(desc.trim()); }}
              multiline
              placeholder="Add a description…"
              placeholderTextColor={theme.textTertiary}
            />
          ) : (
            <Text style={styles.desc}>{c.description?.trim() || 'No description'}</Text>
          )}
        </View>
      )}
    </View>
  );
}

function TimeChip({ label, icon, onPress }: { label: string; icon?: React.ComponentProps<typeof Icon>['name']; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.timeChip} hitSlop={4}>
      <Icon name={icon ?? 'play'} size={9} color={theme.accentActive} />
      <Text style={styles.timeChipText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, padding: 10 },
  toolbar: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 6, flexGrow: 1, minWidth: 160, height: 32, paddingHorizontal: 10, borderRadius: theme.radiusSm, borderWidth: 1, borderColor: theme.borderStrong, backgroundColor: theme.surface },
  searchInput: { flex: 1, fontSize: 13, color: theme.textPrimary, paddingVertical: 0 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, backgroundColor: theme.surface, maxWidth: 160 },
  chipActive: { borderColor: theme.accent, backgroundColor: theme.accentTint },
  chipText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  chipTextActive: { color: theme.accentActive },
  empty: { padding: 16, textAlign: 'center', color: theme.textTertiary, fontSize: 13 },
  card: { backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border, padding: 10, gap: 8 },
  cardActive: { borderColor: theme.accent },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, height: 22, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint },
  pillText: { fontSize: 10, fontWeight: '700', color: theme.accentActive },
  title: { flex: 1, fontSize: 13, fontWeight: '600', color: theme.textPrimary },
  actions: { flexDirection: 'row', gap: 12, paddingHorizontal: 4 },
  chips: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  timeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 24, paddingHorizontal: 8, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle },
  timeChipText: { fontSize: 11, fontWeight: '600', color: theme.textPrimary, fontVariant: ['tabular-nums'] },
  arrow: { fontSize: 11, color: theme.textTertiary },
  dur: { fontSize: 11, color: theme.textSecondary },
  author: { fontSize: 11, color: theme.textTertiary, flexShrink: 1 },
  body: { gap: 6 },
  desc: { fontSize: 12, color: theme.textSecondary, lineHeight: 17 },
  descInput: { fontSize: 12, color: theme.textPrimary, lineHeight: 17, borderWidth: 1, borderColor: theme.border, borderRadius: theme.radiusSm, padding: 8, minHeight: 56, textAlignVertical: 'top' },
});
