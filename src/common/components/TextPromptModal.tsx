import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { theme } from '@/common/theme';
import { BottomSheet } from './BottomSheet';

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
    <BottomSheet visible={visible} onClose={onCancel} animationType="fade" placement="center" cardStyle={styles.card}>
      {/* REG-003: the card is capped at 0.88 x window height and the input is autoFocused, so
          in landscape the keyboard leaves ~190pt for a ~265pt dialog. Without a scroll region
          the Cancel/Save row is simply not reachable — same shape as the map-layers sheet. */}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
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
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  card: { padding: 20 },
  // The children's gap moved here with them: the card now lays out one child (the ScrollView).
  body: { gap: 12 },
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
  // UI-022: paddingVertical + a 14pt label was ~35pt, and a text Pressable was invisible to
  // the touch-target guard — state the box.
  btn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: theme.radiusPill },
  btnPrimary: { backgroundColor: theme.accent },
  btnDanger: { backgroundColor: theme.danger },
  btnText: { fontSize: 14, fontWeight: '600', color: theme.textSecondary },
  btnPrimaryText: { color: theme.textOnAccent },
});
