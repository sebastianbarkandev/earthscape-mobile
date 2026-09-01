/**
 * RESP-002: PlayerControls reads the playback clock from the store itself and builds its
 * scrubber PanResponder exactly once (it used to call PanResponder.create on every render).
 */
import React from 'react';
import { PanResponder, Pressable, StyleSheet, Text } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerControls } from '../PlayerControls';
import { setCurrentTime } from '../../playerSlice';
import { makeStore } from '../../__tests__/fixtures';

let mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null })); // vector-icons loads fonts async (act noise)

const noop = () => undefined;
const props = {
  paused: false,
  rate: 1,
  muted: false,
  hasAudio: true,
  isLive: false,
  canSeek: true,
  duration: 300,
  onTogglePaused: noop,
  onSeekTo: noop,
  onSeekBy: noop,
  onRate: noop,
  onToggleMuted: noop,
  onFullscreen: noop,
  onGoLive: noop,
};

const textOf = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')));

describe('PlayerControls', () => {
  it('shows the store clock and re-renders on ticks without rebuilding the PanResponder', () => {
    const createSpy = jest.spyOn(PanResponder, 'create');
    const store = makeStore();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <Provider store={store}>
          <PlayerControls {...props} />
        </Provider>,
      );
    });
    expect(textOf(r)).toContain('0:00 / 5:00');
    const created = createSpy.mock.calls.length;
    expect(created).toBe(1);

    for (let i = 1; i <= 3; i++) act(() => { store.dispatch(setCurrentTime({ video: i * 30, utc: null })); });
    expect(textOf(r)).toContain('1:30 / 5:00');
    expect(createSpy.mock.calls.length).toBe(created);

    // A prop change re-renders too — still no new responder.
    act(() => { r.update(<Provider store={store}><PlayerControls {...props} paused /></Provider>); });
    expect(createSpy.mock.calls.length).toBe(created);
    createSpy.mockRestore();
  });

  it('RESP-009: every control is a labelled button and the surface itself is not one VoiceOver blob', () => {
    const store = makeStore();
    let r!: ReactTestRenderer;
    act(() => {
      r = create(
        <Provider store={store}>
          <PlayerControls {...props} isLive />
        </Provider>,
      );
    });
    const pressables = r.root.findAllByType(Pressable);
    const surface = pressables[0];
    expect(surface.props.accessible).toBe(false);
    const controls = pressables.slice(1);
    // back / play / forward / mute / go live / speed / fullscreen
    expect(controls.length).toBe(7);
    for (const c of controls) {
      expect(c.props.accessibilityRole).toBe('button');
      expect(typeof c.props.accessibilityLabel).toBe('string');
      expect(c.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
    expect(controls.map((c) => c.props.accessibilityLabel)).toEqual(expect.arrayContaining(['Pause', 'Fullscreen', 'Go live', 'Mute']));
    // Paused → labels flip to frame stepping and Play.
    act(() => { r.update(<Provider store={store}><PlayerControls {...props} isLive paused /></Provider>); });
    const labels = r.root.findAllByType(Pressable).slice(1).map((c) => c.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining(['Play', 'Back one frame', 'Forward one frame']));
  });

  it('RESP-019: landscape — the transport row is padded out of the left/right cut-out strip', () => {
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const store = makeStore();
    let r!: ReactTestRenderer;
    act(() => { r = create(<Provider store={store}><PlayerControls {...props} isLive /></Provider>); });
    const bar = r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'controls-bar');
    const s = StyleSheet.flatten(bar.props.style) as { paddingLeft?: number; paddingRight?: number };
    expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
    expect(s.paddingRight).toBeGreaterThanOrEqual(59);
    // The Live badge, too — it sits at the very left of the video pane.
    const badge = r.root.find((n) => typeof n.type === 'string' && n.props.testID === 'controls-live-badge');
    expect((StyleSheet.flatten(badge.props.style) as { left?: number }).left).toBeGreaterThanOrEqual(59);
    mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
  });

  it('RESP-005: dense chrome text is capped for Dynamic Type', () => {
    const store = makeStore();
    let r!: ReactTestRenderer;
    act(() => { r = create(<Provider store={store}><PlayerControls {...props} isLive /></Provider>); });
    const texts = r.root.findAllByType(Text);
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) expect(t.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
  });
});
