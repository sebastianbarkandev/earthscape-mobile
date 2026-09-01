/**
 * LIVE-032 — the ASYNC hole in the LIVE-024 capture freeze.
 *
 * Both places a tile can start playing again go through `player.replaceAsync(source)`, whose promise
 * resolves off the main thread hundreds of ms to seconds later (expo-video's
 * `VideoPlayer.replaceCurrentItem` awaits `videoSourceLoader.load`, VideoPlayer.swift). A capture
 * hold taken INSIDE that window is invisible to a gate that was only checked when the reload was
 * scheduled — and it is worse than one stray `play()`: the freeze effect's deps have already
 * transitioned, so it never runs again and the tile keeps decoding (and re-asserting the shared
 * `.playback` audio session on every stall/resume) for the whole broadcast.
 *
 * 1 primary + 3 live phone programs, i.e. the requirement's shape: MAX_TILE_PLAYERS tiles decode.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { ProgramStrip } from '../ProgramStrip';
import { acquireCaptureAudioFocus, isCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';
import { LIVE_EDGE_SEEK_SEC, LIVE_RETRY_MS } from '../../hooks/useLivePlaylistRetry';
import { MAX_TILE_PLAYERS } from '../../programs';
import { eventPayload, primary, s1, s2, s3, T0 } from '../../__tests__/multiprogramFixtures';
import { makeStore } from '../../__tests__/fixtures';
import { loadEvent, setCurrentTime } from '../../playerSlice';

interface FakePlayer {
  source: string;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  replaceAsync: jest.Mock;
  seekBy: jest.Mock;
  emitStatus: (status: string) => void;
}

// Memoized per component instance + source, like the real `useVideoPlayer`.
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
jest.mock('@/common/media', () => ({}));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fakePlayers = () => (require('expo-video') as { __players: FakePlayer[] }).__players;

const mounted: ReactTestRenderer[] = [];
const releases: (() => void)[] = [];
afterEach(() => {
  releases.splice(0).forEach((r) => act(() => r()));
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  fakePlayers().length = 0;
  jest.useRealTimers();
  expect(isCaptureAudioFocusHeld()).toBe(false);
});

/** 1 primary + 3 live phone programs: MAX_TILE_PLAYERS tiles decode, the rest are thumbnails. */
function renderStrip() {
  const store = makeStore();
  const videos = [primary, s1, s2, s3];
  store.dispatch(loadEvent.fulfilled({ event: eventPayload(videos), video: primary, permissions: null }, 'r', { eventId: 7 }));
  store.dispatch(setCurrentTime({ video: 30, utc: T0 + 30 }));
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <ProgramStrip videos={videos} activeId={primary.id} activeIsLive={false} />
      </Provider>,
    );
  });
  mounted.push(r);
  expect(fakePlayers()).toHaveLength(MAX_TILE_PLAYERS);
  return { store, r };
}

/** Take the hold the way /golive does; released by afterEach if the test does not. */
function hold(): () => void {
  let release!: () => void;
  act(() => { release = acquireCaptureAudioFocus(); });
  releases.push(release);
  return () => {
    releases.splice(releases.indexOf(release), 1);
    act(() => release());
  };
}

describe('ProgramStrip tiles: a hold taken DURING an in-flight reload (LIVE-032)', () => {
  it('the 10s playlist retry does not play a tile when the mic went live while it was loading', async () => {
    jest.useFakeTimers();
    renderStrip();
    const tiles = fakePlayers();
    tiles.forEach((p) => expect(p.play).toHaveBeenCalledTimes(1)); // the useVideoPlayer setup

    // Every live tile is in the 404/retry loop (phones still connecting).
    act(() => { tiles.forEach((p) => p.emitStatus('error')); });
    // SYNCHRONOUS advance: the timers fire, `replaceAsync` is called, and its `.then` is only
    // QUEUED — nothing has flushed the microtask queue yet. This is the real-world window.
    act(() => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    tiles.forEach((p) => expect(p.replaceAsync).toHaveBeenCalledWith(p.source));

    // "Add my camera" is tapped right now: /golive mounts and takes the capture hold.
    hold();
    tiles.forEach((p) => expect(p.pause).toHaveBeenCalled()); // the freeze effect parked them

    await act(async () => { await Promise.resolve(); }); // the reloads' callbacks land HERE
    tiles.forEach((p) => {
      expect(p.play).toHaveBeenCalledTimes(1); // still only the setup: the reload's play() lost
      expect(p.playing).toBe(false);
    });

    // And it stays frozen for the rest of the broadcast (no further scheduled reload).
    const reloads = tiles.map((p) => p.replaceAsync.mock.calls.length);
    await act(async () => { jest.advanceTimersByTime(5 * LIVE_RETRY_MS); });
    tiles.forEach((p, i) => {
      expect(p.replaceAsync.mock.calls.length).toBe(reloads[i]);
      expect(p.playing).toBe(false);
    });
  });

  it('the thaw reload does not play a tile when the mic went live again while it was loading', async () => {
    renderStrip();
    const tiles = fakePlayers();

    const release = hold();
    tiles.forEach((p) => expect(p.pause).toHaveBeenCalledTimes(1));

    // Leaving /golive thaws the tiles: a LIVE tile reloads its playlist to resume at the live edge.
    release();
    tiles.forEach((p) => expect(p.replaceAsync).toHaveBeenCalledWith(p.source));

    // The viewer immediately taps "Add my camera" again — before the reload finished loading.
    hold();
    await act(async () => { await Promise.resolve(); });
    tiles.forEach((p) => {
      expect(p.play).toHaveBeenCalledTimes(1); // the setup only
      expect(p.seekBy).not.toHaveBeenCalledWith(LIVE_EDGE_SEEK_SEC);
      expect(p.playing).toBe(false);
    });
  });
});
