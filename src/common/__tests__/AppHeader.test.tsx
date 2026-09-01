/**
 * RESP-019 / RESP-020 — the app header is the one piece of chrome on EVERY tab screen:
 *  - landscape (`orientation: "default"`) reports `insets.left/right ≈ 59`; the logo and the
 *    account button sat inside that strip, clipped by the Dynamic Island / rounded corner;
 *  - the row and the search pill were pinned with `height`, so at AX3 (2.35×) the 14pt field
 *    text overflowed a 36pt pill inside a 52pt row.
 */
import React from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import authReducer from '@/features/auth/authSlice';
import { AppHeader } from '../components/AppHeader';
import { DENSE_MAX_FONT_SCALE } from '../typography';

let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useGlobalSearchParams: () => ({}) }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));

const makeStore = () => configureStore({ reducer: { auth: authReducer }, middleware: (d) => d({ serializableCheck: false }) });

function header() {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={makeStore()}>
        <AppHeader />
      </Provider>,
    );
  });
  return r;
}
/** The header row = the first host View that lays its children out in a row. */
const rowStyle = (r: ReactTestRenderer) => {
  const rows = r.root.findAllByType(View).map((n) => StyleSheet.flatten(n.props.style) as Record<string, number | string>);
  return rows.find((s) => s && s.flexDirection === 'row' && s.paddingLeft !== undefined)!;
};

describe('AppHeader edge insets (RESP-019)', () => {
  it('portrait: the designed 12pt gutter is untouched', () => {
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const s = rowStyle(header());
    expect(s.paddingLeft).toBe(12);
    expect(s.paddingRight).toBe(12);
  });

  it('landscape iPhone: the logo and the account button clear the 59pt cut-out strip', () => {
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const s = rowStyle(header());
    expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(s.paddingRight).toBeGreaterThanOrEqual(59);
  });
});

describe('AppHeader Dynamic Type (RESP-020)', () => {
  it('the row and the search pill can grow with the text instead of clipping it', () => {
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const r = header();
    const boxes = r.root.findAllByType(View).map((n) => StyleSheet.flatten(n.props.style) as Record<string, number | undefined>);
    for (const b of boxes) expect(b?.height).not.toBe(52);
    expect(boxes.some((b) => b?.minHeight === 52)).toBe(true);
    expect(boxes.some((b) => b?.minHeight === 36)).toBe(true);
  });

  it('the search field is capped at the dense-chrome multiplier', () => {
    const input = header().root.findByType(TextInput);
    expect(input.props.maxFontSizeMultiplier).toBe(DENSE_MAX_FONT_SCALE);
  });
});
