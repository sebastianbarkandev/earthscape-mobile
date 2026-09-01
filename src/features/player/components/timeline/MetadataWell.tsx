import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { denseText } from '@/common/typography';
import { pagedSlice, showMoreLabel } from '@/common/showMore';
import { touchSlop, verticalTouchSlop } from '@/common/touchTarget';
import { Icon } from '@/common/components/Icon';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { clearActiveGraphs, toggleGraph } from '../../graphSlice';
import { selectGraphFields } from '../../timeline/selectors';

/**
 * Web MetadataControls: search, category chips (empty selection = All), active
 * chips + Clear all, checkbox list. Colour swatches come from bootstrap meta
 * (the web's hashed fallback palette is dropped so swatches match the lines).
 */
/** Field rows rendered before the first "Show more" (UI-002). */
const FIELD_PAGE = 12;

export function MetadataWell({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const dispatch = useAppDispatch();
  const fields = useAppSelector(selectGraphFields);
  const [query, setQuery] = useState('');
  const [cats, setCats] = useState<string[]>([]);
  // UI-002: the field list is NOT a nested scroll view any more — it shows FIELD_PAGE rows
  // and grows on demand, so the page ScrollView keeps every vertical drag.
  const [pages, setPages] = useState(1);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    fields.forEach((f) => m.set(f.category, (m.get(f.category) ?? 0) + 1));
    return [...m.entries()];
  }, [fields]);
  const active = fields.filter((f) => f.on);
  const q = query.trim().toLowerCase();
  const visible = fields.filter((f) => (cats.length === 0 || cats.includes(f.category)) && (!q || f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)));
  const paged = pagedSlice(visible, FIELD_PAGE, pages);
  const moreLabel = showMoreLabel(paged, 'field');

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onToggle} style={styles.header} hitSlop={6}>
        <Icon name="chart-area" size={13} color={theme.textSecondary} />
        <Text {...denseText} style={styles.headerText}>Metadata</Text>
        <Text {...denseText} style={styles.count}>{fields.length ? `${active.length}/${fields.length} active` : 'no fields'}</Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={theme.textTertiary} />
      </Pressable>

      {active.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {active.map((f) => (
            <Pressable key={`${f.category}/${f.name}`} onPress={() => dispatch(toggleGraph({ category: f.category, name: f.name }))} style={styles.activeChip} hitSlop={verticalTouchSlop(26)}>
              <View style={[styles.swatch, { backgroundColor: f.meta?.color ?? theme.graphDefault }]} />
              <Text {...denseText} style={styles.activeChipText}>{f.name}</Text>
              <Icon name="xmark" size={10} color={theme.textSecondary} />
            </Pressable>
          ))}
          <Pressable onPress={() => dispatch(clearActiveGraphs())} style={styles.clear} hitSlop={verticalTouchSlop(26)}>
            <Text {...denseText} style={styles.clearText}>Clear all</Text>
          </Pressable>
        </ScrollView>
      )}

      {expanded && (
        <View style={styles.body}>
          {fields.length === 0 ? (
            <Text style={styles.empty}>No metadata fields available for this video.</Text>
          ) : (
            <>
              <TextInput style={styles.search} value={query} onChangeText={(t) => { setQuery(t); setPages(1); }} placeholder="Search fields…" placeholderTextColor={theme.textTertiary} autoCorrect={false} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Pressable hitSlop={verticalTouchSlop(26)} onPress={() => setCats([])} style={[styles.catChip, cats.length === 0 && styles.catChipOn]}>
                  <Text {...denseText} style={[styles.catText, cats.length === 0 && styles.catTextOn]}>All ({fields.length})</Text>
                </Pressable>
                {categories.map(([c, n]) => {
                  const on = cats.includes(c);
                  return (
                    <Pressable hitSlop={verticalTouchSlop(26)} key={c} onPress={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])} style={[styles.catChip, on && styles.catChipOn]}>
                      <Text {...denseText} style={[styles.catText, on && styles.catTextOn]}>{c} ({n})</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <View>
                {visible.length === 0 ? (
                  <Text style={styles.empty}>No fields match “{query}”.</Text>
                ) : (
                  paged.shown.map((f) => (
                    <Pressable key={`${f.category}/${f.name}`} onPress={() => dispatch(toggleGraph({ category: f.category, name: f.name }))} style={styles.fieldRow}>
                      <View style={[styles.checkbox, f.on && styles.checkboxOn]}>{f.on && <Icon name="check" size={10} color={theme.textOnAccent} />}</View>
                      <View style={[styles.swatch, { backgroundColor: f.meta?.color ?? theme.graphDefault }]} />
                      <Text {...denseText} style={styles.fieldName} numberOfLines={1}>{f.name}</Text>
                      <Text {...denseText} style={styles.fieldMeta} numberOfLines={1}>{[f.category, f.meta?.unit].filter(Boolean).join(' · ')}</Text>
                    </Pressable>
                  ))
                )}
                {moreLabel && (
                  <Pressable onPress={() => setPages((p) => p + 1)} style={styles.more} hitSlop={touchSlop(36)} accessibilityRole="button" accessibilityLabel={moreLabel}>
                    <Text style={styles.moreText}>{moreLabel}</Text>
                  </Pressable>
                )}
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 40 },
  headerText: { fontSize: 13, fontWeight: '700', color: theme.textPrimary, flex: 1 },
  count: { fontSize: 11, color: theme.textTertiary },
  // UI-023: a ScrollView clips hit-testing to its frame, so the 26pt chips get to 44pt
  // through the strip's own padding; their slop is vertical-only (gap 6 between chips).
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 9 },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26, paddingHorizontal: 9, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint, borderWidth: 1, borderColor: theme.accent },
  activeChipText: { fontSize: 11, fontWeight: '600', color: theme.textPrimary },
  clear: { minHeight: 26, paddingHorizontal: 9, justifyContent: 'center' },
  clearText: { fontSize: 11, fontWeight: '600', color: theme.textSecondary },
  body: { paddingBottom: 8, gap: 8 },
  search: { marginHorizontal: 12, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, paddingHorizontal: 10, minHeight: 34, fontSize: 13, color: theme.textPrimary },
  catChip: { minHeight: 26, paddingHorizontal: 10, justifyContent: 'center', borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border },
  catChipOn: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  catText: { fontSize: 11, fontWeight: '600', color: theme.textSecondary },
  catTextOn: { color: theme.accentActive },
  more: { minHeight: 36, marginHorizontal: 12, marginTop: 4, borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 12, fontWeight: '600', color: theme.accentActive },
  // UI-024: stacked with no gap, so a slop-grown 36pt row reached into its neighbour and
  // toggled the wrong series — the height has to be real.
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, minHeight: 44 },
  checkbox: { width: 18, height: 18, borderRadius: theme.radiusXs, borderWidth: 1.5, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  swatch: { width: 10, height: 10, borderRadius: theme.radiusXs },
  fieldName: { flex: 1, fontSize: 13, color: theme.textPrimary },
  fieldMeta: { fontSize: 11, color: theme.textTertiary, maxWidth: 120 },
  empty: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: theme.textTertiary },
});
