/**
 * UI-001 / UI-018 on the Go Live screen:
 *  - the bottom bar (stream-name field, settings chips, Go live) is `position: absolute`
 *    over a full-bleed camera preview, so no KeyboardAvoidingView can lift it — it lifts
 *    itself by the keyboard height, and returns to the home-indicator inset afterwards;
 *  - the "Adding your camera to: …" banner used to be pinned at `top: 96`, which is INSIDE
 *    the top bar on a Dynamic Island device (59 + 6 + 36 = 101) — it covered the status
 *    pill and the close button. It now follows the same insets.
 */
import React from 'react';
import { ScrollView, StyleSheet, TextInput } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import { BOTTOM_BLOCK_MIN_H, TOP_BAR, bannerTop, bottomBarInset, bottomBlockMaxHeight } from '../goLiveChrome';
import { makeStore } from '@/features/player/__tests__/fixtures';

let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
let mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
let mockKeyboard = 0;

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('../airlink/AirLinkOverlay', () => ({ AirLinkOverlay: () => null })); // polls the aircraft track; the renderers here are never unmounted
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('@/common/hooks/useKeyboardHeight', () => ({ useKeyboardHeight: () => mockKeyboard }));
jest.mock('../useJoinGate', () => ({ useJoinGate: () => ({ status: 'allowed' }) }));
jest.mock('../useBroadcast', () => {
  const reducer = jest.requireActual('../broadcastSlice').default;
  return { useBroadcast: () => ({ broadcast: reducer(undefined, { type: '@@init' }), start: jest.fn(), stop: jest.fn(), confirmStop: jest.fn(), leave: jest.fn(async () => undefined), retryTelemetry: jest.fn(async () => false) }) };
});
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

async function render(props: { eventId?: number; eventTitle?: string } = {}) {
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <GoLiveScreen {...props} />
      </Provider>,
    );
  });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return r;
}

describe('bottomBarInset (UI-001)', () => {
  it('sits on the keyboard while it is up', () => {
    expect(bottomBarInset(336, 34)).toEqual({ bottom: 336, paddingBottom: 12 });
  });
  it('clears the home indicator when the keyboard is down', () => {
    expect(bottomBarInset(0, 34)).toEqual({ bottom: 0, paddingBottom: 46 });
    expect(bottomBarInset(0, 0)).toEqual({ bottom: 0, paddingBottom: 12 });
  });
  it('ignores nonsense values instead of pushing the bar off screen', () => {
    expect(bottomBarInset(NaN, NaN)).toEqual({ bottom: 0, paddingBottom: 12 });
    expect(bottomBarInset(-50, -10)).toEqual({ bottom: 0, paddingBottom: 12 });
  });
});

describe('bannerTop (UI-018)', () => {
  it('always clears the top bar, on every device', () => {
    expect(bannerTop({ top: 59 })).toBe(59 + TOP_BAR.padTop + TOP_BAR.rowH + TOP_BAR.gap);
    for (const top of [0, 20, 24, 47, 59, 62]) {
      expect(bannerTop({ top })).toBeGreaterThanOrEqual(top + TOP_BAR.rowH);
    }
    // The old hardcoded 96 was BELOW the bar's bottom edge on a Dynamic Island phone.
    expect(bannerTop({ top: 59 })).toBeGreaterThan(96);
  });
  it('is inset-safe for garbage', () => {
    expect(bannerTop({ top: NaN })).toBe(TOP_BAR.padTop + TOP_BAR.rowH + TOP_BAR.gap);
    expect(bannerTop({ top: -20 })).toBe(TOP_BAR.padTop + TOP_BAR.rowH + TOP_BAR.gap);
  });
});

describe('GoLiveScreen chrome', () => {
  beforeEach(() => { mockKeyboard = 0; mockInsets = { top: 59, bottom: 34, left: 0, right: 0 }; mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 }; });

  it('keyboard up: the controls bar lifts above it (the Go live button stays reachable)', async () => {
    const down = flat((await render()).root.find(host('golive-bottom')));
    expect(down.bottom).toBe(0);
    expect(down.paddingBottom).toBeGreaterThanOrEqual(34);
    mockKeyboard = 336;
    const up = flat((await render()).root.find(host('golive-bottom')));
    expect(up.bottom).toBe(336);
  });

  it('join mode: the banner starts below the top bar, not on top of the close button', async () => {
    const r = await render({ eventId: 42, eventTitle: 'Pursuit' });
    const banner = r.root.findAll((n) => typeof n.type === 'string' && typeof (StyleSheet.flatten(n.props.style) as { top?: number })?.top === 'number' && n.props.pointerEvents === 'none');
    expect(banner.length).toBeGreaterThan(0);
    const top = (StyleSheet.flatten(banner[0].props.style) as { top: number }).top;
    expect(top).toBe(bannerTop(mockInsets));
    const bar = flat(r.root.find(host('golive-top')));
    expect(top).toBeGreaterThanOrEqual((bar.paddingTop as number) + TOP_BAR.rowH);
  });
});

describe('bottomBlockMaxHeight (RESP-026)', () => {
  it('landscape + keyboard: the block is capped at the room left above the keyboard', () => {
    // iPhone 15/16 landscape, keyboard ~162pt. The settings block wants ~249pt, so without a
    // cap its top landed at 393 - 162 - 249 = -18pt and the camera-name field was off-screen.
    const cap = bottomBlockMaxHeight({ height: 393, keyboardHeight: 162, insetsTop: 0 });
    expect(cap).toBeLessThanOrEqual(393 - 162 - 42);
    expect(cap).toBeGreaterThanOrEqual(BOTTOM_BLOCK_MIN_H);
    // The block's top edge stays on screen and below the top bar.
    expect(393 - 162 - cap).toBeGreaterThanOrEqual(0);
    expect(393 - 162 - cap).toBeGreaterThanOrEqual(TOP_BAR.rowH);
  });

  it('SE landscape (the worst case: the hint and the GPS label both wrap)', () => {
    const cap = bottomBlockMaxHeight({ height: 375, keyboardHeight: 162, insetsTop: 0 });
    expect(cap).toBeLessThan(278); // the block content, which must now scroll
    expect(375 - 162 - cap).toBeGreaterThanOrEqual(0);
  });

  it('portrait / keyboard down: the cap is generous enough to change nothing', () => {
    expect(bottomBlockMaxHeight({ height: 852, keyboardHeight: 336, insetsTop: 59 })).toBeGreaterThan(280);
    expect(bottomBlockMaxHeight({ height: 852, keyboardHeight: 0, insetsTop: 59 })).toBeGreaterThan(600);
    expect(bottomBlockMaxHeight({ height: 393, keyboardHeight: 0, insetsTop: 0 })).toBeGreaterThan(280);
  });

  it('never returns a cap that hides the block, whatever the inputs', () => {
    for (const o of [
      { height: NaN, keyboardHeight: NaN, insetsTop: NaN },
      { height: 0, keyboardHeight: 0, insetsTop: 0 },
      { height: 375, keyboardHeight: 320, insetsTop: 59 },
      { height: 393, keyboardHeight: -50, insetsTop: -10 },
    ]) {
      expect(bottomBlockMaxHeight(o)).toBeGreaterThanOrEqual(BOTTOM_BLOCK_MIN_H);
    }
  });
});

describe('GoLiveScreen landscape + keyboard + settings open (RESP-026)', () => {
  beforeEach(() => { mockKeyboard = 0; });

  it('the settings scroll and the block is clamped, so the camera-name field is reachable', async () => {
    mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
    mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
    mockKeyboard = 162;
    const r = await render({ eventId: 42, eventTitle: 'Pursuit' });
    // Settings start COLLAPSED in landscape by design — open them the way the user does.
    const toggle = r.root.findAll((n) => n.props?.accessibilityLabel === 'Show settings' && typeof n.props?.onPress === 'function')[0];
    expect(toggle).toBeDefined();
    await act(async () => { toggle.props.onPress(); });

    const bottom = flat(r.root.find(host('golive-bottom')));
    expect(bottom.bottom).toBe(162);
    expect(typeof bottom.maxHeight).toBe('number');
    expect(bottom.maxHeight as number).toBeLessThanOrEqual(393 - 162);

    // The camera-name field now lives inside a scrollable region that can shrink.
    const field = r.root.findByType(TextInput);
    const scrollers = r.root.findAllByType(ScrollView).filter((sv) => sv.findAll((c) => c === field).length > 0);
    expect(scrollers).toHaveLength(1);
    expect(flat(scrollers[0]).flexShrink).toBe(1);
    expect(scrollers[0].props.keyboardShouldPersistTaps).toBe('handled');
    // …while the Join live button stays OUTSIDE it, pinned at the bottom of the block.
    const join = r.root.findAll((n) => n.props?.accessibilityLabel === 'Join live')[0];
    expect(join).toBeDefined();
    expect(scrollers[0].findAll((c) => c === join)).toHaveLength(0);
  });
});
