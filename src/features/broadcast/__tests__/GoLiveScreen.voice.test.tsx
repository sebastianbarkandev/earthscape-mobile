/**
 * Voice commands on the Go Live screen: the settings rows before going live, the control-row
 * button (dead until live — marks need the stream's video), and the HUD once voice is on.
 * `useBroadcast` is mocked like the other screen tests, but the voice hook reads the REAL store,
 * so the store is driven to `live` as well.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import broadcastReducer, { createBroadcast, publisherStateChanged, voiceClipIn, voiceFeedback, voiceSetMode, type BroadcastState } from '../broadcastSlice';
import { makeStore, type TestStore } from '@/features/player/__tests__/fixtures';
import { EarthscapeLive } from '../../../../modules/earthscape-live';
import type { MobileStream } from '../api';

const mockWindow = { width: 393, height: 852, scale: 3, fontScale: 1 };
const mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
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
      isVoiceSupported: true,
      requestPermissions: jest.fn(async () => ({ camera: 'granted', microphone: 'granted' })),
      startPreview: jest.fn(async () => undefined),
      switchCamera: jest.fn(async () => 'front'),
      setTorch: jest.fn(async () => undefined),
      setMuted: jest.fn(async () => undefined),
      getSpeechPermission: jest.fn(async () => 'granted'),
      requestSpeechPermission: jest.fn(async () => 'granted'),
      setVoiceListening: jest.fn(async () => undefined),
      haptic: jest.fn(),
    },
    EarthscapeLivePreviewView: () => null,
    addLiveListener: jest.fn(() => ({ remove: () => undefined })),
  };
});
const native = EarthscapeLive as unknown as { setVoiceListening: jest.Mock; getSpeechPermission: jest.Mock };

const stream: MobileStream = {
  id: 9, status: 'started', video_id: 70, event_id: 7, is_primary: true, program_type: null, title: 't', created_at: '2023-11-14T22:13:20', ended_at: null,
  playlist_ready: true, playlist_url: '/live/9/playlist.m3u8', server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: 'p', pbkeylen: 16, latency_ms: 400, url: 'srt://h:4096?mode=caller&passphrase=p&pbkeylen=16&latency=400' },
  telemetry_url: '/api/v1/live/streams/9/telemetry',
};
const stats = { videoBitrateKbps: 1234, sendRateKbps: 1180, rttMs: 42, lost: 0, dropped: 0, sendBufferMs: 120, congestion: 0.1, elapsedSec: 61 };

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

const byLabel = (r: ReactTestRenderer, label: string) =>
  r.root.findAll((n: ReactTestInstance) => typeof n.type !== 'string' && n.props.accessibilityLabel === label && typeof n.props.onPress === 'function');
const hostNode = (r: ReactTestRenderer, testID: string) =>
  r.root.findAll((n: ReactTestInstance) => typeof n.type === 'string' && n.props.testID === testID);
const texts = (r: ReactTestRenderer) =>
  r.root.findAll((n: ReactTestInstance) => n.type === 'Text').map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')));

/** Drive the real store live and mirror it into the mocked useBroadcast. */
function live(store: TestStore) {
  store.dispatch(createBroadcast.fulfilled(stream, 'r', {}));
  store.dispatch(publisherStateChanged({ state: 'publishing', reason: 'connected' }));
  mockBroadcast = { ...store.getState().broadcast, stats: stats as never };
}

beforeEach(() => {
  mockBroadcast = idle;
  native.setVoiceListening.mockClear();
  native.getSpeechPermission.mockClear();
});

describe('voice commands on the Go Live screen', () => {
  it('before going live: wake-phrase checkbox + reaction-offset chips are in the settings, the voice button is disabled, no HUD', async () => {
    const { r, store } = await render();
    const [wake] = byLabel(r, 'Listen for the voice command wake phrase while live');
    expect(wake).toBeDefined();
    expect(wake.props.accessibilityState).toEqual({ checked: true });
    await act(async () => { wake.props.onPress(); });
    expect(store.getState().broadcast.voice.wakeEnabled).toBe(false);

    expect(hostNode(r, 'golive-voice-offset')).toHaveLength(1);
    const [noOffset] = byLabel(r, 'No offset');
    expect(noOffset).toBeDefined();
    await act(async () => { noOffset.props.onPress(); });
    expect(store.getState().broadcast.voice.reactionOffsetSec).toBe(0);

    const [btn] = byLabel(r, 'Turn on voice commands');
    expect(btn).toBeDefined();
    expect(btn.props.disabled).toBe(true);
    expect(hostNode(r, 'golive-voice-hud')).toHaveLength(0);
    await act(async () => { r.unmount(); });
  });

  it('live: standby auto-arms, the HUD invites the wake phrase and the button is enabled', async () => {
    const store = makeStore();
    live(store);
    const { r } = await render(store);
    expect(native.setVoiceListening).toHaveBeenCalledWith(true, expect.any(Array));
    expect(store.getState().broadcast.voice.mode).toBe('standby');
    expect(hostNode(r, 'golive-voice-hud')).toHaveLength(1);
    expect(texts(r).some((t) => t.includes('Say “activate voice commands”'))).toBe(true);
    const [btn] = byLabel(r, 'Turn off voice commands');
    expect(btn).toBeDefined();
    expect(btn.props.disabled).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('active with an open clip: HUD shows the state line, the clip badge and the mark count', async () => {
    const store = makeStore();
    live(store);
    const { r } = await render(store);
    await act(async () => {
      store.dispatch(voiceSetMode('active'));
      store.dispatch(voiceClipIn({ atUnix: Date.now() / 1000 - 65 }));
    });
    const t = texts(r);
    expect(t.some((x) => x.includes('Voice commands active'))).toBe(true);
    expect(t.some((x) => /^Clip 1:0[45]$/.test(x))).toBe(true);
    const [btn] = byLabel(r, 'Turn off voice commands');
    expect(btn.props.accessibilityState).toMatchObject({ selected: true });
    await act(async () => { r.unmount(); });
  });

  it('tapping the HUD reveals the command list', async () => {
    const store = makeStore();
    live(store);
    const { r } = await render(store);
    expect(texts(r).some((x) => x.includes('adds a timepoint'))).toBe(false);
    const [hud] = r.root.findAll((n: ReactTestInstance) => typeof n.type !== 'string' && n.props.testID === 'golive-voice-hud' && typeof n.props.onPress === 'function');
    await act(async () => { hud.props.onPress(); });
    expect(texts(r).some((x) => x.includes('adds a timepoint'))).toBe(true);
    await act(async () => { r.unmount(); });
  });

  it('the help panel lists what voice did (and failed to do) this broadcast, newest first', async () => {
    const store = makeStore();
    live(store);
    const { r } = await render(store);
    await act(async () => {
      store.dispatch(voiceSetMode('active'));
      store.dispatch(voiceFeedback({ text: 'Request failed (HTTP 403)', tone: 'err' }));
    });
    expect(hostNode(r, 'golive-voice-history')).toHaveLength(0);
    const [hud] = r.root.findAll((n: ReactTestInstance) => typeof n.type !== 'string' && n.props.testID === 'golive-voice-hud' && typeof n.props.onPress === 'function');
    await act(async () => { hud.props.onPress(); });
    expect(hostNode(r, 'golive-voice-history')).toHaveLength(1);
    const lines = texts(r).filter((x) => /^\d\d:\d\d:\d\d {2}/.test(x));
    expect(lines.map((x) => x.replace(/^\d\d:\d\d:\d\d {2}/, ''))).toEqual(['Request failed (HTTP 403)', 'Voice commands active', 'Say “activate voice commands”']);
    await act(async () => { r.unmount(); });
  });
});
