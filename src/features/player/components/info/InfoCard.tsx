import React, { useEffect, useState } from 'react';
import { ActionSheetIOS, Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { Icon } from '@/common/components/Icon';
import { TextPromptModal } from '@/common/components/TextPromptModal';
import { formatDate } from '@/common/lib/formatTime';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { getTags, getTails, postCreateTag, type EventTag, type EventVideo, type TagDef } from '../../api';
import { updateEventInfo, updateTail } from '../../eventThunks';
import { PublicShareTab } from '../share/PublicShareTab';
import type { VideoCapabilities } from '../../videoCapabilities';
import { touchSlop, verticalTouchSlop } from '@/common/touchTarget';

interface Props {
  video: EventVideo;
  caps: VideoCapabilities;
}

/** Strip HTML tags for descriptions authored in the web's rich-text editor. */
function plainText(html: string | null | undefined): string {
  if (!html) return '';
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** REGION 4 — web PlayerInfoCard: Details (PlayerDescription) + Sharing tabs. */
export function InfoCard({ video, caps }: Props) {
  const [tab, setTab] = useState<'details' | 'sharing'>('details');
  return (
    <View style={styles.card}>
      <View style={styles.tabs}>
        <Tab label="Details" on={tab === 'details'} onPress={() => setTab('details')} />
        {caps.canShare && <Tab label="Sharing" on={tab === 'sharing'} onPress={() => setTab('sharing')} />}
      </View>
      {tab === 'details' ? <Details video={video} caps={caps} /> : <View style={styles.body}><PublicShareTab /></View>}
    </View>
  );
}

function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.tab, on && styles.tabOn]} hitSlop={verticalTouchSlop(32)}>
      <Text {...denseText} style={[styles.tabText, on && styles.tabTextOn]}>{label}</Text>
    </Pressable>
  );
}

// ── Details (web PlayerDescription) ─────────────────────────────────────────────
function Details({ video, caps }: Props) {
  const dispatch = useAppDispatch();
  const tags = useAppSelector((s) => s.player.eventTags);
  const custom = useAppSelector((s) => s.player.customFieldValues);
  const tz = useAppSelector((s) => s.auth.bootstrap?.settings?.tz ?? null);
  const tagsEnabled = useAppSelector((s) => s.auth.bootstrap?.features?.tags_enabled ?? true);
  const eventId = useAppSelector((s) => s.player.eventId);
  const [editDesc, setEditDesc] = useState(false);
  const [editTail, setEditTail] = useState(false);
  const [tails, setTails] = useState<string[]>([]);
  const [tagPicker, setTagPicker] = useState(false);
  const [catalog, setCatalog] = useState<TagDef[] | null>(null);
  const [newTag, setNewTag] = useState<TagDef | null>(null);
  const [createTag, setCreateTag] = useState(false);

  useEffect(() => {
    if (editTail) getTails().then((r) => setTails(r.tails ?? [])).catch(() => setTails([]));
  }, [editTail]);
  useEffect(() => {
    if (tagPicker && catalog == null) getTags().then(setCatalog).catch(() => setCatalog([])); // 404 = tags disabled
  }, [tagPicker, catalog]);
  // Tag picker: existing definitions (ActionSheet) -> value prompt; or create a new definition.
  useEffect(() => {
    if (!tagPicker || catalog == null) return;
    setTagPicker(false);
    const defs = catalog;
    const labels = [...defs.map((d) => d.title), ...(caps.canCreateTags ? ['＋ New tag…'] : []), 'Cancel'];
    const choose = (i: number) => {
      if (i < defs.length) setNewTag(defs[i]);
      else if (caps.canCreateTags && i === defs.length) setCreateTag(true);
    };
    if (Platform.OS === 'ios') ActionSheetIOS.showActionSheetWithOptions({ title: 'Add tag', options: labels, cancelButtonIndex: labels.length - 1 }, choose);
    else Alert.alert('Add tag', undefined, [...labels.slice(0, -1).map((l, i) => ({ text: l, onPress: () => choose(i) })), { text: 'Cancel', style: 'cancel' }]);
  }, [tagPicker, catalog, caps.canCreateTags]);

  const removeTag = (t: EventTag) => dispatch(updateEventInfo({ tags: tags.filter((x) => x !== t) }));
  const addTagValue = (def: TagDef, value: string) => dispatch(updateEventInfo({ tags: [...tags, { tag: { id: def.id, title: def.title, slug: def.slug }, value }] }));
  const uploaded = video.date_posted ? Number(video.date_posted) : null;

  return (
    <View style={styles.body}>
      <Row label="Recorded" value={video.start ? formatDate(video.start, tz) : '—'} />
      <Row label="Uploaded" value={uploaded ? formatDate(uploaded, tz) : '—'} />
      <Row
        label="Vehicle"
        value={video.tail || '—'}
        onEdit={caps.canEdit ? () => setEditTail(true) : undefined}
      />

      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Text style={styles.label}>Description</Text>
          {caps.canEdit && (
            <Pressable onPress={() => setEditDesc(true)} hitSlop={touchSlop(11)} accessibilityRole="button" accessibilityLabel="Edit description"><Icon name="pen" size={11} color={theme.textSecondary} /></Pressable>
          )}
        </View>
        <Text style={styles.desc}>{plainText(video.description) || 'No description'}</Text>
      </View>

      {tagsEnabled && (
        <View style={styles.section}>
          <View style={styles.sectionHead}>
            <Text style={styles.label}>Tags</Text>
            {caps.canEdit && (
              <Pressable onPress={() => setTagPicker(true)} hitSlop={touchSlop(11)} accessibilityRole="button" accessibilityLabel="Add tag"><Icon name="plus" size={11} color={theme.textSecondary} /></Pressable>
            )}
          </View>
          <View style={styles.chips}>
            {tags.length === 0 && <Text style={styles.muted}>No tags</Text>}
            {tags.map((t, i) => (
              <View key={`${t.tag?.id ?? 'x'}-${t.value}-${i}`} style={styles.tagChip}>
                <Text style={styles.tagText} numberOfLines={2}>{t.tag?.title ? `${t.tag.title}: ` : ''}{t.value}</Text>
                {caps.canDeleteTags && (
                  <Pressable onPress={() => removeTag(t)} hitSlop={touchSlop(10)} accessibilityRole="button" accessibilityLabel={`Remove tag ${t.tag?.title ? `${t.tag.title}: ` : ''}${t.value}`}><Icon name="xmark" size={10} color={theme.textSecondary} /></Pressable>
                )}
              </View>
            ))}
          </View>
        </View>
      )}

      {custom && Object.keys(custom).length > 0 && (
        <View style={styles.section}>
          <Text style={styles.label}>Custom fields</Text>
          {Object.entries(custom).map(([k, v]) => (
            <Row key={k} label={k} value={v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v)} />
          ))}
        </View>
      )}

      <TextPromptModal
        visible={editDesc}
        title="Edit description"
        initialValue={plainText(video.description)}
        multiline
        onCancel={() => setEditDesc(false)}
        onConfirm={(v) => { setEditDesc(false); dispatch(updateEventInfo({ description: v.trim() })); }}
      />
      <TextPromptModal
        visible={editTail}
        title="Vehicle (tail)"
        message={tails.length ? `Known vehicles: ${tails.slice(0, 12).join(', ')}${tails.length > 12 ? '…' : ''}` : undefined}
        initialValue={video.tail ?? ''}
        placeholder="e.g. N123AB"
        onCancel={() => setEditTail(false)}
        onConfirm={(v) => { setEditTail(false); dispatch(updateTail(v)); }}
      />

      <TextPromptModal
        visible={!!newTag}
        title={newTag ? `${newTag.title} value` : ''}
        placeholder="Value"
        confirmLabel="Add"
        onCancel={() => setNewTag(null)}
        onConfirm={(v) => { if (newTag && v.trim()) addTagValue(newTag, v.trim()); setNewTag(null); }}
      />
      <TextPromptModal
        visible={createTag}
        title="New tag"
        message="Name of the new tag definition (a value is asked next)."
        placeholder="Tag name"
        confirmLabel="Create"
        onCancel={() => setCreateTag(false)}
        onConfirm={async (title) => {
          setCreateTag(false);
          const t = title.trim();
          if (!t) return;
          try {
            const res = await postCreateTag({ title: t, slug: slugify(t), eventId: eventId ?? undefined });
            setCatalog((c) => (c ? [...c.filter((x) => x.id !== res.tag.id), res.tag] : [res.tag]));
            setNewTag(res.tag);
          } catch (e) {
            Alert.alert('Could not create tag', e instanceof Error ? e.message : 'Request failed');
          }
        }}
      />
    </View>
  );
}

function Row({ label, value, onEdit }: { label: string; value: string; onEdit?: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} numberOfLines={2}>{value}</Text>
      {onEdit && <Pressable onPress={onEdit} hitSlop={touchSlop(11)} accessibilityRole="button" accessibilityLabel={`Edit ${label.toLowerCase()}`}><Icon name="pen" size={11} color={theme.textSecondary} /></Pressable>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, marginTop: 8, borderTopWidth: 1, borderBottomWidth: 1, borderColor: theme.border },
  tabs: { flexDirection: 'row', gap: 4, paddingHorizontal: 12, paddingTop: 8 },
  // UI-024: vertical-only slop — a symmetric one put "Sharing"'s hit rect 2pt inside the
  // "Details" tab (gap 4), and RN resolves an overlap to the LAST sibling written.
  tab: { paddingHorizontal: 12, minHeight: 32, justifyContent: 'center', borderRadius: theme.radiusPill },
  tabOn: { backgroundColor: theme.accentTint },
  tabText: { fontSize: 12, fontWeight: '600', color: theme.textSecondary },
  tabTextOn: { color: theme.accentActive },
  body: { padding: 12, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28 },
  label: { width: 88, fontSize: 12, fontWeight: '700', color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  value: { flex: 1, fontSize: 13, color: theme.textPrimary },
  section: { gap: 6 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  desc: { fontSize: 13, color: theme.textPrimary, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  // UI-006: minHeight (not height) + flexShrink so a long "Case number: 2026-…" value
  // wraps its chip to one row of the flexWrap container instead of spilling out of a 26pt box.
  tagChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26, paddingVertical: 3, paddingHorizontal: 9, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle, borderWidth: 1, borderColor: theme.border, flexShrink: 1, maxWidth: '100%' },
  tagText: { fontSize: 12, color: theme.textPrimary, flexShrink: 1 },
  muted: { fontSize: 12, color: theme.textTertiary },
});
