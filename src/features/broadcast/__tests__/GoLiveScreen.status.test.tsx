/**
 * GoLiveScreen must report the ACCURATE state of the stream at all times:
 *  - 'ready' while the server stream is still 'starting' is a wait for the live server,
 *    not a plain "Ready" (the app blocks up to 20s there);
 *  - the "waiting for the first segment" hint and the "Viewers can watch now." hint are
 *    mutually exclusive, and neither may sit next to a "Link lost" line.
 * `playlist_ready` itself now means "GET playlist.m3u8 would serve" on the backend
 * (cache OR the EFS fallback) and is sticky in the slice.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import broadcastReducer, { type BroadcastState } from '../broadcastSlice';
import type { MobileStream } from '../api';
import { makeStore } from '@/features/player/__tests__/fixtures';

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
      requestPermissions: jest.fn(async () => ({ camera: 'granted', microphone: 'granted' })),
      startPreview: jest.fn(async () => undefined),
      switchCamera: jest.fn(async () => 'front'),
      setTorch: jest.fn(async () => undefined),
      setMuted: jest.fn(async () => undefined),
    },
    EarthscapeLivePreviewView: () => null,
  };
});

const stream: MobileStream = {
  id: 9, status: 'started', video_id: 70, event_id: 7, is_primary: true, program_type: null, title: 't', created_at: null, ended_at: null,
  playlist_ready: false, playlist_url: '/live/9/playlist.m3u8', server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: 'p', pbkeylen: 16, latency_ms: 400, url: 'srt://h:4096?mode=caller&passphrase=p&pbkeylen=16&latency=400' },
  telemetry_url: '/api/v1/live/streams/9/telemetry',
};
const stats = { videoBitrateKbps: 1234, sendRateKbps: 1180, rttMs: 42, lost: 0, dropped: 0, sendBufferMs: 120, congestion: 0.1, elapsedSec: 61 };

/** Every string rendered anywhere in the tree, each node's children joined (the hints interpolate). */
function texts(r: ReactTestRenderer): string[] {
  const out: string[] = [];
  const walk = (n: ReactTestInstance) => {
    const joined = n.children.filter((c): c is string => typeof c === 'string').join('');
    if (joined.trim()) out.push(joined);
    for (const c of n.children) if (typeof c !== 'string') walk(c);
  };
  walk(r.root);
  return out;
}
const has = (r: ReactTestRenderer, needle: string) => texts(r).some((t) => t.includes(needle));

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

const WAITING = 'waiting for the server to publish the first segment';
const OK = 'Viewers can watch now.';

describe('GoLiveScreen reports the real stream status', () => {
  beforeEach(() => { mockBroadcast = idle; });

  it("'ready' while the server stream is still 'starting' says we are waiting for the live server", async () => {
    mockBroadcast = { ...idle, phase: 'ready', publisher: 'preview', stream: { ...stream, status: 'starting' } };
    const r = await render();
    expect(has(r, 'Waiting for live server…')).toBe(true);
    expect(has(r, 'Ready')).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('publishing but no servable playlist yet: only the waiting hint', async () => {
    mockBroadcast = { ...idle, phase: 'live', publisher: 'publishing', stats: stats as never, stream: { ...stream, playlist_ready: false } };
    const r = await render();
    expect(has(r, WAITING)).toBe(true);
    expect(has(r, OK)).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('publishing with a servable playlist: only the success hint', async () => {
    mockBroadcast = { ...idle, phase: 'live', publisher: 'publishing', stats: stats as never, stream: { ...stream, playlist_ready: true } };
    const r = await render();
    expect(has(r, OK)).toBe(true);
    expect(has(r, WAITING)).toBe(false);
    await act(async () => { r.unmount(); });
  });

  it('reconnecting: neither hint, the link-lost line instead', async () => {
    mockBroadcast = {
      ...idle, phase: 'live', publisher: 'reconnecting', reconnectAttempt: 2, nextRetryMs: 1500,
      publisherReason: 'connection lost', stats: stats as never, stream: { ...stream, playlist_ready: true },
    };
    const r = await render();
    expect(has(r, 'Link lost')).toBe(true);
    expect(has(r, OK)).toBe(false);
    expect(has(r, WAITING)).toBe(false);
    await act(async () => { r.unmount(); });
  });
});
