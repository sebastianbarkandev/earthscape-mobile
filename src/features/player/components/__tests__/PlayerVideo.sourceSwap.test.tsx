/**
 * LIVE-029: `useVideoPlayer` re-creates the player and re-runs its setup whenever `sourceUri`
 * changes, and that happens mid-view — `hls_stream_url` flips from `/live/{id}/playlist.m3u8` to the
 * recorded HLS as soon as the transcode lands (backend models/video.py uses the live URL only
 * `if live_stream and not self.hls_stream`), which is exactly what the viewing heartbeat and the 20s
 * refreshEvent exist to pick up. Nothing re-applied the viewer's intent to the new instance, so:
 *   (a) a deliberately paused program started playing on its own, and
 *   (b) the LIVE-020 pause taken by "Add my camera" was discarded mid-broadcast — the primary
 *       played unmuted out of the speaker into the phone's own AAC track.
 * PlayerVideo keeps the intent (paused / muted / rate) across the re-creation and asks
 * `shouldAutoplay()` — which also refuses while the camera owns the audio session.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerVideo, type PlayerVideoHandle } from '../PlayerVideo';
import { acquireCaptureAudioFocus, isCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';

interface FakePlayer {
  source: string;
  playing: boolean;
  muted: boolean;
  playbackRate: number;
  play: jest.Mock;
  pause: jest.Mock;
  emitPlaying: (isPlaying: boolean) => void;
}

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
        emitPlaying: (isPlaying: boolean) => (listeners.playingChange ?? []).forEach((cb) => cb({ isPlaying })),
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
const latest = () => fakePlayers()[fakePlayers().length - 1];

const LIVE_SRC = 'https://demo.earthscape.com/live/500/playlist.m3u8';
const VOD_SRC = 'https://cdn.example/100/index.m3u8';

const mounted: ReactTestRenderer[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
  fakePlayers().length = 0;
  expect(isCaptureAudioFocusHeld()).toBe(false);
});

/** Mounts the main viewport on a live source and returns a setter for the swap the refresh does. */
function render() {
  const ref = React.createRef<PlayerVideoHandle>();
  const paused: boolean[] = [];
  const tree = (sourceUri: string, isLive: boolean) => (
    <PlayerVideo
      ref={ref}
      sourceUri={sourceUri}
      isLive={isLive}
      onTimeUpdate={() => undefined}
      onPlayingChange={(p) => paused.push(!p)}
      seek={null}
    />
  );
  let r!: ReactTestRenderer;
  act(() => { r = create(tree(LIVE_SRC, true)); });
  mounted.push(r);
  return {
    ref,
    pausedMirror: paused,
    swapToRecording: () => act(() => { r.update(tree(VOD_SRC, false)); }),
  };
}

describe('PlayerVideo intent across a source swap (LIVE-029)', () => {
  it('control: an untouched player keeps playing across the live -> recorded swap', () => {
    const { swapToRecording } = render();
    expect(latest().play).toHaveBeenCalledTimes(1);
    swapToRecording();
    expect(latest().source).toBe(VOD_SRC);
    expect(latest().play).toHaveBeenCalledTimes(1);
    expect(latest().playing).toBe(true);
  });

  it('a program the viewer paused stays paused when its recording becomes ready', () => {
    const { ref, swapToRecording } = render();
    const live = latest();
    act(() => { ref.current!.pause(); });
    expect(live.pause).toHaveBeenCalledTimes(1);
    swapToRecording();
    const vod = latest();
    expect(vod).not.toBe(live);
    expect(vod.play).not.toHaveBeenCalled();
    expect(vod.playing).toBe(false);
    // ...and the viewer can still start it, which sticks across a further swap.
    act(() => { ref.current!.play(); });
    expect(vod.play).toHaveBeenCalledTimes(1);
  });

  it('a buffering stall (playingChange false) is NOT taken as intent to stay paused', () => {
    const { pausedMirror, swapToRecording } = render();
    act(() => { latest().emitPlaying(false); });
    expect(pausedMirror).toEqual([true]); // the store mirror still sees it
    swapToRecording();
    expect(latest().play).toHaveBeenCalledTimes(1);
  });

  it('muted / rate the viewer chose are re-applied to the new player', () => {
    const { ref, swapToRecording } = render();
    act(() => {
      ref.current!.setMuted(true);
      ref.current!.setRate(2);
    });
    swapToRecording();
    expect(latest().muted).toBe(true);
    expect(latest().playbackRate).toBe(2);
  });

  it('LIVE-020 (b): a swap while the camera owns the audio session does not start playback', () => {
    const { ref, swapToRecording } = render();
    const live = latest();
    // "Add my camera": pause, then /golive takes the capture hold for the mic.
    act(() => { ref.current!.pause(); });
    let release!: () => void;
    act(() => { release = acquireCaptureAudioFocus(); });
    swapToRecording();
    expect(latest().play).not.toHaveBeenCalled();
    expect(live.playing).toBe(false);
    act(() => { release(); });
  });

  it('a swap that happens while the hold is held (nothing paused) still stays silent', () => {
    let release!: () => void;
    act(() => { release = acquireCaptureAudioFocus(); });
    const { swapToRecording } = render();
    expect(latest().play).not.toHaveBeenCalled(); // even the first mount is silent
    swapToRecording();
    expect(latest().play).not.toHaveBeenCalled();
    act(() => { release(); });
  });
});
