import React from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { theme } from '@/common/theme';
import { useAppDispatch, useAppSelector } from '@/store/hooks';
import { setMapType, toggleMapOption, type MapType } from '../playerSlice';

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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.heading}>Base map</Text>
          {bases.map((b) => (
            <Pressable key={b.key} style={styles.row} onPress={() => dispatch(setMapType(b.key))}>
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
        </Pressable>
      </Pressable>
    </Modal>
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
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  card: { backgroundColor: theme.surface, borderTopLeftRadius: theme.radiusLg, borderTopRightRadius: theme.radiusLg, padding: 20, paddingBottom: 32, gap: 6 },
  heading: { fontSize: 12, fontWeight: '700', color: theme.textTertiary, textTransform: 'uppercase', letterSpacing: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: theme.borderStrong },
  radioOn: { borderColor: theme.accent, backgroundColor: theme.accent },
  label: { fontSize: 15, color: theme.textPrimary },
  done: { marginTop: 12, alignSelf: 'flex-end', paddingHorizontal: 18, paddingVertical: 10, borderRadius: theme.radiusPill, backgroundColor: theme.accent },
  doneText: { color: theme.textOnAccent, fontWeight: '700' },
});
