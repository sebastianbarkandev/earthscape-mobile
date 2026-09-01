/**
 * A denied iOS location permission used to be a dead end on this screen: the only sign of it
 * was the "GPS: off" stat, which lives inside the stats row — rendered only when
 * `isLive && stats && controlsOpen`, and `controlsOpen` starts FALSE in landscape, i.e. exactly
 * how a mounted phone streams. The pre-live checkbox was no better: it flipped redux intent and
 * `startTelemetry` silently flipped it back, because iOS answers every later permission request
 * from the remembered denial without prompting.
 *
 * So: an unconditional, tappable "GPS off" hint in the same area as the reconnect / "waiting for
 * the server…" lines, and a checkbox that actually re-asks. Both go through `retryTelemetry()`.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import broadcastReducer, { setTelemetryEnabled, type BroadcastState } from '../broadcastSlice';
import { makeStore, type TestStore } from '@/features/player/__tests__/fixtures';

let mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
const idle: BroadcastState = broadcastReducer(undefined, { type: '@@init' });
let mockBroadcast: BroadcastState = idle;
const mockRetry = jest.fn(async () => false);

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => mockWindow }));
jest.mock('../useBroadcast', () => ({
  useBroadcast: () => ({ broadcast: mockBroadcast, start: jest.fn(), stop: jest.fn(), confirmStop: jest.fn(), leave: jest.fn(async () => undefined), retryTelemetry: mockRetry }),
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

const stats = { videoBitrateKbps: 1234, sendRateKbps: 1180, rttMs: 42, lost: 0, dropped: 0, sendBufferMs: 120, congestion: 0.1, elapsedSec: 61 };
const GPS_HINT = 'GPS off — tap to enable location';

const portrait = () => {
  mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
  mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
};
const landscape = () => {
  mockWindow = { width: 852, height: 393, scale: 3, fontScale: 1 };
  mockInsets = { top: 0, bottom: 21, left: 59, right: 59 };
};

async function render(store: TestStore = makeStore()): Promise<{ r: ReactTestRenderer; store: TestStore }> {
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <GoLiveScreen />
      </Provider>,
    );
  });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return { r, store };
}

/** The Pressable itself — its rendered host View carries the same props, so match the component. */
const pressable = (r: ReactTestRenderer, testID: string) =>
  r.root.findAll((n: ReactTestInstance) => typeof n.type !== 'string' && n.props.testID === testID && typeof n.props.onPress === 'function');
const hostNode = (r: ReactTestRenderer, testID: string) =>
  r.root.findAll((n: ReactTestInstance) => typeof n.type === 'string' && n.props.testID === testID);

describe('the GPS-off affordance while live', () => {
  beforeEach(() => { mockBroadcast = idle; mockRetry.mockClear(); });

  it('renders a tappable hint whenever telemetry is off mid-stream, and calls retryTelemetry', async () => {
    portrait();
    mockBroadcast = {
      ...idle, phase: 'live', publisher: 'publishing', stats: stats as never,
      telemetry: { ...idle.telemetry, enabled: false, denied: true },
    };
    const { r } = await render();
    const [hint] = pressable(r, 'golive-gps-hint');
    expect(hint).toBeDefined();
    expect(hint.props.accessibilityRole).toBe('button');
    expect(hint.props.accessibilityLabel).toBe(GPS_HINT);
    await act(async () => { hint.props.onPress(); });
    expect(mockRetry).toHaveBeenCalledTimes(1);
    await act(async () => { r.unmount(); });
  });

  it('survives the collapsed stats block — the landscape default the old "GPS: off" stat hid behind', async () => {
    landscape();
    mockBroadcast = {
      ...idle, phase: 'live', publisher: 'publishing', stats: stats as never,
      telemetry: { ...idle.telemetry, enabled: false, denied: true },
    };
    const { r } = await render();
    expect(hostNode(r, 'golive-stats')).toHaveLength(0); // controlsOpen starts false in landscape
    expect(hostNode(r, 'golive-gps-hint')).toHaveLength(1);
    await act(async () => { r.unmount(); });
  });

  it('is absent while telemetry is actually running, and before going live', async () => {
    portrait();
    mockBroadcast = { ...idle, phase: 'live', publisher: 'publishing', stats: stats as never };
    const live = await render();
    expect(hostNode(live.r, 'golive-gps-hint')).toHaveLength(0);
    await act(async () => { live.r.unmount(); });

    mockBroadcast = { ...idle, telemetry: { ...idle.telemetry, enabled: false, denied: true } };
    const ready = await render();
    expect(hostNode(ready.r, 'golive-gps-hint')).toHaveLength(0);
    await act(async () => { ready.r.unmount(); });
  });
});

describe('the pre-live "Attach my GPS position" checkbox', () => {
  const tapCheckbox = async (r: ReactTestRenderer) => {
    const [box] = r.root.findAll((n: ReactTestInstance) => n.props.accessibilityLabel === 'Attach my GPS position' && typeof n.props.onPress === 'function');
    expect(box).toBeDefined();
    await act(async () => { box.props.onPress(); });
  };
  /** The screen reads intent from the (mocked) hook and writes it to the real store — seed both. */
  const storeWith = (enabled: boolean) => {
    const store = makeStore();
    store.dispatch(setTelemetryEnabled(enabled));
    return store;
  };

  beforeEach(() => { mockBroadcast = idle; mockRetry.mockClear(); portrait(); });

  it('turning it back ON after a denial re-asks for permission, not just redux intent', async () => {
    mockBroadcast = { ...idle, phase: 'ready', telemetry: { ...idle.telemetry, enabled: false, denied: true } };
    const { r, store } = await render(storeWith(false));
    await tapCheckbox(r);
    expect(store.getState().broadcast.telemetry.enabled).toBe(true);
    expect(mockRetry).toHaveBeenCalledTimes(1);
    await act(async () => { r.unmount(); });
  });

  it('turning it on when nothing was ever denied only flips the intent', async () => {
    mockBroadcast = { ...idle, telemetry: { ...idle.telemetry, enabled: false, denied: false } };
    const { r, store } = await render(storeWith(false));
    await tapCheckbox(r);
    expect(store.getState().broadcast.telemetry.enabled).toBe(true);
    expect(mockRetry).not.toHaveBeenCalled();
    await act(async () => { r.unmount(); });
  });

  it('turning it OFF never asks for permission', async () => {
    mockBroadcast = { ...idle, telemetry: { ...idle.telemetry, enabled: true, denied: true } };
    const { r, store } = await render(storeWith(true));
    await tapCheckbox(r);
    expect(store.getState().broadcast.telemetry.enabled).toBe(false);
    expect(mockRetry).not.toHaveBeenCalled();
    await act(async () => { r.unmount(); });
  });
});
