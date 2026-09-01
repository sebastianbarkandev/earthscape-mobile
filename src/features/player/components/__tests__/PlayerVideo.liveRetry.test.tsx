/**
 * LIVE-028: a joining phone is `live_stream_state === 'live'` from the moment POST /live/streams
 * returns, but its `hls_stream_url` — the fixed `/live/{id}/playlist.m3u8` — `abort(404)`s until the
 * live server has produced a first segment, and the URL does NOT change when segments appear.
 * AVPlayerItem fails such a load once and never retries, and `useVideoPlayer` keys on the unchanged
 * source string, so nothing re-creates the player: swapping the primary to a phone that is still
 * connecting used to leave the main viewport black forever (the tiles had the recovery, the main
 * player had none). PlayerVideo now shares the tiles' hook — hooks/useLivePlaylistRetry.
 */
import React from 'react';
import { Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerVideo } from '../PlayerVideo';
import { LIVE_RETRY_MAX_ATTEMPTS, LIVE_RETRY_MS } from '../../hooks/useLivePlaylistRetry';

interface FakePlayer {
  source: string;
  playing: boolean;
  play: jest.Mock;
  pause: jest.Mock;
  replaceAsync: jest.Mock;
  emitStatus: (status: string) => void;
}

// Memoized per source, like the real `useVideoPlayer` (useReleasingSharedObject keyed on the source).
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

const LIVE_SRC = 'https://demo.earthscape.com/live/500/playlist.m3u8';
const VOD_SRC = 'https://cdn.example/100/index.m3u8';

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  fakePlayers().length = 0;
  jest.useRealTimers();
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

const connectingLabels = (r: ReactTestRenderer) =>
  r.root.findAllByType(Text).filter((n) => n.props.children === 'Connecting…');

describe('PlayerVideo live playlist recovery (LIVE-028)', () => {
  it('a live source that 404s shows "Connecting…" and reloads once per 10s', async () => {
    jest.useFakeTimers();
    const { r, player } = render(LIVE_SRC, true);
    // Before the first status event the live source is not known-playable: say so, do not go black.
    expect(connectingLabels(r).length).toBe(1);

    act(() => { player.emitStatus('error'); });
    expect(connectingLabels(r).length).toBe(1);
    expect(player.replaceAsync).not.toHaveBeenCalled();
    await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    expect(player.replaceAsync).toHaveBeenCalledWith(LIVE_SRC);
    expect(player.play).toHaveBeenCalledTimes(2); // setup + the reload

    // Nothing extra inside the same period.
    await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS - 1); });
    expect(player.replaceAsync).toHaveBeenCalledTimes(1);
    await act(async () => { jest.advanceTimersByTime(2); });
    expect(player.replaceAsync).toHaveBeenCalledTimes(2);

    // The phone starts publishing: the overlay goes away and the retry stops.
    act(() => { player.emitStatus('readyToPlay'); });
    expect(connectingLabels(r)).toHaveLength(0);
    await act(async () => { jest.advanceTimersByTime(5 * LIVE_RETRY_MS); });
    expect(player.replaceAsync).toHaveBeenCalledTimes(2);
  });

  it('a VOD source never retries and never shows the overlay', async () => {
    jest.useFakeTimers();
    const { r, player } = render(VOD_SRC, false);
    expect(connectingLabels(r)).toHaveLength(0);
    act(() => { player.emitStatus('error'); });
    await act(async () => { jest.advanceTimersByTime(5 * LIVE_RETRY_MS); });
    expect(player.replaceAsync).not.toHaveBeenCalled();
    expect(connectingLabels(r)).toHaveLength(0);
  });

  it('the retry is bounded: a stream that never produces segments stops reloading', async () => {
    jest.useFakeTimers();
    const { player } = render(LIVE_SRC, true);
    act(() => { player.emitStatus('error'); });
    for (let i = 0; i < LIVE_RETRY_MAX_ATTEMPTS + 5; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { jest.advanceTimersByTime(LIVE_RETRY_MS + 1); });
    }
    expect(player.replaceAsync).toHaveBeenCalledTimes(LIVE_RETRY_MAX_ATTEMPTS);
  });

  it('a source swap (live -> recorded HLS) starts the status over instead of inheriting the error', async () => {
    jest.useFakeTimers();
    const { r, player } = render(LIVE_SRC, true);
    act(() => { player.emitStatus('error'); });
    expect(connectingLabels(r).length).toBe(1);
    act(() => {
      r.update(
        <PlayerVideo sourceUri={VOD_SRC} isLive={false} onTimeUpdate={() => undefined} onPlayingChange={() => undefined} seek={null} />,
      );
    });
    const swapped = fakePlayers()[fakePlayers().length - 1];
    expect(swapped.source).toBe(VOD_SRC);
    expect(connectingLabels(r)).toHaveLength(0);
    await act(async () => { jest.advanceTimersByTime(5 * LIVE_RETRY_MS); });
    expect(swapped.replaceAsync).not.toHaveBeenCalled();
  });
});
