/**
 * RESP-004 / RESP-012: every sheet goes through BottomSheet, which avoids the keyboard,
 * pads for the home indicator from the real insets, caps height in pt and width on iPad,
 * and supports landscape.
 */
import React from 'react';
import { KeyboardAvoidingView, Modal, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { BottomSheet, SHEET_MAX_WIDTH, sheetCardGeometry } from '../components/BottomSheet';

let mockInsets = { top: 0, bottom: 34, left: 0, right: 0 };
let mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));

const render = () => {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <BottomSheet onClose={() => undefined} cardStyle={{ paddingBottom: 99 }}>
        <Text>hello</Text>
      </BottomSheet>,
    );
  });
  return r;
};
const cardStyle = (r: ReactTestRenderer) => StyleSheet.flatten(r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'sheet-card').props.style) as Record<string, number | string>;
const backdropStyle = (r: ReactTestRenderer) => StyleSheet.flatten(r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'sheet-backdrop').props.style) as Record<string, number | string>;

describe('sheetCardGeometry', () => {
  it('bottom padding follows the inset, never below 24pt, never a hardcoded guess', () => {
    expect(sheetCardGeometry({ bottom: 34 }, 852).paddingBottom).toBe(46);
    expect(sheetCardGeometry({ bottom: 0 }, 667).paddingBottom).toBe(24);
    expect(sheetCardGeometry({ bottom: 21 }, 375).paddingBottom).toBe(33);
  });
  it('max height is 88% of the real window height in pt, max width caps iPad sheets', () => {
    expect(sheetCardGeometry({ bottom: 0 }, 667).maxHeight).toBe(Math.round(667 * 0.88));
    expect(sheetCardGeometry({ bottom: 20 }, 1024).maxHeight).toBe(Math.round(1024 * 0.88));
    expect(sheetCardGeometry({ bottom: 20 }, 1024).maxWidth).toBe(SHEET_MAX_WIDTH);
    expect(SHEET_MAX_WIDTH).toBeLessThanOrEqual(600);
  });
  it('a centered dialog gets no bottom padding (it lifts with the keyboard instead)', () => {
    expect((sheetCardGeometry({ bottom: 34 }, 852, 'center') as { paddingBottom?: number }).paddingBottom).toBeUndefined();
  });
});

describe('BottomSheet', () => {
  it('wraps the card in a KeyboardAvoidingView and a landscape-capable Modal', () => {
    const r = render();
    expect(r.root.findAllByType(KeyboardAvoidingView)).toHaveLength(1);
    expect(r.root.findByType(Modal).props.supportedOrientations).toEqual(expect.arrayContaining(['portrait', 'landscape']));
  });

  it('notch device: the card padding clears the home indicator and geometry beats the caller style', () => {
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const s = cardStyle(render());
    expect(s.paddingBottom).toBeGreaterThanOrEqual(34);
    expect(s.paddingBottom).not.toBe(99);
    expect(s.maxWidth).toBeLessThanOrEqual(600);
  });

  it('RESP-019: landscape — the card stays out of the left/right cut-out strip', () => {
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    const b = backdropStyle(render());
    expect(b.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(b.paddingRight).toBeGreaterThanOrEqual(59);
  });

  it('RESP-022: the card can shrink, so the keyboard cannot push its head off the top', () => {
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    // The KAV shrinks its content box to windowHeight - keyboardHeight; without flexShrink the
    // card keeps its 0.88 * windowHeight cap and overflows UPWARD (title + ✕ off-screen).
    expect(cardStyle(render()).flexShrink).toBe(1);
  });

  it('iPhone SE: no dead space — padding stays at the 24pt floor', () => {
    mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
    mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
    const s = cardStyle(render());
    expect(s.paddingBottom).toBeLessThanOrEqual(24);
    expect(s.maxHeight).toBe(Math.round(667 * 0.88));
  });
});
