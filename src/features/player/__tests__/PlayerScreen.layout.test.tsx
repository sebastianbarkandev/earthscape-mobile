/**
 * RESP-001 / RESP-013 / RESP-010(placement): the player viewport is sized from BOTH window
 * axes, is only pinned in portrait (and then capped), the page padding follows the home
 * indicator, and the program strip lives outside the pinned block.
 */
// RN's jest setup replaces ScrollView with a stub that ignores stickyHeaderIndices entirely; the
// real one is needed here because RESP-018 is about WHICH element RN puts at the sticky slot.
jest.unmock('react-native/Libraries/Components/ScrollView/ScrollView');
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerScreen } from '../PlayerScreen';
import * as api from '../api';
import { eventPayload, flush, makeStore, permissions } from './fixtures';
import { NAV_BAR_H } from '../viewportLayout';

let mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
let mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
let mockKeyboard = 0;

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }), useFocusEffect: () => undefined }));
jest.mock('../../../../modules/earthscape-live', () => ({ EarthscapeLive: { isSupported: false } }));
jest.mock('@/common/media', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('@/common/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => mockKeyboard }));
jest.mock('../hooks/useFlightData', () => ({ useFlightData: () => undefined }));
jest.mock('../hooks/useViewingHeartbeat', () => ({ useViewingHeartbeat: () => undefined }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), getEvent: jest.fn(), getVideoPermissions: jest.fn() }));

// Leaves are stubbed: this suite is about the page geometry, not the children.
// RESP-018: mount counters — a rotation must NOT remount these (new AVPlayer / new MapView).
const mountCounts = { video: 0 };
jest.mock('../components/PlayerVideo', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { PlayerVideo: React.forwardRef((p: { children?: React.ReactNode }, _ref: unknown) => {
    React.useEffect(() => { mountCounts.video += 1; }, []);
    return React.createElement(View, { testID: 'PlayerVideo' }, p.children);
  }) };
});
jest.mock('../components/PlayerControls', () => ({ PlayerControls: () => require('react').createElement(require('react-native').View, { testID: 'PlayerControls' }) }));
jest.mock('../components/FlightMap', () => ({ FlightMap: () => require('react').createElement(require('react-native').View, { testID: 'FlightMap' }) }));
jest.mock('../components/ProgramStrip', () => ({ ProgramStrip: () => require('react').createElement(require('react-native').View, { testID: 'ProgramStrip' }) }));
jest.mock('../components/ActionRow', () => ({ ActionRow: () => require('react').createElement(require('react-native').View, { testID: 'ActionRow' }) }));
jest.mock('../components/timeline/TimelineCard', () => ({ TimelineCard: () => require('react').createElement(require('react-native').View, { testID: 'TimelineCard' }) }));
jest.mock('../components/panel/SidePanel', () => ({ SidePanel: () => require('react').createElement(require('react-native').View, { testID: 'SidePanel' }) }));
jest.mock('../components/info/InfoCard', () => ({ InfoCard: () => require('react').createElement(require('react-native').View, { testID: 'InfoCard' }) }));
jest.mock('../components/timeline/ClipmarkSheet', () => ({ ClipmarkSheet: () => null }));
jest.mock('../components/share/ShareModal', () => ({ ShareModal: () => null }));

const host = (n: ReactTestInstance) => typeof n.type === 'string';
const byTestId = (root: ReactTestInstance, id: string) => root.findAll((n) => host(n) && n.props.testID === id);
const heightOf = (n: ReactTestInstance): number | undefined => {
  const s = StyleSheet.flatten(n.props.style) as { height?: unknown } | undefined;
  return typeof s?.height === 'number' ? s.height : undefined;
};
/** Sum of the direct pane heights stacked in the viewport (portrait) or the row height (landscape). */
const viewportHeight = (vp: ReactTestInstance) => {
  const own = heightOf(vp);
  if (own != null) return own;
  return vp.children.filter((c): c is ReactTestInstance => typeof c !== 'string').reduce((sum, c) => sum + (heightOf(c) ?? 0), 0);
};

async function renderScreen(layout?: 'video' | 'split' | 'map') {
  (api.getEvent as jest.Mock).mockResolvedValue(eventPayload());
  (api.getVideoPermissions as jest.Mock).mockResolvedValue({ event_id: 1, video_id: 6, permissions });
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <PlayerScreen eventId="1" initialLayout={layout} />
      </Provider>,
    );
  });
  await act(async () => { await flush(); });
  expect(store.getState().player.status).toBe('ready');
  return { r, store };
}

describe('PlayerScreen viewport geometry', () => {
  it('iPhone 13 mini landscape: the viewport fits the visible height and is NOT sticky (split)', async () => {
    mockWindow = { width: 812, height: 375, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 50, right: 50 };
    const { r } = await renderScreen('split');
    const visible = 375 - 21 - NAV_BAR_H.phoneLandscape;
    const sv = r.root.findByType(ScrollView);
    // The prop itself is constant (RESP-018); landscape switches the PINNING off instead.
    expect(sv.props.stickyHeaderIndices).toEqual([0]);
    expect(byTestId(r.root, 'viewport-unpinned')).toHaveLength(1);
    const vp = byTestId(r.root, 'player-viewport')[0];
    const flat = StyleSheet.flatten(vp.props.style) as { flexDirection?: string; height?: number };
    expect(flat.flexDirection).toBe('row');
    // The old width-only math produced 457pt here.
    expect(flat.height).toBeLessThanOrEqual(visible);
    expect(flat.height).toBeGreaterThan(200);
  });

  it('iPhone 15 Pro Max landscape / video-only layout: the video pane is not taller than the screen', async () => {
    mockWindow = { width: 932, height: 430, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const { r } = await renderScreen('video');
    const vp = byTestId(r.root, 'player-viewport')[0];
    expect(viewportHeight(vp)).toBeLessThanOrEqual(430 - 21 - NAV_BAR_H.phoneLandscape);
    expect(byTestId(r.root, 'FlightMap')).toHaveLength(0);
    expect(byTestId(r.root, 'viewport-unpinned')).toHaveLength(1);
  });

  it('iPhone SE portrait: pinned viewport leaves >= 40% of the page for the controls/timeline', async () => {
    mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
    mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
    const { r } = await renderScreen('split');
    const visible = 667 - 20 - NAV_BAR_H.phonePortrait;
    expect(r.root.findByType(ScrollView).props.stickyHeaderIndices).toEqual([0]);
    expect(byTestId(r.root, 'viewport-pinned')).toHaveLength(1);
    const vp = byTestId(r.root, 'player-viewport')[0];
    const h = viewportHeight(vp);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThanOrEqual(Math.round(visible * 0.6));
    // Both panes present in split.
    expect(byTestId(r.root, 'PlayerVideo')).toHaveLength(1);
  });

  it('iPad portrait: video pane is capped below a full-width 16:9 (576pt) and the page stays reachable', async () => {
    mockWindow = { width: 768, height: 1024, scale: 2, fontScale: 1 };
    mockInsets = { top: 24, bottom: 20, left: 0, right: 0 };
    const { r } = await renderScreen('split');
    const vp = byTestId(r.root, 'player-viewport')[0];
    expect(viewportHeight(vp)).toBeLessThanOrEqual(Math.round((1024 - 24 - 20 - NAV_BAR_H.phonePortrait) * 0.6));
  });

  it('RESP-013: content bottom padding follows the home-indicator inset', async () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const { r } = await renderScreen('split');
    const pad = (StyleSheet.flatten(r.root.findByType(ScrollView).props.contentContainerStyle) as { paddingBottom: number }).paddingBottom;
    expect(pad).toBeGreaterThanOrEqual(34);
    expect(pad).toBeLessThanOrEqual(34 + 24);
  });

  it('RESP-010: the program strip renders outside the pinned viewport, and the page order is kept', async () => {
    mockWindow = { width: 375, height: 812, scale: 3, fontScale: 1 };
    mockInsets = { top: 50, bottom: 34, left: 0, right: 0 };
    const { r } = await renderScreen('split');
    const vp = byTestId(r.root, 'player-viewport')[0];
    expect(byTestId(r.root, 'ProgramStrip')).toHaveLength(1);
    expect(byTestId(vp, 'ProgramStrip')).toHaveLength(0);
    // viewport → (strip) → side rail → action row → timeline card → info card
    const order = r.root
      .findAll((n) => host(n) && ['player-viewport', 'ProgramStrip', 'SidePanel', 'ActionRow', 'TimelineCard', 'InfoCard'].includes(n.props.testID))
      .map((n) => n.props.testID);
    expect(order).toEqual(['player-viewport', 'ProgramStrip', 'SidePanel', 'ActionRow', 'TimelineCard', 'InfoCard']);
  });

  it('RESP-025: landscape insets the regions BELOW the viewport, portrait stays pixel-identical', async () => {
    // The timeline canvas is drawn edge-to-edge and measures itself, so the gutter has to be on
    // the page: its scrub surface at t=start / t=end was under the corner radius / housing.
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const { r } = await renderScreen('split');
    const content = byTestId(r.root, 'player-content')[0];
    const pad = StyleSheet.flatten(content.props.style) as { paddingLeft?: number; paddingRight?: number };
    expect(pad.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(pad.paddingRight).toBeGreaterThanOrEqual(59);
    // Every scrolling region is inside it; the viewport is NOT (it stays full-bleed).
    for (const id of ['SidePanel', 'ActionRow', 'TimelineCard', 'InfoCard']) {
      expect(byTestId(content, id)).toHaveLength(1);
    }
    expect(byTestId(content, 'player-viewport')).toHaveLength(0);

    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const portrait = await renderScreen('split');
    const p = StyleSheet.flatten(byTestId(portrait.r.root, 'player-content')[0].props.style) as { paddingLeft?: number; paddingRight?: number };
    expect(p.paddingLeft).toBe(0);
    expect(p.paddingRight).toBe(0);
  });

  it('RESP-018: rotating does NOT remount the viewport subtree (no new AVPlayer / MapView)', async () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    mountCounts.video = 0;
    const { r, store } = await renderScreen('split');
    expect(mountCounts.video).toBe(1);

    // Rotate to landscape: `sticky` flips true -> false.
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    await act(async () => {
      r.update(
        <Provider store={store}>
          <PlayerScreen eventId="1" initialLayout="split" />
        </Provider>,
      );
    });

    // The reason this matters: PlayerVideo's useVideoPlayer() would create a new player at t=0.
    // With `stickyHeaderIndices={sticky ? [0] : undefined}` this counter reaches 2.
    expect(mountCounts.video).toBe(1);
    expect(byTestId(r.root, 'PlayerVideo')).toHaveLength(1);
    expect(byTestId(r.root, 'viewport-unpinned')).toHaveLength(1);
  });
});

describe('RESP-027 the page can be scrolled past the keyboard', () => {
  afterEach(() => { mockKeyboard = 0; });

  it('portrait + keyboard: the viewport unpins (and is NOT remounted) so the fields are reachable', async () => {
    // iPhone 15/16 portrait: viewport 393pt pinned at y = 103…496, keyboard top edge y = 516.
    // 20pt of page left, and nothing could scroll into it.
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    mockKeyboard = 0;
    mountCounts.video = 0;
    const { r, store } = await renderScreen('split');
    expect(byTestId(r.root, 'viewport-pinned')).toHaveLength(1);
    expect(mountCounts.video).toBe(1);

    // The keyboard comes up (a field in the transcript / metadata well / Sharing tab is focused).
    mockKeyboard = 336;
    await act(async () => {
      r.update(
        <Provider store={store}>
          <PlayerScreen eventId="1" initialLayout="split" />
        </Provider>,
      );
    });
    expect(byTestId(r.root, 'viewport-unpinned')).toHaveLength(1);
    expect(byTestId(r.root, 'viewport-pinned')).toHaveLength(0);
    // RESP-018 must survive it: unpinning goes through the context, never the sticky slot's type.
    expect(mountCounts.video).toBe(1);
    expect(r.root.findByType(ScrollView).props.stickyHeaderIndices).toEqual([0]);

    // …and it pins again when the keyboard goes away.
    mockKeyboard = 0;
    await act(async () => {
      r.update(
        <Provider store={store}>
          <PlayerScreen eventId="1" initialLayout="split" />
        </Provider>,
      );
    });
    expect(byTestId(r.root, 'viewport-pinned')).toHaveLength(1);
    expect(mountCounts.video).toBe(1);
  });

  it('iPhone SE portrait: the page ScrollView asks iOS for the keyboard inset', async () => {
    // SE: avail 603, viewport 332pt at y = 64…396, keyboard top y = 407 -> 11pt of page.
    mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
    mockInsets = { top: 20, bottom: 0, left: 0, right: 0 };
    const { r } = await renderScreen('split');
    const sv = r.root.findByType(ScrollView);
    expect(sv.props.automaticallyAdjustKeyboardInsets).toBe(true);
    // A focused field must stay tappable while the keyboard is up.
    expect(sv.props.keyboardShouldPersistTaps).toBe('handled');
  });
});

describe('UI-027 the load-failure state is recoverable', () => {
  it('offers Try again and re-runs the event load', async () => {
    mockWindow = { width: 375, height: 812, scale: 3, fontScale: 1 };
    mockInsets = { top: 50, bottom: 34, left: 0, right: 0 };
    (api.getEvent as jest.Mock).mockReset();
    (api.getEvent as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    (api.getVideoPermissions as jest.Mock).mockResolvedValue({ event_id: 1, video_id: 6, permissions });
    const store = makeStore();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <Provider store={store}>
          <PlayerScreen eventId="1" />
        </Provider>,
      );
    });
    await act(async () => { await flush(); });
    expect(store.getState().player.status).toBe('error');
    expect((api.getEvent as jest.Mock).mock.calls).toHaveLength(1);

    // The Pressable and its host view both carry the label; either one is the control.
    const retry = r.root.findAll((n) => n.props?.accessibilityLabel === 'Try again' && typeof n.props?.onPress === 'function');
    expect(retry.length).toBeGreaterThanOrEqual(1);
    await act(async () => { retry[0].props.onPress(); await flush(); });
    expect((api.getEvent as jest.Mock).mock.calls).toHaveLength(2);
  });
});
