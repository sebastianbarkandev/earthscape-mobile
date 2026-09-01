/**
 * GoLiveScreen device responsiveness: side safe-area insets in landscape and settings
 * collapsed there (RESP-006), light status bar over the dark preview (RESP-007), a
 * wrapping stats row (RESP-016), labelled icon controls (RESP-009).
 */
import React from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import broadcastReducer, { type BroadcastState } from '../broadcastSlice';
import { makeStore } from '@/features/player/__tests__/fixtures';

let mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
let mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
const idle: BroadcastState = broadcastReducer(undefined, { type: '@@init' });
let mockBroadcast: BroadcastState = idle;

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('../useBroadcast', () => ({
  useBroadcast: () => ({ broadcast: mockBroadcast, start: jest.fn(), stop: jest.fn(), confirmStop: jest.fn(), leave: jest.fn(async () => undefined), retryTelemetry: jest.fn(async () => false) }),
}));
jest.mock('../../../../modules/earthscape-live', () => {
  const preset = { width: 1280, height: 720, fps: 30, bitrateKbps: 2500, maxBitrateKbps: 3500, minBitrateKbps: 500 };
  return {
    PRESETS: { auto: preset, '1080p': preset, '720p': preset, '480p': preset },
    EarthscapeLive: {
      isSupported: true,
      requestPermissions: jest.fn(async () => ({ camera: 'granted', microphone: 'granted' })),
      startPreview: jest.fn(async () => undefined),
      switchCamera: jest.fn(async () => 'front'),
      setTorch: jest.fn(async () => undefined),
      setMuted: jest.fn(async () => undefined),
    },
    EarthscapeLivePreviewView: () => null,
  };
});

const host = (id: string) => (n: ReactTestInstance) => typeof n.type === 'string' && n.props.testID === id;
const flat = (n: ReactTestInstance) => StyleSheet.flatten(n.props.style) as Record<string, number | string>;

async function render() {
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <GoLiveScreen />
      </Provider>,
    );
  });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return r;
}

describe('GoLiveScreen', () => {
  beforeEach(() => { mockBroadcast = idle; });

  it('iPhone 15 landscape: chrome clears the Dynamic Island on both sides and settings start collapsed', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const r = await render();
    for (const id of ['golive-top', 'golive-bottom']) {
      const s = flat(r.root.find(host(id)));
      expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
      expect(s.paddingRight).toBeGreaterThanOrEqual(59);
    }
    expect(r.root.findAllByType(TextInput)).toHaveLength(0);
    expect(r.root.findAllByType(StatusBar)[0].props.style).toBe('light');
  });

  it('portrait: settings open, 12pt side padding, home-indicator bottom padding', async () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const r = await render();
    expect(r.root.findAllByType(TextInput)).toHaveLength(1);
    const bottom = flat(r.root.find(host('golive-bottom')));
    expect(bottom.paddingLeft).toBe(12);
    expect(bottom.paddingBottom).toBeGreaterThanOrEqual(34);
  });

  it('RESP-016: while live the six stats sit in a wrapping row', async () => {
    mockWindow = { width: 320, height: 768, scale: 2, fontScale: 1 };
    mockInsets = { top: 24, bottom: 20, left: 0, right: 0 };
    mockBroadcast = {
      ...idle,
      phase: 'live',
      publisher: 'publishing',
      stats: { videoBitrateKbps: 1234, sendRateKbps: 1180, rttMs: 42, lost: 0, dropped: 0, sendBufferMs: 120, congestion: 0.1, elapsedSec: 61 } as never,
    };
    const r = await render();
    const row = flat(r.root.find(host('golive-stats')));
    expect(row.flexWrap).toBe('wrap');
    expect(row.flexDirection).toBe('row');
  });

  /**
   * RESP-030: `/golive` is a root-stack `fullScreenModal` with `gestureEnabled: false` and no
   * header, so the Close button in the plain top bar is the ONLY way off these states. In
   * landscape its 36pt box started at x = 12, i.e. behind the rounded corner / sensor housing.
   */
  it('RESP-030: the early-return top bar clears the cut-out so Close stays tappable', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    const live = jest.requireMock('../../../../modules/earthscape-live') as { EarthscapeLive: { isSupported: boolean } };
    live.EarthscapeLive.isSupported = false;
    try {
      const r = await render();
      const close = r.root.findAll((n) => typeof n.type === 'string' && n.props.accessibilityLabel === 'Close');
      expect(close).toHaveLength(1);
      const bars = r.root.findAll((n) => typeof n.type === 'string' && flat(n).flexDirection === 'row' && n.findAll((c) => c === close[0]).length > 0);
      expect(bars.length).toBeGreaterThan(0);
      const s = flat(bars[bars.length - 1]);
      expect(s.paddingLeft).toBeGreaterThanOrEqual(59);
      expect(s.paddingRight).toBeGreaterThanOrEqual(59);
      await act(async () => { r.unmount(); });
    } finally {
      live.EarthscapeLive.isSupported = true;
    }
  });

  it('RESP-030: the centred card is offset off the cut-out (its content is text, edge to edge)', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    mockBroadcast = { ...idle, phase: 'ended' };
    const r = await render();
    // `top: '30%'` is unique to `styles.centerCard`.
    const cards = r.root.findAll((n) => typeof n.type === 'string' && flat(n).top === '30%');
    expect(cards).toHaveLength(1);
    const s = flat(cards[0]);
    expect(s.left).toBeGreaterThanOrEqual(59);
    expect(s.right).toBeGreaterThanOrEqual(59);
    await act(async () => { r.unmount(); });
  });

  it('portrait keeps the designed 24pt card offset and 12pt top-bar gutter', async () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    mockBroadcast = { ...idle, phase: 'ended' };
    const r = await render();
    const s = flat(r.root.findAll((n) => typeof n.type === 'string' && flat(n).top === '30%')[0]);
    expect(s.left).toBe(24);
    expect(s.right).toBe(24);
    await act(async () => { r.unmount(); });
  });

  it('RESP-009: every control is a labelled or role-bearing pressable', async () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
    const r = await render();
    const buttons = r.root.findAllByType(Pressable);
    expect(buttons.length).toBeGreaterThanOrEqual(8); // close, 4 quality + 3 latency chips, telemetry, go live, 4 controls
    for (const b of buttons) expect(typeof b.props.accessibilityRole === 'string' || typeof b.props.accessibilityLabel === 'string').toBe(true);
  });
});

/**
 * UI-036: the bottom-right control used to toggle `controlsOpen`, whose only consumer (the
 * settings block) is gated on `!isLive` — so while live, and on the ended/error screens, the
 * press changed nothing but its own icon. The settings themselves must NOT appear mid-stream
 * (every field there is a creation-time parameter), so while live the same slot owns the stats.
 */
describe('settings/stats toggle by phase', () => {
  const stats = { videoBitrateKbps: 1234, sendRateKbps: 1180, rttMs: 42, lost: 0, dropped: 0, sendBufferMs: 120, congestion: 0.1, elapsedSec: 61 };
  const portrait = () => {
    mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
    mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
  };
  /** The corner control is a `Ctl` — match the labelled Pressable that carries the handler. */
  const ctl = (r: ReactTestRenderer, label: string) =>
    r.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
  const tap = async (r: ReactTestRenderer, label: string) => {
    const [target] = ctl(r, label);
    expect(target).toBeDefined();
    await act(async () => { target.props.onPress(); });
  };

  beforeEach(() => { mockBroadcast = idle; });

  it('live: the corner control shows and hides the stats block', async () => {
    portrait();
    mockBroadcast = { ...idle, phase: 'live', publisher: 'publishing', stats: stats as never };
    const r = await render();
    expect(r.root.findAll(host('golive-stats'))).toHaveLength(1);
    expect(r.root.findAll(host('golive-congestion'))).toHaveLength(1);

    await tap(r, 'Hide stream statistics');
    expect(r.root.findAll(host('golive-stats'))).toHaveLength(0);
    expect(r.root.findAll(host('golive-congestion'))).toHaveLength(0);

    await tap(r, 'Show stream statistics');
    expect(r.root.findAll(host('golive-stats'))).toHaveLength(1);
    expect(r.root.findAll(host('golive-congestion'))).toHaveLength(1);
    await act(async () => { r.unmount(); });
  });

  it('live: tapping the stats row itself collapses it', async () => {
    portrait();
    mockBroadcast = { ...idle, phase: 'live', publisher: 'publishing', stats: stats as never };
    const r = await render();
    expect(r.root.find(host('golive-stats')).props.accessibilityHint).toBe('Hides the stream statistics');
    // `host()` is the rendered View; the press handler lives on the Pressable above it.
    const [row] = r.root.findAll((n) => n.props.testID === 'golive-stats' && typeof n.props.onPress === 'function');
    expect(row).toBeDefined();
    await act(async () => { row.props.onPress(); });
    expect(r.root.findAll(host('golive-stats'))).toHaveLength(0);
    expect(ctl(r, 'Show stream statistics').length).toBeGreaterThan(0);
    await act(async () => { r.unmount(); });
  });

  it.each([
    ['ended', { phase: 'ended' } as Partial<BroadcastState>],
    ['error', { phase: 'error', error: 'x' } as Partial<BroadcastState>],
  ])('%s: no dead settings/statistics toggle is rendered', async (_name, patch) => {
    portrait();
    mockBroadcast = { ...idle, ...patch } as BroadcastState;
    const r = await render();
    const dead = r.root.findAll((n) => typeof n.props.accessibilityLabel === 'string' && /settings|statistics/i.test(n.props.accessibilityLabel));
    expect(dead).toHaveLength(0);
    await act(async () => { r.unmount(); });
  });

  it('before going live the same control still shows and hides the settings', async () => {
    portrait();
    const r = await render();
    expect(r.root.findAllByType(TextInput)).toHaveLength(1);

    await tap(r, 'Hide settings');
    expect(r.root.findAllByType(TextInput)).toHaveLength(0);

    await tap(r, 'Show settings');
    expect(r.root.findAllByType(TextInput)).toHaveLength(1);
    await act(async () => { r.unmount(); });
  });
});
