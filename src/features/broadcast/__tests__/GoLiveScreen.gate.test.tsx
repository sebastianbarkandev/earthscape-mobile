/**
 * SEC-017 / SEC-021: the deep-link join path (`/golive?eventId=`) is gated at the SCREEN, not
 * only in the hook. While the gate is `checking` or `denied`, GoLiveScreen must neither open
 * the camera (requestPermissions / startPreview / the preview view) nor offer "Join live", so a
 * `start({eventId})` — i.e. `POST /live/streams {event_id}` — can never be issued for an event
 * the caller may not join. Reverting `if (!supported || !gateReady) return;` or the
 * denied/checking early returns makes these tests fail.
 */
import React from 'react';
import { ActivityIndicator, Pressable, Text } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import type { JoinGate } from '../useJoinGate';
import { EarthscapeLive, EarthscapeLivePreviewView } from '../../../../modules/earthscape-live';
import { makeStore } from '@/features/player/__tests__/fixtures';

let mockGate: JoinGate = { status: 'none' };
const mockUseJoinGate = jest.fn((..._args: unknown[]) => mockGate);
const mockStart = jest.fn(async (_opts?: { eventId?: number; title?: string }) => undefined);

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));
jest.mock('../useJoinGate', () => ({ useJoinGate: (...args: unknown[]) => mockUseJoinGate(...args) }));
jest.mock('../useBroadcast', () => {
  const broadcastReducer = require('../broadcastSlice').default;
  const idle = broadcastReducer(undefined, { type: '@@init' });
  return { useBroadcast: () => ({ broadcast: idle, start: mockStart, stop: jest.fn(), confirmStop: jest.fn(), leave: jest.fn(async () => undefined) }) };
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

const requestPermissions = EarthscapeLive.requestPermissions as unknown as jest.Mock;
const startPreview = EarthscapeLive.startPreview as unknown as jest.Mock;

const settle = () => act(async () => { await new Promise((res) => setTimeout(res, 0)); });
const pressable = (root: ReactTestInstance, label: string) =>
  root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === label);
const texts = (root: ReactTestInstance) =>
  root.findAllByType(Text).map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')));

async function render(eventId?: number) {
  const store = makeStore();
  const tree = () => (
    <Provider store={store}>
      <GoLiveScreen eventId={eventId} eventTitle="Flight 12" />
    </Provider>
  );
  let r!: ReactTestRenderer;
  await act(async () => { r = create(tree()); });
  await settle();
  const rerender = async () => { await act(async () => { r.update(tree()); }); await settle(); };
  return { r, rerender };
}

beforeEach(() => {
  mockGate = { status: 'none' };
  mockUseJoinGate.mockClear();
  mockStart.mockClear();
  requestPermissions.mockClear();
  startPreview.mockClear();
});

describe('GoLiveScreen join gate (SEC-017)', () => {
  it('baseline: creating a NEW stream (no eventId) starts the camera and "Go live" reaches start()', async () => {
    const { r } = await render(undefined);
    expect(mockUseJoinGate).toHaveBeenCalledWith(undefined, true);
    expect(startPreview).toHaveBeenCalledTimes(1);
    expect(r.root.findAllByType(EarthscapeLivePreviewView)).toHaveLength(1);
    const [goLive] = pressable(r.root, 'Go live');
    expect(goLive).toBeDefined();
    await act(async () => { await goLive.props.onPress(); });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ eventId: undefined });
  });

  it('denied: no camera, no preview view, no "Join live" — the reason is shown instead', async () => {
    mockGate = { status: 'denied', reason: "You don't have permission to add a camera to this event." };
    const { r } = await render(42);
    expect(mockUseJoinGate).toHaveBeenCalledWith(42, true); // the gate is fed the deep-link eventId
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(startPreview).not.toHaveBeenCalled();
    expect(r.root.findAllByType(EarthscapeLivePreviewView)).toHaveLength(0);
    expect(pressable(r.root, 'Join live')).toHaveLength(0);
    expect(pressable(r.root, 'Go live')).toHaveLength(0);
    expect(texts(r.root)).toContain("You don't have permission to add a camera to this event.");
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('checking: nothing starts until the gate flips to allowed; then the camera starts once and "Join live" posts the join', async () => {
    mockGate = { status: 'checking' };
    const { r, rerender } = await render(42);
    expect(requestPermissions).not.toHaveBeenCalled();
    expect(startPreview).not.toHaveBeenCalled();
    expect(r.root.findAllByType(EarthscapeLivePreviewView)).toHaveLength(0);
    expect(r.root.findAllByType(ActivityIndicator)).toHaveLength(1);
    expect(pressable(r.root, 'Join live')).toHaveLength(0);

    mockGate = { status: 'allowed', primaryTitle: 'Flight 12' };
    await rerender();
    expect(startPreview).toHaveBeenCalledTimes(1);
    expect(r.root.findAllByType(EarthscapeLivePreviewView)).toHaveLength(1);
    const [join] = pressable(r.root, 'Join live');
    expect(join).toBeDefined();
    await act(async () => { await join.props.onPress(); });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ eventId: 42 });
  });

  it('a gate that flips back to denied (event ended / permission revoked) takes the preview and "Join live" away again', async () => {
    mockGate = { status: 'allowed', primaryTitle: 'Flight 12' };
    const { r, rerender } = await render(42);
    expect(pressable(r.root, 'Join live')).toHaveLength(1);

    mockGate = { status: 'denied', reason: 'This event is not live any more — a camera can only be added while the primary stream is live.' };
    await rerender();
    expect(r.root.findAllByType(EarthscapeLivePreviewView)).toHaveLength(0);
    expect(pressable(r.root, 'Join live')).toHaveLength(0);
    expect(startPreview).toHaveBeenCalledTimes(1); // never restarted while denied
    expect(mockStart).not.toHaveBeenCalled();
  });

  /**
   * TEST-004: the belt-and-braces layer. The three tests above only prove the BUTTON is
   * absent while the gate is not `allowed`; neutering `onStart`'s opening guard
   * (`if (eventId && joinGate.status !== 'allowed') return;`) left them all green. A press
   * that was already in flight when the gate flipped — or any future refactor that keys the
   * button off `phase` rather than the gate — must still not reach `POST /live/streams`.
   */
  it('a STALE press captured while allowed cannot post the join after the gate flips to denied', async () => {
    mockGate = { status: 'allowed', primaryTitle: 'Flight 12' };
    const { r, rerender } = await render(42);
    const [join] = pressable(r.root, 'Join live');
    expect(join).toBeDefined();
    const stalePress = join.props.onPress as () => Promise<void>;

    mockGate = { status: 'denied', reason: 'This event is not live any more.' };
    await rerender();
    expect(pressable(r.root, 'Join live')).toHaveLength(0);

    // The handler the user's finger is holding is the one captured while allowed.
    await act(async () => { await stalePress(); });
    expect(mockStart).not.toHaveBeenCalled();

    // Same for `checking` — the gate answer has not arrived, so nothing may be posted.
    mockGate = { status: 'checking' };
    await rerender();
    await act(async () => { await stalePress(); });
    expect(mockStart).not.toHaveBeenCalled();

    // And the FRESH handler once the gate allows again does reach start() — the guard
    // refuses the state, not the button.
    mockGate = { status: 'allowed', primaryTitle: 'Flight 12' };
    await rerender();
    const [fresh] = pressable(r.root, 'Join live');
    await act(async () => { await fresh.props.onPress(); });
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart.mock.calls[0][0]).toMatchObject({ eventId: 42 });
  });
});
