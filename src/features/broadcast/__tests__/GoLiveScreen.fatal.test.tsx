/**
 * LIVE-031: a fatal Go-Live failure must not erase its own explanation. `useBroadcast.start()`
 * dispatches `publisherError({fatal:true})` and then, in the same tick, `endBroadcast()` so no
 * server stream dangles — and both `endBroadcast.pending` and `.fulfilled` clear `error`. Without
 * `fatalReason` the screen ends up on "Stream ended / the recording is being processed", i.e. the
 * user is told nothing (and is told something false) about why their broadcast died.
 *
 * The states below are produced by the REAL reducer, driven through the exact action sequences
 * `useBroadcast` performs, so this covers slice + screen together. Removing `fatalReason` (or
 * leaving the 'ended' card branching on `error` alone) fails the first two tests; clearing
 * `fatalReason` on a clean stop fails the third.
 */
import React from 'react';
import { Text } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { GoLiveScreen } from '../GoLiveScreen';
import broadcastReducer, {
  createBroadcast,
  endBroadcast,
  publisherError,
  publisherStateChanged,
  beginEnding,
  type BroadcastState,
} from '../broadcastSlice';
import type { MobileStream } from '../api';
import { makeStore } from '@/features/player/__tests__/fixtures';

let mockBroadcast: BroadcastState = broadcastReducer(undefined, { type: '@@init' });

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));
jest.mock('../useJoinGate', () => ({ useJoinGate: () => ({ status: 'allowed', primaryTitle: 'Flight 12' }) }));
jest.mock('../useBroadcast', () => ({
  useBroadcast: () => ({ broadcast: mockBroadcast, start: jest.fn(async () => false), stop: jest.fn(), confirmStop: jest.fn(), leave: jest.fn(async () => undefined), retryTelemetry: jest.fn(async () => false) }),
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

const PASSPHRASE = 'sup3r-s3cret-pass';
const stream: MobileStream = {
  id: 9, status: 'starting', video_id: 79, event_id: 7, is_primary: false, program_type: 'Mobile · Ana', title: 't', created_at: null, ended_at: null,
  playlist_ready: false, playlist_url: '/live/9/playlist.m3u8', server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: PASSPHRASE, pbkeylen: 16, latency_ms: 400, url: `srt://h:4096?mode=caller&passphrase=${PASSPHRASE}&pbkeylen=16&latency=400` },
  telemetry_url: '/api/v1/live/streams/9/telemetry',
};
const arg = { event_id: 7 };
const created = (): BroadcastState => {
  let s = broadcastReducer(undefined, { type: '@@init' });
  s = broadcastReducer(s, createBroadcast.pending('r', arg));
  return broadcastReducer(s, createBroadcast.fulfilled(stream, 'r', arg));
};
/** Exactly what `start()` does when `waitForStreamStarted` times out / the server ends it early. */
const fatalThenAutoEnd = (message: string, endFails = false): BroadcastState => {
  let s = broadcastReducer(created(), publisherError({ code: 'server_not_started', message, fatal: true }));
  s = broadcastReducer(s, endBroadcast.pending('r2', undefined));
  return endFails
    ? broadcastReducer(s, endBroadcast.rejected(null, 'r2', undefined, 'Network request failed'))
    : broadcastReducer(s, endBroadcast.fulfilled('ended', 'r2', undefined));
};

const settle = () => act(async () => { await new Promise((res) => setTimeout(res, 0)); });
const texts = (root: ReactTestInstance) =>
  root.findAllByType(Text).map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')));

async function render() {
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <GoLiveScreen eventId={7} eventTitle="Flight 12" />
      </Provider>,
    );
  });
  await settle();
  return texts(r.root).join('\n');
}

const LISTENER_TIMEOUT = 'The live server did not start the stream in time. Check that live streaming is available and try again.';

describe('GoLiveScreen shows why a broadcast died (LIVE-031)', () => {
  it("the listener-timeout reason survives the automatic /end and is on screen in the 'ended' phase", async () => {
    mockBroadcast = fatalThenAutoEnd(LISTENER_TIMEOUT);
    expect(mockBroadcast.phase).toBe('ended');
    expect(mockBroadcast.error).toBeNull(); // endBroadcast cleared it — this is the bug's mechanism
    const shown = await render();
    expect(shown).toContain(LISTENER_TIMEOUT);
    expect(shown).toContain('Stream stopped');
    // The success copy would be a lie: nothing was recorded.
    expect(shown).not.toContain('The recording is being processed');
  });

  it('a failing /end after a fatal error shows the real cause first, then the /end trouble', async () => {
    mockBroadcast = fatalThenAutoEnd(LISTENER_TIMEOUT, true);
    const shown = await render();
    expect(shown).toContain(LISTENER_TIMEOUT);
    expect(shown).toContain('Network request failed');
  });

  it('a clean user-initiated End shows no error at all', async () => {
    let s = broadcastReducer(created(), publisherStateChanged({ state: 'publishing', reason: 'connected' }));
    s = broadcastReducer(s, beginEnding());
    s = broadcastReducer(s, endBroadcast.pending('r2', undefined));
    mockBroadcast = broadcastReducer(s, endBroadcast.fulfilled('ending', 'r2', undefined));
    expect(mockBroadcast.fatalReason).toBeNull();
    const shown = await render();
    expect(shown).toContain('Stream ended');
    expect(shown).toContain('The recording is being processed');
    expect(shown).not.toMatch(/Stream stopped|Stream problem|Couldn't end the stream/);
  });

  it('the native error text that reaches the screen never carries the SRT passphrase', async () => {
    mockBroadcast = fatalThenAutoEnd(`SRT connect failed for ${stream.ingest.url}: link lost`);
    expect(mockBroadcast.fatalReason).not.toContain(PASSPHRASE);
    const shown = await render();
    expect(shown).not.toContain(PASSPHRASE);
    expect(shown).toContain('link lost');
  });
});
