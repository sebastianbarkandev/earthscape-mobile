import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { clearActiveGraphs, toggleGraph } from '../../graphSlice';
import { selectGraphFields } from '../../timeline/selectors';

/**
 * Web MetadataControls: search, category chips (empty selection = All), active
 * chips + Clear all, checkbox list. Colour swatches come from bootstrap meta
 * (the web's hashed fallback palette is dropped so swatches match the lines).
 */
export function MetadataWell({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const dispatch = useAppDispatch();
  const fields = useAppSelector(selectGraphFields);
  const [query, setQuery] = useState('');
  const [cats, setCats] = useState<string[]>([]);

  const categories = useMemo(() => {
    const m = new Map<string, number>();
    fields.forEach((f) => m.set(f.category, (m.get(f.category) ?? 0) + 1));
    return [...m.entries()];
  }, [fields]);
  const active = fields.filter((f) => f.on);
  const q = query.trim().toLowerCase();
  const visible = fields.filter((f) => (cats.length === 0 || cats.includes(f.category)) && (!q || f.name.toLowerCase().includes(q) || f.category.toLowerCase().includes(q)));

  return (
    <View style={styles.wrap}>
      <Pressable onPress={onToggle} style={styles.header} hitSlop={6}>
        <Icon name="chart-area" size={13} color={theme.textSecondary} />
        <Text style={styles.headerText}>Metadata</Text>
        <Text style={styles.count}>{fields.length ? `${active.length}/${fields.length} active` : 'no fields'}</Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={theme.textTertiary} />
      </Pressable>

      {active.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {active.map((f) => (
            <Pressable key={`${f.category}/${f.name}`} onPress={() => dispatch(toggleGraph({ category: f.category, name: f.name }))} style={styles.activeChip} hitSlop={4}>
              <View style={[styles.swatch, { backgroundColor: f.meta?.color ?? '#cc0000' }]} />
              <Text style={styles.activeChipText}>{f.name}</Text>
              <Icon name="xmark" size={10} color={theme.textSecondary} />
            </Pressable>
          ))}
          <Pressable onPress={() => dispatch(clearActiveGraphs())} style={styles.clear} hitSlop={4}>
            <Text style={styles.clearText}>Clear all</Text>
          </Pressable>
        </ScrollView>
      )}

      {expanded && (
        <View style={styles.body}>
          {fields.length === 0 ? (
            <Text style={styles.empty}>No metadata fields available for this video.</Text>
          ) : (
            <>
              <TextInput style={styles.search} value={query} onChangeText={setQuery} placeholder="Search fields…" placeholderTextColor={theme.textTertiary} autoCorrect={false} />
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Pressable onPress={() => setCats([])} style={[styles.catChip, cats.length === 0 && styles.catChipOn]}>
                  <Text style={[styles.catText, cats.length === 0 && styles.catTextOn]}>All ({fields.length})</Text>
                </Pressable>
                {categories.map(([c, n]) => {
                  const on = cats.includes(c);
                  return (
                    <Pressable key={c} onPress={() => setCats(on ? cats.filter((x) => x !== c) : [...cats, c])} style={[styles.catChip, on && styles.catChipOn]}>
                      <Text style={[styles.catText, on && styles.catTextOn]}>{c} ({n})</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              <ScrollView style={styles.list} nestedScrollEnabled>
                {visible.length === 0 ? (
                  <Text style={styles.empty}>No fields match “{query}”.</Text>
                ) : (
                  visible.map((f) => (
                    <Pressable key={`${f.category}/${f.name}`} onPress={() => dispatch(toggleGraph({ category: f.category, name: f.name }))} style={styles.fieldRow}>
                      <View style={[styles.checkbox, f.on && styles.checkboxOn]}>{f.on && <Icon name="check" size={10} color={theme.textOnAccent} />}</View>
                      <View style={[styles.swatch, { backgroundColor: f.meta?.color ?? '#cc0000' }]} />
                      <Text style={styles.fieldName} numberOfLines={1}>{f.name}</Text>
                      <Text style={styles.fieldMeta} numberOfLines={1}>{[f.category, f.meta?.unit].filter(Boolean).join(' · ')}</Text>
                    </Pressable>
                  ))
                )}
              </ScrollView>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: theme.surface, borderTopWidth: 1, borderTopColor: theme.border },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 40 },
  headerText: { fontSize: 13, fontWeight: '700', color: theme.textPrimary, flex: 1 },
  count: { fontSize: 11, color: theme.textTertiary },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 8 },
  activeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 26, paddingHorizontal: 9, borderRadius: theme.radiusPill, backgroundColor: theme.accentTint, borderWidth: 1, borderColor: theme.accent },
  activeChipText: { fontSize: 11, fontWeight: '600', color: theme.textPrimary },
  clear: { height: 26, paddingHorizontal: 9, justifyContent: 'center' },
  clearText: { fontSize: 11, fontWeight: '600', color: theme.textSecondary },
  body: { paddingBottom: 8, gap: 8 },
  search: { marginHorizontal: 12, borderWidth: 1, borderColor: theme.borderStrong, borderRadius: theme.radiusSm, paddingHorizontal: 10, height: 34, fontSize: 13, color: theme.textPrimary },
  catChip: { height: 26, paddingHorizontal: 10, justifyContent: 'center', borderRadius: theme.radiusPill, borderWidth: 1, borderColor: theme.border },
  catChipOn: { backgroundColor: theme.accentTint, borderColor: theme.accent },
  catText: { fontSize: 11, fontWeight: '600', color: theme.textSecondary },
  catTextOn: { color: theme.accentActive },
  list: { maxHeight: 260 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 36 },
  checkbox: { width: 18, height: 18, borderRadius: 4, borderWidth: 1.5, borderColor: theme.borderStrong, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  fieldName: { flex: 1, fontSize: 13, color: theme.textPrimary },
  fieldMeta: { fontSize: 11, color: theme.textTertiary, maxWidth: 120 },
  empty: { paddingHorizontal: 12, paddingVertical: 8, fontSize: 12, color: theme.textTertiary },
});
