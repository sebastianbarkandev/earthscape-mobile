import React from 'react';
import { Image, Pressable } from 'react-native';
import { act, create } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { useVideoPlayer } from 'expo-video';
import playerReducer, { loadEvent, setCurrentTime } from '../../playerSlice';
import graphReducer from '../../graphSlice';
import { ProgramStrip } from '../ProgramStrip';
import { MAX_TILE_PLAYERS } from '../../programs';
import { eventPayload, makeVideo, primary, s1, s2, s3, s4, T0 } from '../../__tests__/multiprogramFixtures';

jest.mock('expo-video', () => {
  const players: unknown[] = [];
  return {
    __players: players,
    useVideoPlayer: jest.fn((_source: string, setup?: (p: unknown) => void) => {
      const p = {
        playing: false,
        currentTime: 0,
        muted: false,
        loop: false,
        timeUpdateEventInterval: 0,
        play: jest.fn(),
        pause: jest.fn(),
        replaceAsync: jest.fn(() => Promise.resolve()),
        addListener: jest.fn(() => ({ remove: jest.fn() })),
        currentTimeSets: [] as number[],
      };
      Object.defineProperty(p, 'currentTime', {
        get: () => 0,
        set: (v: number) => p.currentTimeSets.push(v),
      });
      setup?.(p);
      players.push(p);
      return p;
    }),
    VideoView: () => null,
  };
});
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));

const mockedUseVideoPlayer = useVideoPlayer as unknown as jest.Mock;
const mounted: ReturnType<typeof create>[] = [];
afterEach(() => {
  mounted.splice(0).forEach((r) => act(() => r.unmount()));
});

function renderStrip(videos: ReturnType<typeof makeVideo>[], activeId: number, extra: Partial<React.ComponentProps<typeof ProgramStrip>> = {}) {
  const store = configureStore({ reducer: { player: playerReducer, graph: graphReducer } });
  store.dispatch(loadEvent.fulfilled({ event: eventPayload(videos), video: videos[0], permissions: null }, 'r', { eventId: 7 }));
  // Primary playhead at 30s (the strip reads the clock from the store).
  store.dispatch(setCurrentTime({ video: 30, utc: T0 + 30 }));
  let renderer!: ReturnType<typeof create>;
  act(() => {
    renderer = create(
      <Provider store={store}>
        <ProgramStrip videos={videos} activeId={activeId} {...extra} />
      </Provider>,
    );
  });
  mounted.push(renderer);
  return { store, renderer };
}

const tiles = (renderer: ReturnType<typeof create>) =>
  renderer.root.findAllByType(Pressable).filter((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show '));

describe('ProgramStrip with 1 primary + 3 live phones (+1 more)', () => {
  it('renders every program as a tappable tile but creates only MAX_TILE_PLAYERS players', () => {
    const { renderer } = renderStrip([primary, s1, s2, s3, s4], primary.id);
    const labels = tiles(renderer).map((t) => t.props.accessibilityLabel);
    expect(labels).toEqual(['Show Mobile · Ana', 'Show Mobile · Ben', 'Show Mobile · Cy', 'Show Mobile · Dee']);
    expect(mockedUseVideoPlayer).toHaveBeenCalledTimes(MAX_TILE_PLAYERS);
  });

  it('tapping a tile makes that program the active video', () => {
    const { store, renderer } = renderStrip([primary, s1, s2, s3], primary.id);
    const tile = tiles(renderer).find((t) => t.props.accessibilityLabel === 'Show Mobile · Cy')!;
    act(() => tile.props.onPress());
    expect(store.getState().player.activeVideoId).toBe(s3.id);
    expect(store.getState().player.isLive).toBe(true);
  });

  it('a processing program gets a placeholder, not a player', () => {
    const processing = { ...s2, live_stream_state: 'processing' as const };
    const { renderer } = renderStrip([primary, processing], primary.id);
    expect(mockedUseVideoPlayer).not.toHaveBeenCalled();
    const texts = renderer.root.findAll((n) => n.props.children === 'Processing…');
    expect(texts.length).toBeGreaterThan(0);
    expect(tiles(renderer)).toHaveLength(1);
  });

  // LIVE-023: the EVENT payload's `thumbnail_url` is double-prefixed for a live video and 404s,
  // so an over-cap live tile used to be a black rectangle with a badge and no hint that it plays.
  it('an over-cap live tile with no usable thumbnail says "Tap to watch" and still swaps program', () => {
    const overCap = { ...s3, thumbnail_url: null };
    const { store, renderer } = renderStrip([primary, s1, s2, overCap], primary.id);
    // 3 live phones, 2 players: the third is the static tile under test.
    expect(mockedUseVideoPlayer).toHaveBeenCalledTimes(MAX_TILE_PLAYERS);
    expect(renderer.root.findAllByType(Image)).toHaveLength(0);
    expect(renderer.root.findAll((n) => n.props.children === 'Tap to watch').length).toBeGreaterThan(0);
    const tile = tiles(renderer).find((t) => t.props.accessibilityLabel === 'Show Mobile · Cy')!;
    act(() => tile.props.onPress());
    expect(store.getState().player.activeVideoId).toBe(s3.id);
  });

  it('a live tile whose thumbnail 404s falls back to the placeholder', () => {
    const { renderer } = renderStrip([primary, s1, s2, s3], primary.id);
    const img = renderer.root.findAllByType(Image);
    expect(img).toHaveLength(1);
    expect(renderer.root.findAll((n) => n.props.children === 'Tap to watch')).toHaveLength(0);
    act(() => img[0].props.onError());
    expect(renderer.root.findAll((n) => n.props.children === 'Tap to watch').length).toBeGreaterThan(0);
  });

  it('VOD tiles are not drift-corrected against a LIVE active program clock', () => {
    const vod = makeVideo({ id: 300, program_type: 'IR', time_mapping: [{ video_start: 0, video_end: 600, utc_start: T0, utc_end: T0 + 600 }] });
    renderStrip([s1, vod], s1.id, { activeIsLive: true });
    const player = mockedUseVideoPlayer.mock.results[0].value as { currentTimeSets: number[] };
    expect(player.currentTimeSets).toEqual([]);
    // ...but they are under a VOD primary (playhead 30s -> tile seeks to 30s).
    mockedUseVideoPlayer.mockClear();
    renderStrip([primary, vod], primary.id, { activeIsLive: false });
    const player2 = mockedUseVideoPlayer.mock.results[0].value as { currentTimeSets: number[] };
    expect(player2.currentTimeSets).toEqual([30]);
  });
});
