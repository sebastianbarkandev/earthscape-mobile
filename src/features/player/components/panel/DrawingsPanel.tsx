import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { Icon } from '@/common/components/Icon';
import { TextPromptModal } from '@/common/components/TextPromptModal';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import type { DrawnObject } from '../../api';
import { updateDrawnObject } from '../../eventThunks';
import { setFocusCoordinates } from '../../playerSlice';
import { selectCurrentUserId } from '../../timeline/selectors';

/** Web DrawnObjectsTable (read + rename + recenter); drawing tools themselves are out of scope. */
export function DrawingsPanel({ drawnObjects }: { drawnObjects: DrawnObject[] }) {
  const dispatch = useAppDispatch();
  const currentUserId = useAppSelector(selectCurrentUserId);
  const canDraw = useAppSelector((s) => !!s.player.permissions?.videos.draw);
  const [editing, setEditing] = useState<DrawnObject | null>(null);
  if (!drawnObjects.length) return <Text style={styles.empty}>No drawings on this video.</Text>;

  const coords = (d: DrawnObject): Array<{ label: string; lat: number; lon: number }> => {
    const g = d.the_geom;
    if (!g) return [];
    const pt = (c: unknown, label: string) =>
      Array.isArray(c) && c.length >= 2 ? [{ label, lat: Number(c[1]), lon: Number(c[0]) }] : [];
    if (g.type === 'Point') return pt(g.coordinates, 'Point');
    if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
      const cs = g.coordinates as unknown[];
      return [...pt(cs[0], 'From'), ...pt(cs[cs.length - 1], 'To')];
    }
    if (g.type === 'Polygon' && Array.isArray(g.coordinates)) return pt(((g.coordinates as unknown[])[0] as unknown[])?.[0], 'Vertex');
    return [];
  };

  return (
    <View style={styles.wrap}>
      {drawnObjects.map((d) => {
        const own = d.user?.id != null && d.user.id === currentUserId;
        return (
          <View key={d.id} style={styles.row}>
            <View style={[styles.swatch, { backgroundColor: d.color || theme.accent }]} />
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={styles.name} numberOfLines={1}>{d.text || `Drawing #${d.id}`}</Text>
              <View style={styles.chips}>
                <Text style={styles.type}>{d.the_geom?.type ?? 'Shape'}</Text>
                {coords(d).map((c) => (
                  <Pressable key={c.label} style={styles.chip} hitSlop={4} onPress={() => dispatch(setFocusCoordinates({ lat: c.lat, lon: c.lon }))}>
                    <Icon name="location-crosshairs" size={9} color={theme.accentActive} />
                    <Text style={styles.chipText}>{c.label} {c.lat.toFixed(4)}, {c.lon.toFixed(4)}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
            {canDraw && own && (
              <Pressable onPress={() => setEditing(d)} hitSlop={8}><Icon name="pen" size={12} color={theme.textSecondary} /></Pressable>
            )}
          </View>
        );
      })}
      <TextPromptModal
        visible={!!editing}
        title="Rename drawing"
        initialValue={editing?.text ?? ''}
        onCancel={() => setEditing(null)}
        onConfirm={(v) => {
          if (editing) dispatch(updateDrawnObject({ id: editing.id, text: v.trim(), color: editing.color || '#FB8333' }));
          setEditing(null);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: 10, gap: 8 },
  empty: { padding: 16, textAlign: 'center', color: theme.textTertiary, fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: theme.surface, borderRadius: theme.radiusMd, borderWidth: 1, borderColor: theme.border, padding: 10 },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  name: { fontSize: 13, fontWeight: '600', color: theme.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  type: { fontSize: 11, color: theme.textTertiary },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 22, paddingHorizontal: 7, borderRadius: theme.radiusPill, backgroundColor: theme.bgSubtle },
  chipText: { fontSize: 10, fontWeight: '600', color: theme.textPrimary, fontVariant: ['tabular-nums'] },
});
