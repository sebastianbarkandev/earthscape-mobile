/**
 * LIVE-033 / REG-002 and LIVE-035 — the MAIN viewport's live-playlist retry.
 *
 * LIVE-033/REG-002: LIVE-028 gave the main player the tiles' bounded 10 s reload but not their
 * capture freeze, so while the viewer publishes from /golive ("Add my camera" pushes it OVER this
 * screen, which stays mounted) the viewport kept fetching a 404ing playlist every 10 s — up to 30
 * HLS loads competing with the phone's own SRT uplink, on a screen the user cannot see or stop.
 * That is the second reason ProgramStrip freezes its tiles (ProgramStrip.tsx). The rule now lives
 * inside `useLivePlaylistRetry` so no owner of a live player can forget it.
 *
 * LIVE-035: the bound is deliberate, but nothing re-arms it — the reset keys on the player object
 * and a live program's `/live/{id}/playlist.m3u8` never changes, so the 20 s refreshEvent produces
 * an identical source and `useVideoPlayer` does not re-key. The overlay must therefore stop
 * claiming "Connecting…" about a player that has stopped trying, and offer one tap to try again.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerVideo } from '../PlayerVideo';
import { LIVE_RETRY_MAX_ATTEMPTS, LIVE_RETRY_MS } from '../../hooks/useLivePlaylistRetry';
import { acquireCaptureAudioFocus, isCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';

interface FakePlayer {
  source: string;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  replaceAsync: jest.Mock;
  emitStatus: (status: string) => void;
}

// Memoized per source, like the real `useVideoPlayer` (useReleasingSharedObject keyed on source).
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
        playbackRate: 1,
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

// eslint-disable-next-line @typescript-eslint/no-var-requires
const fakePlayers = () => (require('expo-video') as { __players: FakePlayer[] }).__players;

const LIVE_SRC = 'https://demo.earthscape.com/live/2010/playlist.m3u8';

const mounted: ReactTestRenderer[] = [];
const releases: (() => void)[] = [];
afterEach(() => {
  releases.splice(0).forEach((r) => act(() => r()));
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  fakePlayers().length = 0;
  jest.useRealTimers();
  expect(isCaptureAudioFocusHeld()).toBe(false); // nothing may leak a hold into the next test
});

function render(sourceUri: string, isLive: boolean) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <PlayerVideo sourceUri={sourceUri} isLive={isLive} onTimeUpdate={() => undefined} onPlayingChange={() => undefined} seek={null} />,
    );
  });
  mounted.push(r);
  return { r, player: fakePlayers()[fakePlayers().length - 1] };
}

const labels = (r: ReactTestRenderer, text: string) => r.root.findAllByType(Text).filter((n) => n.props.children === text);
const retryButton = (r: ReactTestRenderer) =>
  r.root.findAll((n) => n.type === Pressable && n.props.accessibilityLabel === 'Retry connecting')[0] ?? null;

describe('main viewport vs the phone publisher (LIVE-033 / REG-002)', () => {
  it('does not reload the live playlist while the camera owns the audio session, and resumes after', async () => {
    jest.useFakeTimers();
    const { player } = render(LIVE_SRC, true);

    // "Add my camera": /golive is pushed over this screen and takes the capture hold.
    let release!: () => void;
    act(() => { release = acquireCaptureAudioFocus(); });
    act(() => { player.emitStatus('error'); }); // the primary's playlist hiccups behind the modal
    await act(async () => { jest.advanceTimersByTime(3 * LIVE_RETRY_MS); });
    expect(player.replaceAsync).not.toHaveBeenCalled();
    expect(player.play).toHaveBeenCalledTimes(1); // the useVideoPlayer setup only

    // Back on the player screen: the same recovery the tiles get resumes.
    act(() => { release(); });
    await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    expect(player.replaceAsync).toHaveBeenCalledWith(LIVE_SRC);
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
  });

  // The async half of LIVE-032, on this player: `replaceAsync` resolves off the main thread, so a
  // hold taken while it is in flight must still suppress the post-reload play(). Here BOTH guards
  // apply — this owner's `canPlay` (shouldAutoplay reads the hold) and the hook's own fire-time
  // check; the tiles pass no `canPlay`, so that check is proven in ProgramStrip.retryHold.test.tsx.
  it('a hold taken while a reload is in flight suppresses its play()', async () => {
    jest.useFakeTimers();
    const { player } = render(LIVE_SRC, true);
    act(() => { player.emitStatus('error'); });
    act(() => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); }); // timer fires; the .then is queued
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    let release!: () => void;
    act(() => { release = acquireCaptureAudioFocus(); });
    await act(async () => { await Promise.resolve(); }); // now the callback runs
    expect(player.play).toHaveBeenCalledTimes(1); // setup only — the reload's play() was vetoed
    act(() => { release(); });
  });
});

describe('exhausted live retry is honest and recoverable (LIVE-035)', () => {
  it('reports the terminal state and one tap re-arms the bounded loop', async () => {
    jest.useFakeTimers();
    const { r, player } = render(LIVE_SRC, true);
    act(() => { player.emitStatus('error'); });
    expect(retryButton(r)).toBeNull(); // while it is still trying, it says "Connecting…"
    expect(labels(r, 'Connecting…')).toHaveLength(1);

    for (let i = 0; i < LIVE_RETRY_MAX_ATTEMPTS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    }
    expect(player.replaceAsync).toHaveBeenCalledTimes(LIVE_RETRY_MAX_ATTEMPTS);

    // The bound is spent: no more reloads, and the overlay must not keep claiming it is connecting.
    await act(async () => { jest.advanceTimersByTime(5 * LIVE_RETRY_MS); });
    expect(player.replaceAsync).toHaveBeenCalledTimes(LIVE_RETRY_MAX_ATTEMPTS);
    expect(labels(r, 'Connecting…')).toHaveLength(0);
    const retry = retryButton(r);
    expect(retry).not.toBeNull();
    expect(labels(r, 'Still connecting — tap to retry')).toHaveLength(1);

    // The phone finally starts publishing: the user asks for one more attempt and gets it.
    await act(async () => { retry!.props.onPress(); });
    expect(labels(r, 'Connecting…')).toHaveLength(1);
    expect(retryButton(r)).toBeNull();
    await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    expect(player.replaceAsync).toHaveBeenCalledTimes(LIVE_RETRY_MAX_ATTEMPTS + 1);
    act(() => { player.emitStatus('readyToPlay'); });
    expect(labels(r, 'Connecting…')).toHaveLength(0);
    expect(retryButton(r)).toBeNull();
  });
});
