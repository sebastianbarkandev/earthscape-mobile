import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { theme } from '@/common/theme';
import { edgePadding } from '@/common/layout';

/** iPad: a sheet never stretches across a 1024–1366pt window (RESP-012). */
export const SHEET_MAX_WIDTH = 560;
/** Share of the window a bottom sheet may take (matches the web modal's max-height feel). */
export const SHEET_MAX_HEIGHT_SHARE = 0.88;

/**
 * Pure part of the sheet geometry (RESP-004): the card's bottom padding follows the
 * home-indicator inset (never a hardcoded 24–32) and the max height is in pt, from the
 * real window height, so iPad landscape and phones get the same proportion.
 */
export function sheetCardGeometry(insets: { bottom: number }, windowHeight: number, placement: 'bottom' | 'center' = 'bottom') {
  const maxHeight = Math.round(Math.max(200, windowHeight) * SHEET_MAX_HEIGHT_SHARE);
  if (placement === 'center') return { maxHeight, maxWidth: SHEET_MAX_WIDTH };
  return { paddingBottom: Math.max(insets.bottom, 12) + 12, maxHeight, maxWidth: SHEET_MAX_WIDTH };
}

interface Props {
  visible?: boolean;
  onClose: () => void;
  animationType?: 'slide' | 'fade' | 'none';
  /** 'bottom' (default): anchored sheet with top radii. 'center': dialog card (TextPromptModal). */
  placement?: 'bottom' | 'center';
  /** Sheet-specific card styling (padding, gap…); geometry from this component wins. */
  cardStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * The one Modal wrapper every sheet/dialog uses. RN `Modal` does not inherit the screen's
 * keyboard handling or safe areas, so this adds: KeyboardAvoidingView (inputs and the
 * Apply/Save row lift above the keyboard on an SE), safe-area bottom padding (buttons never
 * sit in the home-indicator zone), a pt max height, an iPad max width, and landscape
 * support (RN Modal defaults to portrait-only and would rotate the sheet on its own).
 */
export function BottomSheet({ visible = true, onClose, animationType = 'slide', placement = 'bottom', cardStyle, children }: Props) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const center = placement === 'center';
  // RESP-019: landscape puts the card's ✕ / Apply row inside the ~59pt cut-out strip; keep the
  // whole card inside the safe area (portrait insets are 0 → unchanged full-width sheet).
  const sidePad = edgePadding(insets, center ? 24 : 0);
  return (
    <Modal visible={visible} transparent animationType={animationType} onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.fill}>
        <Pressable testID="sheet-backdrop" style={[styles.backdrop, center ? styles.backdropCenter : styles.backdropBottom, sidePad]} onPress={onClose} accessibilityRole="button" accessibilityLabel="Dismiss">
          <Pressable
            testID="sheet-card"
            style={[center ? styles.cardCenter : styles.cardBottom, cardStyle, sheetCardGeometry(insets, height, placement)]}
            onPress={() => undefined}
            accessibilityViewIsModal
          >
            {children}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: theme.scrim },
  backdropBottom: { justifyContent: 'flex-end' },
  backdropCenter: { justifyContent: 'center', padding: 24 },
  cardBottom: { width: '100%', alignSelf: 'center', flexShrink: 1, backgroundColor: theme.surface, borderTopLeftRadius: theme.radiusLg, borderTopRightRadius: theme.radiusLg },
  cardCenter: { width: '100%', alignSelf: 'center', flexShrink: 1, backgroundColor: theme.surface, borderRadius: theme.radiusLg },
});
