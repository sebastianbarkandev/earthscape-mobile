import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { BottomSheet } from '@/common/components/BottomSheet';
import { Icon } from '@/common/components/Icon';
import { userDisplayName } from '@/features/auth/bootstrap';
import type { FilterChoices, SearchFilters } from './api';
import { touchSlop, verticalTouchSlop } from '@/common/touchTarget';

interface Props {
  visible: boolean;
  choices: FilterChoices | null;
  value: SearchFilters;
  onApply: (f: SearchFilters) => void;
  onClose: () => void;
}

const dateToMs = (s: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? t : null;
};
const msToDate = (ms: number | null | undefined) => (ms == null ? '' : new Date(ms).toISOString().slice(0, 10));
const validTime = (s: string) => s === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

/**
 * Mobile take on the web FilterVideosForm: title, uploader, tail, category,
 * tags, recorded time-of-day window, upload date range. Duration filters are
 * omitted — the backend never implemented longerThan/shorterThan.
 */
export function FilterSheet({ visible, choices, value, onApply, onClose }: Props) {
  const [f, setF] = useState<SearchFilters>(value);
  const [startDate, setStartDate] = useState(msToDate(value.startDate));
  const [endDate, setEndDate] = useState(msToDate(value.endDate));
  React.useEffect(() => {
    if (visible) {
      setF(value);
      setStartDate(msToDate(value.startDate));
      setEndDate(msToDate(value.endDate));
    }
  }, [visible, value]);

  const toggle = <T,>(list: T[] | undefined, v: T): T[] => (list?.includes(v) ? list.filter((x) => x !== v) : [...(list ?? []), v]);
  const toggleTag = (slug: string, v: string) => setF({ ...f, tags: { ...(f.tags ?? {}), [slug]: toggle(f.tags?.[slug], v) } });
  const timeOk = validTime(f.startTime ?? '') && validTime(f.endTime ?? '');
  const datesOk = (startDate === '' || dateToMs(startDate) != null) && (endDate === '' || dateToMs(endDate) != null);

  const apply = () => {
    if (!timeOk || !datesOk) return;
    onApply({ ...f, startDate: startDate ? dateToMs(startDate) : null, endDate: endDate ? dateToMs(endDate) : null });
  };
  const clear = () => onApply({ q: f.q });

  return (
    <BottomSheet visible={visible} onClose={onClose}>
          <View style={styles.head}>
            <Text style={styles.title}>Filter videos</Text>
            <Pressable onPress={onClose} hitSlop={touchSlop(16)} accessibilityRole="button" accessibilityLabel="Close filters"><Icon name="xmark" size={16} color={theme.textSecondary} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Field label="Title contains">
              <TextInput style={styles.input} value={f.title ?? ''} onChangeText={(t) => setF({ ...f, title: t })} placeholder="Any title" placeholderTextColor={theme.textTertiary} />
            </Field>

            {!!choices?.users?.length && (
              <Field label="Uploaded by">
                <Chips items={choices.users.map((u) => ({ key: u.id, label: userDisplayName(u) }))} selected={f.user ?? []} onToggle={(id) => setF({ ...f, user: toggle(f.user, id as number) })} />
              </Field>
            )}
            {!!choices?.tail_numbers?.length && (
              <Field label="Vehicle">
                <Chips items={choices.tail_numbers.map((t) => ({ key: t, label: t }))} selected={f.tail ?? []} onToggle={(t) => setF({ ...f, tail: toggle(f.tail, t as string) })} />
              </Field>
            )}
            {!!choices?.categories?.length && (
              <Field label="Category">
                <Chips items={choices.categories.map((c) => ({ key: c.id, label: c.full_path ?? c.name ?? String(c.id) }))} selected={f.category ?? []} onToggle={(id) => setF({ ...f, category: toggle(f.category, id as number) })} />
              </Field>
            )}
            {choices?.tags?.filter((t) => t.values?.length).map((t) => (
              <Field key={t.slug} label={`Tag · ${t.title}`}>
                <Chips items={t.values.map((v) => ({ key: v, label: v }))} selected={f.tags?.[t.slug] ?? []} onToggle={(v) => toggleTag(t.slug, v as string)} />
              </Field>
            ))}

            <Field label="Recorded between (time of day, org timezone)">
              <View style={styles.pair}>
                <TextInput style={[styles.input, styles.half, !validTime(f.startTime ?? '') && styles.invalid]} value={f.startTime ?? ''} onChangeText={(t) => setF({ ...f, startTime: t })} placeholder="HH:MM" placeholderTextColor={theme.textTertiary} keyboardType="numbers-and-punctuation" />
                <Text style={styles.to}>to</Text>
                <TextInput style={[styles.input, styles.half, !validTime(f.endTime ?? '') && styles.invalid]} value={f.endTime ?? ''} onChangeText={(t) => setF({ ...f, endTime: t })} placeholder="HH:MM" placeholderTextColor={theme.textTertiary} keyboardType="numbers-and-punctuation" />
              </View>
            </Field>
            <Field label="Uploaded between (dates)">
              <View style={styles.pair}>
                <TextInput style={[styles.input, styles.half, startDate !== '' && dateToMs(startDate) == null && styles.invalid]} value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textTertiary} keyboardType="numbers-and-punctuation" />
                <Text style={styles.to}>to</Text>
                <TextInput style={[styles.input, styles.half, endDate !== '' && dateToMs(endDate) == null && styles.invalid]} value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" placeholderTextColor={theme.textTertiary} keyboardType="numbers-and-punctuation" />
              </View>
            </Field>
          </ScrollView>
          <View style={styles.actions}>
            <Pressable hitSlop={touchSlop(40)} onPress={clear} style={styles.secondary}><Text {...denseText} style={styles.secondaryText}>Clear all</Text></Pressable>
            <View style={{ flex: 1 }} />
            <Pressable hitSlop={touchSlop(40)} onPress={apply} disabled={!timeOk || !datesOk} style={[styles.primary, (!timeOk || !datesOk) && { opacity: 0.5 }]}>
              <Text {...denseText} style={styles.primaryText}>Apply filters</Text>
            </Pressable>
          </View>
    </BottomSheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

function Chips<K extends string | number>({ items, selected, onToggle }: { items: Array<{ key: K; label: string }>; selected: K[]; onToggle: (k: K) => void }) {
  return (
    <View style={styles.chips}>
      {items.map((it) => {
        const on = selected.includes(it.key);
        return (
          <Pressable key={String(it.key)} onPress={() => onToggle(it.key)} style={[styles.chip, on && styles.chipOn]} hitSlop={verticalTouchSlop(34)}>
            {on && <Icon name="check" size={10} color={theme.accentActive} />}
            <Text {...denseText} style={[styles.chipText, on && styles.chipTextOn]} numberOfLines={1}>{it.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
  title: { fontSize: 17, fontWeight: '700', color: theme.textPrimary },
  body: { paddingHorizontal: 16, gap: 14, paddingBottom: 8 },
  field: { gap: 6 },
  label: { fontSize: 11, fontWeight: '700', color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { minHeight: 38, paddingHorizontal: 12, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, fontSize: 14, color: theme.textPrimary },
  invalid: { borderColor: theme.danger },
  pair: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  half: { flex: 1 },
  to: { fontSize: 12, color: theme.textTertiary },
  // UI-028: a WRAPPING row — the neighbour below is a VERTICAL one, so the 5pt slop of a
  // 34pt box needs a rowGap of at least 10 (a 24pt box needed 10pt/side and overlapped the
  // line above by 14pt). rowGap only applies BETWEEN wrapped lines, so the dense single-line
  // case is unchanged.
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, rowGap: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 34, paddingHorizontal: 10, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, maxWidth: '100%' },
  chipOn: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  chipText: { fontSize: 12, color: theme.textSecondary, fontWeight: '600' },
  chipTextOn: { color: theme.accentActive },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: theme.border },
  primary: { minHeight: 40, paddingHorizontal: 18, borderRadius: theme.radiusPill, backgroundColor: theme.accent, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: theme.textOnAccent, fontWeight: '700', fontSize: 13 },
  secondary: { minHeight: 40, paddingHorizontal: 14, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: theme.textPrimary, fontWeight: '600', fontSize: 13 },
});
