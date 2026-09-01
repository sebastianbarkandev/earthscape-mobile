/**
 * RESP-010 (layout half): the program strip scrolls horizontally with fixed-width 16:9
 * tiles — four phones on an SE no longer collapse to 86×48pt tiles. (The decode cap is
 * planProgramTiles / MAX_TILE_PLAYERS, covered by ProgramStrip.test.tsx.)
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { ProgramStrip } from '../ProgramStrip';
import { loadEvent } from '../../playerSlice';
import { programTileWidth } from '../../viewportLayout';
import { eventPayload, makeStore, primaryVideo, secondaryVideo } from '../../__tests__/fixtures';

let mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));
jest.mock('expo-video', () => ({
  useVideoPlayer: jest.fn(() => ({ playing: false, currentTime: 0, play: jest.fn(), pause: jest.fn(), replaceAsync: jest.fn(async () => undefined), addListener: jest.fn(() => ({ remove: jest.fn() })) })),
  VideoView: () => null,
}));

function render(secondaries: number) {
  const videos = [primaryVideo, ...Array.from({ length: secondaries }, (_, i) => secondaryVideo(10 + i, { live_stream_state: 'live' }))];
  const store = makeStore();
  store.dispatch(loadEvent.fulfilled({ event: eventPayload(videos).events[0], video: primaryVideo, permissions: null }, 'r', { eventId: 1 }));
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <ProgramStrip videos={videos} activeId={primaryVideo.id} />
      </Provider>,
    );
  });
  return r;
}
const tiles = (r: ReactTestRenderer) => r.root.findAllByType(Pressable).filter((p) => String(p.props.accessibilityLabel ?? '').startsWith('Show '));
const widthOf = (p: ReactTestInstance) => (StyleSheet.flatten(p.props.style) as { width?: number; flex?: number }).width;

describe('ProgramStrip layout', () => {
  // The tiles render LiveBadge, whose `Animated.loop` leaves a pending JS-driver frame callback
  // behind for the rest of the file ("worker process failed to exit gracefully") unless the
  // tree is unmounted — the badge stops its animation in its effect cleanup.
  let current: ReactTestRenderer | null = null;
  afterEach(() => { if (current) act(() => { current!.unmount(); }); current = null; });

  it('iPhone SE with 4 phones: a horizontal ScrollView of fixed 143pt tiles', () => {
    mockWindow = { width: 375, height: 667, scale: 2, fontScale: 1 };
    const r = (current = render(4));
    const sv = r.root.findByType(ScrollView);
    expect(sv.props.horizontal).toBe(true);
    const ts = tiles(r);
    expect(ts).toHaveLength(4);
    for (const t of ts) {
      expect(widthOf(t)).toBe(programTileWidth(375));
      expect((StyleSheet.flatten(t.props.style) as { flex?: number }).flex).toBeUndefined();
    }
    // 4 × 143 + gaps > 375: the strip scrolls instead of shrinking the tiles.
    expect(ts.length * programTileWidth(375)).toBeGreaterThan(375);
  });

  it('iPad: tiles are capped at 160pt, and every tile is a labelled button', () => {
    mockWindow = { width: 1024, height: 1366, scale: 2, fontScale: 1 };
    const r = (current = render(2));
    for (const t of tiles(r)) {
      expect(widthOf(t)).toBe(160);
      expect(t.props.accessibilityRole).toBe('button');
    }
  });
});
