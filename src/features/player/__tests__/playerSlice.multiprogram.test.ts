import { configureStore } from '@reduxjs/toolkit';
import playerReducer, {
  appendFlightData,
  loadEvent,
  mergeClipmarks,
  mergeEventVideos,
  refreshEvent,
  selectActiveVideo,
  selectAnyLive,
  selectPrimaryVideo,
  selectProgram,
  setActiveVideo,
  setCurrentTime,
  setZoom,
  upsertClipmark,
} from '../playerSlice';
import graphReducer, { appendGraphs } from '../graphSlice';
import * as api from '../api';
import type { Clipmark, VideoPermissions } from '../api';
import { eventPayload, flightData, primary, s1, s2, s3, s4, T0 } from './multiprogramFixtures';

jest.mock('../api', () => ({ ...jest.requireActual('../api'), getVideoPermissions: jest.fn() }));

const makeStore = () => configureStore({ reducer: { player: playerReducer, graph: graphReducer } });
type Store = ReturnType<typeof makeStore>;

const perms = (update: boolean): VideoPermissions => ({
  videos: { update, delete: update, download: true, share: true, suggest_deletion: update, draw: false },
  tags: { create: false, delete: false },
});

function loaded(permissions: VideoPermissions | null = null): Store {
  const store = makeStore();
  const event = eventPayload([primary, s1, s2, s3]);
  store.dispatch(loadEvent.fulfilled({ event, video: primary, permissions }, 'r', { eventId: 7 }));
  return store;
}

describe('multi-program event: 1 primary + 3 live phones', () => {
  it('loads the primary as active with a mapper per program', () => {
    const st = loaded().getState();
    expect(st.player.status).toBe('ready');
    expect(st.player.activeVideoId).toBe(primary.id);
    expect(Object.keys(st.player.timeMappers).map(Number).sort()).toEqual([100, 201, 202, 203]);
    expect(st.player.isLive).toBe(false);
    expect(selectAnyLive(st)).toBe(true);
    expect(selectPrimaryVideo(st)?.id).toBe(primary.id);
  });

  it('refreshEvent is non-destructive: merges a 4th program without touching status/map/time/graphs', () => {
    const store = loaded();
    store.dispatch(appendFlightData(flightData(T0, 10)));
    store.dispatch(appendGraphs(flightData(T0, 10).graphs));
    store.dispatch(setCurrentTime({ video: 42, utc: T0 + 42 }));
    store.dispatch(setZoom({ zoom: 3, center: 0.5 } as never));
    const before = store.getState();

    store.dispatch(refreshEvent.pending('r2', { eventId: 7 }));
    expect(store.getState().player.status).toBe('ready');

    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, s1, s2, s3, s4]) }, 'r2', { eventId: 7 }));
    const after = store.getState();
    expect(after.player.status).toBe('ready');
    expect(after.player.videos.map((v) => v.id)).toEqual([100, 201, 202, 203, 204]);
    expect(after.player.activeVideoId).toBe(primary.id);
    expect(after.player.mapData.loc).toHaveLength(10);
    expect(after.player.mapData.lastUtc).toBe(T0 + 9);
    expect(after.player.time).toEqual(before.player.time);
    expect(after.player.time.currentUtc).toBe(T0 + 42);
    expect(after.player.timeline).toEqual(before.player.timeline);
    expect(after.graph.data).toEqual(before.graph.data);
    expect(after.player.timeMappers[204]).toBeDefined();
  });

  it('refreshEvent drops a program that ended and vanished, but never the active one', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s2.id));
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, s1]) }, 'r', { eventId: 7 }));
    expect(store.getState().player.videos.map((v) => v.id)).toEqual([100, 201, 202]);
    expect(selectActiveVideo(store.getState())?.id).toBe(s2.id);
  });

  it('refreshEvent flips the active program live -> processing without resetting the playhead or map', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    store.dispatch(appendFlightData(flightData(T0, 5)));
    store.dispatch(setCurrentTime({ video: 30, utc: T0 + 30 }));
    expect(store.getState().player.isLive).toBe(true);
    const ended = { ...s1, live_stream_state: 'processing' as const, duration: 120, end: T0 + 120 };
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, ended, s2, s3]) }, 'r', { eventId: 7 }));
    const p = store.getState().player;
    expect(p.isLive).toBe(false);
    expect(p.time.currentUtc).toBe(T0 + 30);
    expect(p.time.duration).toBe(120);
    expect(p.time.end).toBe(T0 + 120);
    expect(p.mapData.loc).toHaveLength(5);
    expect(selectActiveVideo(store.getState())?.live_stream_state).toBe('processing');
  });

  it('refreshEvent ignores a stale response for another event or before the first load', () => {
    const store = loaded();
    store.dispatch(refreshEvent.fulfilled({ event: { ...eventPayload([s4]), id: 99 } }, 'r', { eventId: 99 }));
    expect(store.getState().player.videos).toHaveLength(4);
    const fresh = makeStore();
    fresh.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary]) }, 'r', { eventId: 7 }));
    expect(fresh.getState().player.status).toBe('idle');
    expect(fresh.getState().player.videos).toHaveLength(0);
  });

  it('setActiveVideo swaps to a live phone: live state, range, clipmarks, and drops the old track + graphs', () => {
    const store = loaded();
    store.dispatch(appendFlightData(flightData(T0, 10)));
    store.dispatch(appendGraphs(flightData(T0, 10).graphs));
    store.dispatch(setActiveVideo(s2.id));
    const st = store.getState();
    expect(st.player.activeVideoId).toBe(s2.id);
    expect(st.player.isLive).toBe(true);
    expect(st.player.time.start).toBe(s2.start);
    expect(st.player.clipmarks.map((c) => c.id)).toEqual([202]);
    expect(st.player.mapData.loc).toHaveLength(0);
    expect(st.player.mapData.lastUtc).toBeNull();
    expect(st.graph.data).toEqual({});
    // Heartbeat + flight loop target the ACTIVE video.
    expect(selectActiveVideo(st)?.id).toBe(s2.id);
    // Swapping back concatenates nothing stale.
    store.dispatch(setActiveVideo(primary.id));
    expect(store.getState().player.mapData.loc).toHaveLength(0);
  });

  it('mergeEventVideos keeps order, replaces changed, appends new, drops vanished non-active', () => {
    const changed = { ...s1, title: 'renamed' };
    const out = mergeEventVideos([primary, s1, s2], [changed, primary, s3], s2.id);
    expect(out.map((v) => v.id)).toEqual([100, 201, 202, 203]);
    expect(out[1].title).toBe('renamed');
    expect(mergeEventVideos([primary, s1], [primary], primary.id).map((v) => v.id)).toEqual([100]);
  });
});

describe('LIVE-017: permissions are per program, not per event', () => {
  it('setActiveVideo fails closed — the previous program permissions are dropped, primaryPermissions kept', () => {
    const store = loaded(perms(true));
    expect(store.getState().player.permissions?.videos.update).toBe(true);
    store.dispatch(setActiveVideo(s2.id));
    const st = store.getState().player;
    expect(st.permissions).toBeNull();
    expect(st.primaryPermissions?.videos.update).toBe(true);
  });

  it('selectProgram swaps the tile and re-reads permissions for THAT video only', async () => {
    (api.getVideoPermissions as jest.Mock).mockImplementation(async (id: number) => ({
      event_id: 7,
      video_id: id,
      permissions: perms(id !== s2.id),
    }));
    const store = loaded(perms(true));
    await store.dispatch(selectProgram(s2.id));
    const st = store.getState().player;
    expect(api.getVideoPermissions).toHaveBeenCalledTimes(1);
    expect(api.getVideoPermissions).toHaveBeenCalledWith(s2.id);
    expect(st.activeVideoId).toBe(s2.id);
    expect(st.permissions?.videos.update).toBe(false);
    // "Add my camera" still asks about the PRIMARY (SEC-017).
    expect(st.primaryPermissions?.videos.update).toBe(true);
  });

  it('a permissions read that fails leaves the UI closed', async () => {
    (api.getVideoPermissions as jest.Mock).mockRejectedValue(new Error('403'));
    const store = loaded(perms(true));
    await store.dispatch(selectProgram(s3.id));
    expect(store.getState().player.permissions).toBeNull();
    expect(store.getState().player.activeVideoId).toBe(s3.id);
  });

  it('a late answer for a tile the viewer already left is ignored', async () => {
    let release!: () => void;
    (api.getVideoPermissions as jest.Mock).mockImplementation((id: number) => {
      if (id === s2.id) {
        return new Promise((res) => {
          release = () => res({ event_id: 7, video_id: id, permissions: perms(true) });
        });
      }
      return Promise.resolve({ event_id: 7, video_id: id, permissions: perms(false) });
    });
    const store = loaded(perms(true));
    const slow = store.dispatch(selectProgram(s2.id));
    await store.dispatch(selectProgram(s3.id));
    release();
    await slow;
    const st = store.getState().player;
    expect(st.activeVideoId).toBe(s3.id);
    expect(st.permissions?.videos.update).toBe(false);
  });
});

describe('LIVE-018: clipmarks keep arriving while a program is live', () => {
  const chat = (id: number, at: number): Clipmark => ({ id, type: 'tak_chat', text: `chat ${id}`, time_start: at, time_end: null });

  it('refreshEvent merges rows created elsewhere without touching timeline / map / time', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    store.dispatch(appendFlightData(flightData(T0, 5)));
    store.dispatch(setCurrentTime({ video: 30, utc: T0 + 30 }));
    store.dispatch(setZoom({ zoom: 3, center: 0.5 } as never));
    const before = store.getState();
    expect(before.player.clipmarks.map((c) => c.id)).toEqual([201]);

    const grown = { ...s1, clipmarks: [...(s1.clipmarks ?? []), chat(900, T0 + 40)] };
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, grown, s2, s3]) }, 'r2', { eventId: 7 }));
    const after = store.getState().player;
    expect(after.clipmarks.map((c) => c.id)).toEqual([201, 900]);
    expect(after.timeline).toEqual(before.player.timeline);
    expect(after.time).toEqual(before.player.time);
    expect(after.mapData.loc).toHaveLength(5);
    expect(after.activeVideoId).toBe(s1.id);
  });

  it('drops a row deleted server-side but keeps one created locally after the GET went out', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    store.dispatch(upsertClipmark(chat(500, T0 + 60))); // local optimistic row (highest id)
    const stale = { ...s1, clipmarks: [chat(210, T0 + 20)] }; // 201 deleted, 210 added, 500 not seen yet
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, stale, s2, s3]) }, 'r', { eventId: 7 }));
    expect(store.getState().player.clipmarks.map((c) => c.id)).toEqual([210, 500]);
  });

  it('an unchanged payload keeps the SAME array reference (no 20s timeline re-render)', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s1.id));
    const first = store.getState().player.clipmarks;
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, { ...s1 }, s2, s3]) }, 'r', { eventId: 7 }));
    expect(store.getState().player.clipmarks).toBe(first);
  });

  it('activate_marker system rows never reach the timeline, and a text edit does land', () => {
    const store = loaded();
    store.dispatch(setActiveVideo(s2.id));
    const edited: Clipmark = { ...(s2.clipmarks ?? [])[0], text: 'edited elsewhere' };
    const system = { id: 777, type: 'timepoint', text: '', time_start: T0, time_end: null, the_json: { data: { name: 'activate_marker' } } } as unknown as Clipmark;
    store.dispatch(refreshEvent.fulfilled({ event: eventPayload([primary, s1, { ...s2, clipmarks: [edited, system] }, s3]) }, 'r', { eventId: 7 }));
    const rows = store.getState().player.clipmarks;
    expect(rows.map((c) => c.id)).toEqual([202]);
    expect(rows[0].text).toBe('edited elsewhere');
  });

  it('mergeClipmarks: empty payload is authoritative', () => {
    expect(mergeClipmarks([chat(1, T0)], [])).toEqual([]);
  });
});
