/**
 * RESP-023: the login card is the only screen a user cannot get past, and it could not
 * scroll — SE landscape with the keyboard up leaves ~213pt for a ~290pt card (Sign in
 * below the fold), and the multi-org picker (an email registered in more than one org,
 * CLAUDE.md) renders 6+ 58pt rows inline, i.e. taller than the screen.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text } from 'react-native';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import authReducer, { login } from '../authSlice';
import { LoginScreen } from '../LoginScreen';

let mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));

const orgs = Array.from({ length: 8 }, (_, i) => ({ subdomain: `org${i}`, name: `Organization ${i}` }));

function render(picking = false) {
  const store = configureStore({ reducer: { auth: authReducer }, middleware: (d) => d({ serializableCheck: false }) });
  // the multi-org branch of login.fulfilled — the only way into status 'choosingOrg'
  if (picking) store.dispatch({ type: login.fulfilled.type, payload: { kind: 'chooseOrg', organizations: orgs } });
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <LoginScreen />
      </Provider>,
    );
  });
  return r;
}

describe('LoginScreen scrolls (RESP-023)', () => {
  it('SE landscape: the card lives inside a scroll region that still centres it', () => {
    mockInsets = { top: 0, bottom: 21, left: 47, right: 47 };
    const r = render();
    const sv = r.root.findByType(ScrollView);
    const cc = StyleSheet.flatten(sv.props.contentContainerStyle) as Record<string, number | string>;
    expect(cc.flexGrow).toBe(1); // short content stays vertically centred
    expect(cc.justifyContent).toBe('center');
    expect(cc.paddingLeft).toBeGreaterThanOrEqual(47); // RESP-019: landscape cut-out
    expect(cc.paddingRight).toBeGreaterThanOrEqual(47);
    expect(sv.props.keyboardShouldPersistTaps).toBe('handled'); // Sign in with the keyboard up
    // and the card is a descendant of it, not a sibling
    expect(sv.findAll((n) => typeof n.type === 'string' && StyleSheet.flatten(n.props.style)?.maxWidth === 420).length).toBe(1);
  });

  it('the multi-org picker: every organization row is reachable inside the scroll region', () => {
    mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
    const sv = render(true).root.findByType(ScrollView);
    const labels = sv.findAllByType(Text).map((n) => n.props.children);
    for (const o of orgs) expect(labels).toContain(o.name);
  });
});
