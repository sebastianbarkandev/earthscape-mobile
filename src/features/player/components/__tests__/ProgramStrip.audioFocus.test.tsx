/**
 * LIVE-024: a phone publishing from the Go Live screen needs the process-wide AVAudioSession in
 * `.playAndRecord` (LivePublisher.configureAudioSession). expo-video shares that ONE session and
 * re-asserts `.playback`/`.moviePlayback` on EVERY player state change — VideoManager.setAudioSession()
 * sets the category unconditionally, so muted tiles and `audioMixingMode` do not make it harmless
 * (node_modules/expo-video/ios/VideoPlayer.swift:322 -> VideoManager.swift). The ProgramStrip tiles of
 * the player screen keep decoding behind the pushed /golive route, and a stall or the 10s playlist
 * retry (`replaceAsync` + `play`) is exactly such a state change → microphone dies mid-broadcast.
 *
 * The fix: GoLiveScreen holds the capture audio focus for its whole lifetime
 * (src/features/broadcast/audioFocus.ts) and the tiles freeze while it is held, resuming a LIVE tile
 * at the live edge (fresh playlist + a seek past the end, which AVPlayer clamps) on the way back.
 * Reverting either half fails these tests.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ProgramStrip } from '../ProgramStrip';
import { GoLiveScreen } from '@/features/broadcast/GoLiveScreen';
import { acquireCaptureAudioFocus, isCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';
import { MAX_TILE_PLAYERS } from '../../programs';
import { eventPayload, primary, s1, s2, s3, T0 } from '../../__tests__/multiprogramFixtures';
import { makeStore } from '../../__tests__/fixtures';
import { loadEvent, setCurrentTime } from '../../playerSlice';

/** Mirrors LIVE_RETRY_MS in hooks/useLivePlaylistRetry (the live playlist retry period). */
const LIVE_RETRY_MS = 10000;

interface FakePlayer {
  source: string;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  replaceAsync: jest.Mock;
  seekBy: jest.Mock;
  emitStatus: (status: string) => void;
}

// The mock MEMOIZES the player per component instance like the real `useVideoPlayer` does:
// a fresh object on every render would make the tiles' effects re-run for the wrong reason.
jest.mock('expo-video', () => {
  const React = require('react');
  const players: unknown[] = [];
  return {
    __players: players,
    useVideoPlayer: jest.fn((source: string, setup?: (p: unknown) => void) => {
      const ref = React.useRef(null);
      if (ref.current && ref.current.source === source) return ref.current;
      const listeners: Record<string, ((e: unknown) => void)[]> = {};
      const p = {
        source,
        playing: false,
        currentTime: 0,
        muted: false,
        loop: false,
        timeUpdateEventInterval: 0,
        play: jest.fn(function (this: { playing: boolean }) { this.playing = true; }),
        pause: jest.fn(function (this: { playing: boolean }) { this.playing = false; }),
        replaceAsync: jest.fn(() => Promise.resolve()),
        seekBy: jest.fn(),
        addListener: jest.fn((name: string, cb: (e: unknown) => void) => {
          (listeners[name] ||= []).push(cb);
          return { remove: jest.fn() };
        }),
        emitStatus: (status: string) => (listeners.statusChange ?? []).forEach((cb) => cb({ status })),
      };
      setup?.(p);
      players.push(p);
      ref.current = p;
      return p;
    }),
    VideoView: () => null,
  };
});
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('@/common/media', () => ({}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }), useFocusEffect: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));
jest.mock('@/features/broadcast/useJoinGate', () => ({ useJoinGate: () => ({ status: 'none' }) }));
jest.mock('@/features/broadcast/useBroadcast', () => {
  const broadcastReducer = require('@/features/broadcast/broadcastSlice').default;
  const idle = broadcastReducer(undefined, { type: '@@init' });
  return { useBroadcast: () => ({ broadcast: idle, start: jest.fn(), stop: jest.fn(), confirmStop: jest.fn(), leave: jest.fn(async () => undefined) }) };
});
jest.mock('../../../../../modules/earthscape-live', () => {
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fakePlayers = () => (require('expo-video') as { __players: FakePlayer[] }).__players;

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  fakePlayers().length = 0;
  jest.useRealTimers();
  // Nothing may leak a hold into the next test.
  expect(isCaptureAudioFocusHeld()).toBe(false);
});

/** 1 primary + 3 live phone programs: 2 tiles decode, the third is a thumbnail. */
function renderPlayerScreen(initialVideos = [primary, s1, s2, s3]) {
  const store = makeStore();
  let videos = initialVideos;
  store.dispatch(loadEvent.fulfilled({ event: eventPayload(videos), video: primary, permissions: null }, 'r', { eventId: 7 }));
  store.dispatch(setCurrentTime({ video: 30, utc: T0 + 30 }));
  let goLiveNow = false;
  const tree = () => (
    <Provider store={store}>
      <ProgramStrip videos={videos} activeId={primary.id} activeIsLive={false} />
      {goLiveNow ? <GoLiveScreen eventId={primary.event_id ?? 7} eventTitle="Flight 12" /> : null}
    </Provider>
  );
  let r!: ReactTestRenderer;
  act(() => { r = create(tree()); });
  mounted.push(r);
  return {
    store,
    setGoLive: (on: boolean) => act(() => { goLiveNow = on; r.update(tree()); }),
    /** What the 20s refreshEvent does behind the modal: programs join / their source flips. */
    setVideos: (next: typeof initialVideos) => act(() => { videos = next; r.update(tree()); }),
  };
}

describe('ProgramStrip tiles vs the phone publisher audio session (1 primary + 3 live secondaries)', () => {
  it('freezes every decoding tile while the Go Live screen is mounted and resumes at the live edge', async () => {
    const { setGoLive } = renderPlayerScreen();
    const players = fakePlayers();
    expect(players).toHaveLength(MAX_TILE_PLAYERS);
    players.forEach((p) => {
      expect(p.play).toHaveBeenCalledTimes(1); // the useVideoPlayer setup
      expect(p.pause).not.toHaveBeenCalled();
    });

    // "Add my camera" pushes /golive: the screen takes the audio session for the mic.
    setGoLive(true);
    expect(isCaptureAudioFocusHeld()).toBe(true);
    players.forEach((p) => {
      expect(p.pause).toHaveBeenCalledTimes(1);
      expect(p.playing).toBe(false);
    });

    // Back on the player screen: live tiles reload the playlist (a fresh live playlist starts at
    // the live edge) and the seek past the end clamps there, so they never resume minutes behind.
    setGoLive(false);
    expect(isCaptureAudioFocusHeld()).toBe(false);
    players.forEach((p) => {
      expect(p.replaceAsync).toHaveBeenCalledWith(p.source);
    });
    await act(async () => { await Promise.resolve(); });
    players.forEach((p) => {
      expect(p.play).toHaveBeenCalledTimes(2);
      expect(p.seekBy).toHaveBeenCalledWith(60 * 60 * 24); // clamped to the live edge
    });
  });

  // LIVE-026: the freeze is an effect over MOUNTED tiles, but `useVideoPlayer`'s setup — with its
  // play() — re-runs for every tile mounted while the hold is held and for every source change of
  // an existing one, which is exactly what the 20s refreshEvent produces during a broadcast.
  // Reverting the setup gate to an unconditional `p.play()` fails both cases below.
  it('a program that JOINS while the mic is live never starts playing (and does after release)', async () => {
    // s3 is the over-cap thumbnail at first; dropping s1 promotes it into a decoding slot.
    const { setGoLive, setVideos } = renderPlayerScreen([primary, s1, s2, s3]);
    expect(fakePlayers()).toHaveLength(MAX_TILE_PLAYERS);

    setGoLive(true);
    expect(isCaptureAudioFocusHeld()).toBe(true);
    fakePlayers().length = 0; // only the tiles created DURING the hold are under test
    setVideos([primary, s2, s3]);
    const joined = fakePlayers();
    expect(joined).toHaveLength(1); // s3 took the freed slot
    joined.forEach((p) => {
      expect(p.play).not.toHaveBeenCalled();
      expect(p.playing).toBe(false);
    });

    setGoLive(false);
    await act(async () => { await Promise.resolve(); });
    joined.forEach((p) => {
      expect(p.replaceAsync).toHaveBeenCalledWith(p.source); // live tile resumes at the live edge
      expect(p.play).toHaveBeenCalledTimes(1);
      expect(p.seekBy).toHaveBeenCalledWith(60 * 60 * 24);
    });
  });

  it('a tile whose stream ENDS mid-broadcast (source flips to the recorded HLS) stays silent', async () => {
    const { setGoLive, setVideos } = renderPlayerScreen([primary, s1, s2, s3]);
    setGoLive(true);
    fakePlayers().length = 0;
    // s1 stopped publishing: same program id, recorded HLS URL -> useVideoPlayer re-runs setup.
    const ended = { ...s1, live_stream_state: 'recording_ready' as const, duration: 300, end: T0 + 300, hls_stream_url: 'https://cdn.example/201/index.m3u8' };
    setVideos([primary, ended, s2, s3]);
    const recreated = fakePlayers();
    expect(recreated.length).toBeGreaterThanOrEqual(1);
    recreated.forEach((p) => {
      expect(p.play).not.toHaveBeenCalled();
      expect(p.playing).toBe(false);
    });
    setGoLive(false);
    await act(async () => { await Promise.resolve(); });
    // A VOD tile under a playing primary resumes without reloading its source.
    expect(recreated[0].play).toHaveBeenCalledTimes(1);
  });

  it('does not run the 10s live-playlist retry while the capture hold is held', async () => {
    jest.useFakeTimers();
    // Control: with nobody holding the audio session, an errored live tile reloads after 10s.
    renderPlayerScreen();
    const [control] = fakePlayers();
    act(() => { control.emitStatus('error'); });
    await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    expect(control.replaceAsync).toHaveBeenCalledWith(control.source);

    // Same tile state while the Go Live screen owns the session: no reload, no play().
    fakePlayers().length = 0;
    renderPlayerScreen();
    const [held] = fakePlayers();
    let release!: () => void;
    act(() => { release = acquireCaptureAudioFocus(); });
    act(() => { held.emitStatus('error'); });
    await act(async () => { jest.advanceTimersByTime(3 * LIVE_RETRY_MS); });
    expect(held.replaceAsync).not.toHaveBeenCalled();
    expect(held.play).toHaveBeenCalledTimes(1); // the useVideoPlayer setup only
    act(() => { release(); });
  });
});
