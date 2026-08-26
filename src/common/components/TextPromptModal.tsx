import React, { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';

interface Props {
  visible: boolean;
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  multiline?: boolean;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
}

/** Cross-platform stand-in for the web's inline-edit / prompt modals. */
export function TextPromptModal({
  visible,
  title,
  message,
  initialValue = '',
  placeholder,
  multiline,
  confirmLabel = 'Save',
  destructive,
  onCancel,
  onConfirm,
}: Props) {
  const [value, setValue] = useState(initialValue);
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>{title}</Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <TextInput
            style={[styles.input, multiline && styles.inputMultiline]}
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={theme.textTertiary}
            multiline={multiline}
            autoFocus
          />
          <View style={styles.row}>
            <Pressable onPress={onCancel} style={styles.btn}>
              <Text style={styles.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={() => onConfirm(value)}
              style={[styles.btn, styles.btnPrimary, destructive && styles.btnDanger]}
            >
              <Text style={[styles.btnText, styles.btnPrimaryText]}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: theme.surface, borderRadius: theme.radiusLg, padding: 20, gap: 12 },
  title: { fontSize: 16, fontWeight: '700', color: theme.textPrimary },
  message: { fontSize: 13, color: theme.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: theme.borderStrong,
    borderRadius: theme.radiusSm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: theme.textPrimary,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: 'top' },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  btn: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: theme.radiusPill },
  btnPrimary: { backgroundColor: theme.accent },
  btnDanger: { backgroundColor: theme.danger },
  btnText: { fontSize: 14, fontWeight: '600', color: theme.textSecondary },
  btnPrimaryText: { color: theme.textOnAccent },
});
