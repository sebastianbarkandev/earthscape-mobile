import React from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { BottomSheet } from '@/common/components/BottomSheet';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setMapType, toggleMapOption, type MapType } from '../playerSlice';
import { touchSlop } from '@/common/touchTarget';

interface Props {
  visible: boolean;
  onClose: () => void;
  hasTarget: boolean;
  hasDrawings: boolean;
}

/**
 * Mobile take on the web LayersControl modal: base map (radio) + overlays
 * (checkboxes). KML/TAK/NEXRAD/reporting layers are not built (out of scope).
 */
export function MapLayersSheet({ visible, onClose, hasTarget, hasDrawings }: Props) {
  const dispatch = useAppDispatch();
  const mapType = useAppSelector((s) => s.player.mapType);
  const toggles = useAppSelector((s) => s.player.toggles);

  const bases: Array<{ key: MapType; label: string }> = [
    { key: 'hybrid', label: 'Aerial Labeled' },
    { key: 'satellite', label: 'Aerial Imagery' },
    { key: 'standard', label: 'Street Map' },
  ];

  return (
    <BottomSheet visible={visible} onClose={onClose} animationType="fade" cardStyle={styles.card}>
      {/* REG-003: BottomSheet caps the card at 0.88 x window height. A landscape iPhone window
          is ~393pt and this sheet's content is 393-531pt, so without a scroll region the
          overlay toggles and "Done" render below the screen edge and cannot be reached at all
          (the card is bottom-anchored). Every other sheet keeps a ScrollView for the same reason. */}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
          <Text style={styles.heading}>Base map</Text>
          {bases.map((b) => (
            <Pressable hitSlop={touchSlop(40)} key={b.key} style={styles.row} onPress={() => dispatch(setMapType(b.key))}>
              <View style={[styles.radio, mapType === b.key && styles.radioOn]} />
              <Text style={styles.label}>{b.label}</Text>
            </Pressable>
          ))}
          <Text style={[styles.heading, { marginTop: 12 }]}>Overlays</Text>
          <Row label="Vehicle Path" value={toggles.vehiclePath} onChange={() => dispatch(toggleMapOption('vehiclePath'))} />
          {hasTarget && <Row label="Target Path" value={toggles.targetPath} onChange={() => dispatch(toggleMapOption('targetPath'))} />}
          {hasTarget && <Row label="Target Heatmap" value={toggles.heatmap} onChange={() => dispatch(toggleMapOption('heatmap'))} />}
          {hasDrawings && <Row label="Drawings" value={toggles.mapDrawings} onChange={() => dispatch(toggleMapOption('mapDrawings'))} />}
          <Row label="Map controls" value={toggles.overlays} onChange={() => dispatch(toggleMapOption('overlays'))} />
          <Pressable onPress={onClose} style={styles.done}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
      </ScrollView>
    </BottomSheet>
  );
}

function Row({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  return (
    <View style={styles.row}>
      <Text style={[styles.label, { flex: 1 }]}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20 },
  // The rows' own gap moved here with them: the card now lays out one child (the ScrollView).
  body: { gap: 6 },
  heading: { fontSize: 12, fontWeight: '700', color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  radio: { width: 18, height: 18, borderRadius: theme.radiusPill, borderWidth: 2, borderColor: theme.borderStrong },
  radioOn: { borderColor: theme.accent, backgroundColor: theme.accent },
  label: { fontSize: 15, color: theme.textPrimary },
  // UI-022: ~37pt from padding + the default font size; state the 44pt box.
  done: { marginTop: 12, alignSelf: 'flex-end', minHeight: 44, justifyContent: 'center', paddingHorizontal: 18, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  doneText: { color: theme.textOnAccent, fontWeight: '700' },
});
