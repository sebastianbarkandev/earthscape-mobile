/**
 * RESP-024 (same methodology as PlayerScreen.rerender.test.tsx): the 2 Hz clock must not
 * re-render chrome that does not show the time. RESP-002 stopped the PAGE from subscribing,
 * but TimelineCard still selected `time.currentUtc` / `currentVideo` just to feed its
 * callbacks and the auto-clip-out effect, so the toolbar (~10 Pressables) and the metadata
 * well (up to ~60 field rows) re-rendered twice a second.
 *
 * What must still work is asserted too: the readout follows the playhead on its own, the
 * toolbar's actions read the CURRENT playhead when pressed, and clipping still auto-closes
 * at the end of the video.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TimelineCard } from '../components/timeline/TimelineCard';
import { ReadoutList } from '../components/timeline/ReadoutList';
import { clipIn, loadEvent, setCurrentTime } from '../playerSlice';
import { appendGraphs, toggleGraph } from '../graphSlice';
import { eventPayload, makeStore, permissions, primaryVideo, START_UTC, type TestStore } from './fixtures';

const mockRenders: Record<string, number> = {};
const mockToolbarProps: Record<string, unknown> = {};

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/common/media', () => ({}));
// the real createClipmark thunk runs; only the HTTP call is stubbed, so the payload it builds
// from the playhead is observable.
jest.mock('../api', () => ({ ...jest.requireActual('../api'), postClipmark: jest.fn(async () => ({ id: 99, time_start: 0, time_end: null, type: 'timepoint', text: 'New Timepoint' })) }));
jest.mock('../components/timeline/TimelineToolbar', () => ({
  TimelineToolbar: (p: Record<string, unknown>) => {
    mockRenders.TimelineToolbar = (mockRenders.TimelineToolbar ?? 0) + 1;
    Object.assign(mockToolbarProps, p);
    return null;
  },
}));
jest.mock('../components/timeline/MetadataWell', () => ({ MetadataWell: () => { mockRenders.MetadataWell = (mockRenders.MetadataWell ?? 0) + 1; return null; } }));
jest.mock('../components/timeline/TimelineCanvas', () => ({ TimelineCanvas: () => { mockRenders.TimelineCanvas = (mockRenders.TimelineCanvas ?? 0) + 1; return null; } }));
jest.mock('../components/timeline/ClipmarkSheet', () => ({ ClipmarkSheet: () => null }));

const { postClipmark } = jest.requireMock('../api') as { postClipmark: jest.Mock };

/** A ready event: the thunks need eventId + activeVideoId, the clip-out needs `duration`. */
const loaded = () => {
  const store = makeStore();
  act(() => { store.dispatch({ type: loadEvent.fulfilled.type, payload: { event: eventPayload().events[0], video: primaryVideo, permissions } }); });
  return store;
};

function renderCard(store: TestStore) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <TimelineCard videoId={6} />
      </Provider>,
    );
  });
  return r;
}
const tick = (store: TestStore, i: number) => act(() => { store.dispatch(setCurrentTime({ video: i * 0.5, utc: START_UTC + i * 0.5 })); });

describe('TimelineCard and the playback clock (RESP-024)', () => {
  it('three timeUpdate ticks re-render neither the toolbar nor the metadata well', () => {
    const store = loaded();
    const r = renderCard(store);
    expect(mockRenders.TimelineToolbar).toBe(1);
    expect(mockRenders.MetadataWell).toBe(1);
    const before = { ...mockRenders };

    for (let i = 1; i <= 3; i++) tick(store, i);

    expect(store.getState().player.time.currentUtc).toBe(START_UTC + 1.5);
    for (const k of ['TimelineToolbar', 'MetadataWell', 'TimelineCanvas']) {
      expect({ child: k, renders: mockRenders[k] }).toEqual({ child: k, renders: before[k] });
    }
    act(() => { r.unmount(); });
  });

  it('the toolbar actions still see the CURRENT playhead (read from the store on press)', () => {
    const store = loaded();
    const r = renderCard(store);
    for (let i = 1; i <= 3; i++) tick(store, i);
    act(() => { (mockToolbarProps.onMark as () => void)(); });
    expect(postClipmark).toHaveBeenCalledWith(primaryVideo.id, expect.objectContaining({ time_start: START_UTC + 1.5, type: 'timepoint' }));
    act(() => { r.unmount(); });
  });

  it('clipping still auto-closes when the video reaches its end', () => {
    // the event carries the duration (300s) the auto-clip-out compares the playhead against
    const store = loaded();
    act(() => { store.dispatch(setCurrentTime({ video: 10, utc: START_UTC + 10 })); });
    act(() => { store.dispatch(clipIn(START_UTC + 10)); });
    const r = renderCard(store);
    expect(store.getState().player.timeline.clipping.mode).toBe('clipIn');
    act(() => { store.dispatch(setCurrentTime({ video: 299.9, utc: START_UTC + 299.9 })); });
    expect(store.getState().player.timeline.clipping.mode).toBe('idle');
    expect(postClipmark).toHaveBeenCalledWith(primaryVideo.id, expect.objectContaining({ type: 'clip', time_start: START_UTC + 10 }));
    act(() => { r.unmount(); });
  });
});

describe('ReadoutList follows the playhead itself', () => {
  it('a tick updates the value without its parent re-rendering', () => {
    const store = makeStore();
    act(() => {
      store.dispatch(appendGraphs({ Aircraft: { Altitude: [[START_UTC, 100], [START_UTC + 1, 900]] } }));
      store.dispatch(toggleGraph({ category: 'Aircraft', name: 'Altitude' }));
      store.dispatch(setCurrentTime({ video: 0, utc: START_UTC }));
    });
    let r!: ReactTestRenderer;
    act(() => { r = create(<Provider store={store}><ReadoutList skimUtc={null} /></Provider>); });
    const value = () => r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.children === 'string' && /^\d/.test(n.props.children)).map((n) => n.props.children as string);
    expect(value()).toContain('100');
    act(() => { store.dispatch(setCurrentTime({ video: 1, utc: START_UTC + 1 })); });
    expect(value()).toContain('900');
    // the skimmer still wins over the playhead while scrubbing
    act(() => { r.update(<Provider store={store}><ReadoutList skimUtc={START_UTC} /></Provider>); });
    expect(value()).toContain('100');
    act(() => { r.unmount(); });
  });
});
