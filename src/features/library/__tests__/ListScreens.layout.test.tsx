/**
 * RESP-019 (2nd pass) + RESP-028 — the two list screens' own chrome rows.
 *  - LiveListScreen's "Go live" card and the stale-refresh banner keep their gutter in
 *    `padding`, so `edgePadding` can raise it in landscape: both rows put their only
 *    interactive control on the RIGHT, i.e. exactly in the 59pt sensor-housing strip.
 *  - LibraryScreen's sort row was the one dense chrome strip that neither wrapped nor
 *    scrolled: at AX3 the "Longest" chip left the screen entirely, and at iPad Split View
 *    (320pt) the row already overflowed at the default text size.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, type ScrollViewProps } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { LiveListScreen } from '../LiveListScreen';
import { LibraryScreen } from '../LibraryScreen';
import { makeStore, flush } from '@/features/player/__tests__/fixtures';
import { DENSE_MAX_FONT_SCALE } from '@/common/typography';

let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
let mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../useOpenVideo', () => ({ useOpenVideo: () => jest.fn() }));
jest.mock('../../../../modules/earthscape-live', () => ({ EarthscapeLive: { isSupported: true } }));
jest.mock('@/common/api/client', () => ({
  api: { get: jest.fn(async () => { throw new Error('offline'); }), post: jest.fn(), put: jest.fn() },
}));

const host = (n: ReactTestInstance) => typeof n.type === 'string';
const flat = (n: ReactTestInstance) => (StyleSheet.flatten(n.props.style) ?? {}) as Record<string, number | string | undefined>;

async function render(el: React.ReactElement) {
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<Provider store={store}>{el}</Provider>); });
  await act(async () => { await flush(); });
  return r;
}

/** The host View that encloses `label`'s Pressable and lays out in a row. */
const rowOf = (r: ReactTestRenderer, label: string) => {
  const btn = r.root.findAll((n) => n.props?.accessibilityLabel === label || (host(n) && n.props?.children === label));
  expect(btn.length).toBeGreaterThan(0);
  const rows = r.root.findAll((n) => host(n) && flat(n).flexDirection === 'row' && n.findAll((c) => c === btn[0]).length > 0);
  return rows[0];
};

describe('LiveListScreen banner rows clear the landscape cut-out (RESP-019)', () => {
  beforeEach(() => { mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 }; });

  it('portrait: the designed 12pt / 10pt gutters are untouched', async () => {
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const r = await render(<LiveListScreen />);
    const goLive = rowOf(r, 'Go live');
    expect(goLive.props.style).toBeDefined();
    const s = flat(goLive);
    expect(s.paddingLeft).toBe(12);
    expect(s.paddingRight).toBe(12);
    await act(async () => { r.unmount(); });
  });

  it('landscape iPhone: the right-aligned "Go live" pill is out of the 59pt strip', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const r = await render(<LiveListScreen />);
    const s = flat(rowOf(r, 'Go live'));
    expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(s.paddingRight).toBeGreaterThanOrEqual(59);
    // The card's own margin only adds to that — it must never REPLACE the safe padding.
    expect(s.marginBottom).toBe(0);
    await act(async () => { r.unmount(); });
  });

  it('landscape iPhone: the stale-refresh banner Retry is out of the strip too', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const store = makeStore();
    // UI-005 state: items on screen AND a failed refresh -> the stale banner renders.
    store.dispatch({ type: 'library/fetchLive/fulfilled', payload: { items: [{ id: 1, title: 'a', status: 'ready', duration: 10, date_posted: null, start: null, thumbnail_url: null, live_stream_id: 3, live_stream_status: 'live', event_id: 1 }], total: 1, page: 1, per_page: 24, pages: 1 } });
    store.dispatch({ type: 'library/fetchLive/rejected', error: { message: 'offline' } });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Provider store={store}><LiveListScreen /></Provider>); });
    await act(async () => { await flush(); });
    const alert = r.root.findAll((n) => host(n) && n.props.accessibilityRole === 'alert')[0];
    const s = flat(alert);
    expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(s.paddingRight).toBeGreaterThanOrEqual(59);
    await act(async () => { r.unmount(); });
  });
});

describe('LibraryScreen sort row scrolls instead of overflowing (RESP-028)', () => {
  beforeEach(() => { mockInsets = { top: 59, bottom: 34, left: 0, right: 0 }; });

  it('the sort chips live inside a horizontal ScrollView', async () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    const r = await render(<LibraryScreen />);
    const chip = r.root.findAll((n) => n.props?.accessibilityRole === 'tab')[0];
    expect(chip).toBeDefined();
    const scrollers = r.root
      .findAllByType(ScrollView)
      .filter((sv) => (sv.props as ScrollViewProps).horizontal && sv.findAll((c) => c === chip).length > 0);
    expect(scrollers).toHaveLength(1);
    // Nothing may clip the chips out of reach: the strip scrolls, so the row keeps no flexWrap.
    expect(scrollers[0].props.showsHorizontalScrollIndicator).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('iPad Split View 320pt: the count keeps its own space and the labels are capped', async () => {
    mockWindow = { width: 320, height: 768, scale: 2, fontScale: 1 };
    mockInsets = { top: 24, bottom: 20, left: 0, right: 0 };
    const store = makeStore();
    store.dispatch({ type: 'library/fetchVideos/fulfilled', meta: { arg: { page: 1 } }, payload: { items: [], page: 1, per_page: 24, total: 300, pages: 13, has_next: true, has_prev: false, sort: 'recently-uploaded' } });
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Provider store={store}><LibraryScreen /></Provider>); });
    await act(async () => { await flush(); });
    // The count sits OUTSIDE the scroller (it is right-aligned chrome, not a sort option).
    const count = r.root.findAllByType(Text).filter((t) => String(t.props.children).includes('300 videos'));
    expect(count).toHaveLength(1);
    const scroller = r.root.findAllByType(ScrollView).filter((sv) => (sv.props as ScrollViewProps).horizontal)[0];
    expect(scroller.findAll((c) => c === count[0])).toHaveLength(0);
    // Dense chrome: every label in the strip is capped at 1.3x (RESP-020 policy).
    for (const t of [...r.root.findAll((n) => n.props?.accessibilityRole === 'tab'), count[0]]) {
      const labels = t.findAllByType(Text);
      for (const l of labels.length ? labels : [t]) expect(l.props.maxFontSizeMultiplier).toBe(DENSE_MAX_FONT_SCALE);
    }
    await act(async () => { r.unmount(); });
  });

  it('landscape: the strip content still clears the cut-out strip', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const r = await render(<LibraryScreen />);
    const bar = r.root.findAll((n) => host(n) && n.props.testID === 'library-sort-bar')[0];
    const s = flat(bar);
    expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(s.paddingRight).toBeGreaterThanOrEqual(59);
    await act(async () => { r.unmount(); });
  });
});
