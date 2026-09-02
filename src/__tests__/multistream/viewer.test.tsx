/**
 * SCENARIO SUITE — the viewer side of the multi-stream requirement:
 * "3+ phones join the same live event as non-primary programs while viewers on other phones
 *  see the primary plus every other live program, can swap which program is primary, and keep
 *  map / flight-data / heartbeat / timeline coherent through joins, departures and permission
 *  changes."
 *
 * The whole page is real (PlayerScreen + playerSlice/graphSlice + useFlightData +
 * useViewingHeartbeat + the 20 s live re-read + ProgramStrip + PlayerVideo). Only native
 * boundaries are faked: `src/common/api/client.ts` (→ ./fakeBackend, whose payloads are traced to
 * the backend serializers) and expo-video (→ ./harness, one player per source so player CHURN is
 * observable). Timeline / side panel / info card / action row are stubbed: they are owned by other
 * agents right now and none of them is what these scenarios are about.
 *
 * Scenarios: 1 fan-in (B, C, D join at t+5/40/95 s) · 2 swap to program C · 3 departures
 * (C ends while D is live, then the PRIMARY ends while B and D are live).
 */
import React from 'react';
import { Image, Pressable, Text } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { Provider } from 'react-redux';
import { PlayerScreen } from '@/features/player/PlayerScreen';
import { MAX_TILE_PLAYERS } from '@/features/player/programs';
import { extentOf } from '@/features/player/timeline/liveExtent';
import { EVENT_ID, PRIMARY_VIDEO_ID, T0, installFakeBackend, type FakeBackend } from './fakeBackend';
import { advance, makeSignedInStore, playersFor, resetVideoPlayers, settle, videoPlayers, type FakePlayer, type ScenarioStore } from './harness';

jest.mock('@/common/api/client', () => {
  const actual = jest.requireActual('@/common/api/client');
  return { ...actual, api: (path: string, opts?: unknown) => require('./fakeBackend').dispatchFakeApi(path, opts) };
});
jest.mock('expo-video', () => require('./harness').expoVideoMock());
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }), useFocusEffect: () => undefined }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));
jest.mock('../../../modules/earthscape-live', () => ({ EarthscapeLive: { isSupported: true } }));
// The map is a native surface; capture what the page hands it instead (mapData / trackLabel).
const mockFlightMapProps: Array<{ mapData: { loc: unknown[]; firstUtc: number | null; lastUtc: number | null }; trackLabel: string | null }> = [];
jest.mock('@/features/player/components/FlightMap', () => ({
  FlightMap: (props: { mapData: { loc: unknown[]; firstUtc: number | null; lastUtc: number | null }; trackLabel: string | null }) => {
    mockFlightMapProps.push(props);
    return null;
  },
}));
jest.mock('@/features/player/components/PlayerControls', () => ({ PlayerControls: () => null }));
jest.mock('@/features/player/components/ActionRow', () => ({ ActionRow: () => null }));
jest.mock('@/features/player/components/timeline/TimelineCard', () => ({ TimelineCard: () => null }));
jest.mock('@/features/player/components/panel/SidePanel', () => ({ SidePanel: () => null }));
jest.mock('@/features/player/components/info/InfoCard', () => ({ InfoCard: () => null }));
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));

const LIVE_REFRESH_MS = 20_000; // PlayerScreen's "any program live" event re-read
const EVENT_ROUTE = `GET /api/v1/events/${EVENT_ID}.json`;

let backend: FakeBackend;
let store: ScenarioStore;
let renderer: ReactTestRenderer | null = null;

async function renderViewer(): Promise<void> {
  store = makeSignedInStore();
  await act(async () => {
    renderer = create(
      <Provider store={store}>
        <PlayerScreen eventId={String(EVENT_ID)} />
      </Provider>,
    );
  });
  await settle();
  expect(store.getState().player.status).toBe('ready');
}

const root = (): ReactTestInstance => (renderer as ReactTestRenderer).root;
/** Program tiles are the only Pressables labelled "Show <program>". */
const tiles = () =>
  root()
    .findAllByType(Pressable)
    .filter((n) => typeof n.props.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show '));
const tileLabels = () => tiles().map((t) => String(t.props.accessibilityLabel).replace('Show ', ''));
const tileTexts = () =>
  root()
    .findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')));
const tapTile = async (label: string) => {
  const tile = tiles().find((t) => t.props.accessibilityLabel === `Show ${label}`);
  if (!tile) throw new Error(`no tile "${label}" (have: ${tileLabels().join(', ')})`);
  await act(async () => {
    tile.props.onPress();
  });
  await settle();
};
/** Tile players are keyed by their live playlist URL, so identity survives re-renders. */
const tilePlayer = (liveStreamId: number): FakePlayer[] => playersFor(`/live/${liveStreamId}/playlist.m3u8`);

beforeEach(() => {
  jest.useFakeTimers();
  resetVideoPlayers();
  mockFlightMapProps.length = 0;
  backend = installFakeBackend();
  backend.pushPoints(PRIMARY_VIDEO_ID, 30); // the aircraft has 30 s of track before anyone joins
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  if (renderer) act(() => (renderer as ReactTestRenderer).unmount());
  renderer = null;
  jest.useRealTimers();
});

describe('scenario 1 — fan-in: three phones join the same live event while a viewer watches', () => {
  it('shows every joining program, live-first, in a stable order, with only MAX_TILE_PLAYERS decoding', async () => {
    await renderViewer();
    // One live primary: no strip at all (nothing to show beside it).
    expect(tiles()).toHaveLength(0);
    expect(store.getState().player.isLive).toBe(true);

    // t+5s — phone B joins (its own device did POST /live/streams {event_id}); the viewer only
    // learns about it through the 20 s non-destructive re-read.
    await advance(5_000);
    const b = backend.joinProgram('Mobile · Ben');
    expect(tiles()).toHaveLength(0); // not yet — no refresh has happened
    await advance(LIVE_REFRESH_MS);
    expect(tileLabels()).toEqual(['Mobile · Ben']);
    expect(tilePlayer(b.live_stream_id as number)).toHaveLength(1);
    const playerB = tilePlayer(b.live_stream_id as number)[0];

    // t+40s — phone C joins.
    await advance(15_000);
    const c = backend.joinProgram('Mobile · Cy');
    await advance(LIVE_REFRESH_MS);
    expect(tileLabels()).toEqual(['Mobile · Ben', 'Mobile · Cy']);
    const playerC = tilePlayer(c.live_stream_id as number)[0];
    expect(playerC).toBeDefined();
    // B's tile was NOT rebuilt by the refresh that added C.
    expect(tilePlayer(b.live_stream_id as number)).toEqual([playerB]);

    // t+95s — phone D joins: over the decode cap, so it is a static tile (still tappable).
    await advance(35_000);
    const d = backend.joinProgram('Mobile · Dee');
    await advance(LIVE_REFRESH_MS);
    expect(tileLabels()).toEqual(['Mobile · Ben', 'Mobile · Cy', 'Mobile · Dee']);
    expect(tilePlayer(d.live_stream_id as number)).toHaveLength(0);
    // Its thumbnail is the backend's double-prefixed live URL, which 404s (LIVE-023) — the tile
    // then explains itself instead of being a black rectangle.
    const thumb = root().findAllByType(Image);
    expect(thumb).toHaveLength(1);
    await act(async () => {
      thumb[0].props.onError();
    });
    expect(tileTexts()).toContain('Tap to watch');
    // Exactly 2 tile players + the 1 main player of the primary.
    expect(videoPlayers).toHaveLength(MAX_TILE_PLAYERS + 1);
    expect(tilePlayer(b.live_stream_id as number)).toEqual([playerB]);
    expect(tilePlayer(c.live_stream_id as number)).toEqual([playerC]);

    // Three further re-reads with an unchanged roster: same order, same player objects (no churn).
    await advance(3 * LIVE_REFRESH_MS);
    expect(tileLabels()).toEqual(['Mobile · Ben', 'Mobile · Cy', 'Mobile · Dee']);
    expect(videoPlayers).toHaveLength(MAX_TILE_PLAYERS + 1);
    expect(tilePlayer(b.live_stream_id as number)[0]).toBe(playerB);
    expect(tilePlayer(c.live_stream_id as number)[0]).toBe(playerC);
  });

  it('the fan-in never disturbs the primary: same player, same playhead, one heartbeat target, growing track', async () => {
    await renderViewer();
    const mainPlayer = videoPlayers[0];
    // Native clock ticks (2 Hz timeUpdate) drive the store's UTC through the TimeMapper.
    await act(async () => {
      mainPlayer.emit('timeUpdate', { currentTime: 12 });
    });
    expect(store.getState().player.time.currentUtc).toBe(T0 + 12);

    backend.joinProgram('Mobile · Ben');
    backend.joinProgram('Mobile · Cy');
    backend.pushPoints(PRIMARY_VIDEO_ID, 10); // the aircraft keeps flying
    await advance(LIVE_REFRESH_MS);

    const st = store.getState().player;
    expect(st.activeVideoId).toBe(PRIMARY_VIDEO_ID);
    expect(st.time.currentUtc).toBe(T0 + 12); // the re-read is non-destructive
    expect(videoPlayers[0]).toBe(mainPlayer); // the primary's AVPlayer was never rebuilt
    expect(mainPlayer.replaced).toEqual([]);
    // Incremental flight data: 30 + 10 points, no duplicates from the ?after= loop.
    expect(st.mapData.loc).toHaveLength(40);
    expect(st.mapData.firstUtc).toBe(T0);
    expect(st.mapData.lastUtc).toBe(T0 + 39);
    const utcs = st.mapData.loc.map(([utc]) => utc);
    expect(new Set(utcs).size).toBe(40);
    // Heartbeat only ever targets the ACTIVE video.
    const viewing = backend.calls.filter((c) => c.route.endsWith('/viewing'));
    expect(new Set(viewing.map((c) => c.route))).toEqual(new Set([`/api/v1/videos/${PRIMARY_VIDEO_ID}/viewing`]));
    expect(viewing.length).toBeGreaterThanOrEqual(4); // 5 s cadence over 20 s
    // The map got the primary's own track, unlabelled (no LIVE-003 caveat while the primary is active).
    expect(mockFlightMapProps[mockFlightMapProps.length - 1].trackLabel).toBeNull();
  });
});

describe('scenario 2 — the viewer swaps to program C', () => {
  it('moves the active video, heartbeat, flight fetch, permissions and map label, and resets the track', async () => {
    await renderViewer();
    const b = backend.joinProgram('Mobile · Ben');
    const c = backend.joinProgram('Mobile · Cy');
    backend.pushPoints(c.id, 12); // C's phone has published 12 s of its own GPS track
    backend.joinProgram('Mobile · Dee');
    // C is watchable but read-only for this viewer (ACL orgs grant per uploader).
    backend.setPermissions(c.id, { update: false });
    await advance(LIVE_REFRESH_MS);
    expect(store.getState().player.permissions?.videos.update).toBe(true); // primary's
    backend.clearCalls();

    await tapTile('Mobile · Cy');

    const st = store.getState().player;
    expect(st.activeVideoId).toBe(c.id);
    expect(st.isLive).toBe(true);
    // Per-video permissions followed the swap (and the primary's are kept for "Add my camera").
    expect(backend.countRoute(`GET /api/v1/videos/${c.id}/event_id`)).toBe(1);
    expect(st.permissions?.videos.update).toBe(false);
    expect(st.primaryPermissions?.videos.update).toBe(true);
    // The map/graph series belonged to the previous program: dropped, then refetched for C from
    // scratch. The FIRST request for C carries no `?after=` — proof the store's lastUtc was reset
    // rather than the new program's points being appended to the old program's track — and asks
    // for C's OWN points (`?own=1`): a phone has a track of its own (LIVE-003 fix).
    const cFlight = backend.calls.filter((x) => x.route === `/api/v1/videos/${c.id}/flight_data.json`);
    expect(cFlight.length).toBeGreaterThanOrEqual(1);
    expect(cFlight[0].query.after).toBeUndefined();
    expect(cFlight[0].query.own).toBe('1');
    expect(st.mapData.loc).toHaveLength(12); // C's own 12 points, NOT the primary's 30 (nor 42 concatenated)
    expect(st.mapData.firstUtc).toBe(T0);
    expect(store.getState().graph.data.KLV.Altitude).toHaveLength(12);
    // The track IS the phone's own now, so no "this is the primary's track" caption.
    expect(mockFlightMapProps[mockFlightMapProps.length - 1].trackLabel).toBeNull();

    // Heartbeat retargets: only C is reported from here on.
    backend.clearCalls();
    await advance(10_000);
    const viewing = backend.calls.filter((x) => x.route.endsWith('/viewing')).map((x) => x.route);
    expect(viewing.length).toBeGreaterThanOrEqual(1);
    expect(new Set(viewing)).toEqual(new Set([`/api/v1/videos/${c.id}/viewing`]));
    // The primary's tile is now in the strip (and B is still a player, D still capped).
    expect(tileLabels()).toEqual(['Flight 12', 'Mobile · Ben', 'Mobile · Dee']);
    expect(tilePlayer(b.live_stream_id as number)).toHaveLength(1);
  });

  it('the timeline extent of the live program is usable (LIVE-022) instead of a 1-second ruler', async () => {
    await renderViewer();
    const c = backend.joinProgram('Mobile · Cy');
    await advance(LIVE_REFRESH_MS);
    await tapTile('Mobile · Cy');

    const p = store.getState().player;
    // A live Video has end/duration NULL; the extent must still span at least LIVE_MIN_WINDOW_SEC
    // and reach the live edge fed by the flight-data poll.
    expect(p.time.start).toBe(c.start);
    expect(p.time.duration).toBeNull();
    const extent = extentOf(p);
    expect(extent.start).toBe(T0);
    expect(extent.duration).toBeGreaterThanOrEqual(120);
    expect(extent.end).toBeGreaterThanOrEqual((p.mapData.lastUtc ?? 0));
  });
});

describe('scenario 3 — departures: programs end at arbitrary times', () => {
  it('C ends while D is live: its tile becomes a placeholder, no player is rebuilt, D is promoted to the freed decoder', async () => {
    await renderViewer();
    const b = backend.joinProgram('Mobile · Ben');
    const c = backend.joinProgram('Mobile · Cy');
    const d = backend.joinProgram('Mobile · Dee');
    await advance(LIVE_REFRESH_MS);
    const playerB = tilePlayer(b.live_stream_id as number)[0];
    const playerC = tilePlayer(c.live_stream_id as number)[0];
    expect(playerC).toBeDefined();
    expect(tilePlayer(d.live_stream_id as number)).toHaveLength(0); // over the cap while C is live

    backend.endProgram(c.id); // C's phone hit End (LiveStream ending/ended, no hls_stream yet)
    await advance(LIVE_REFRESH_MS);

    expect(store.getState().player.videos.find((v) => v.id === c.id)?.live_stream_state).toBe('processing');
    expect(tileLabels()).toEqual(['Mobile · Ben', 'Mobile · Dee', 'Mobile · Cy']); // live first, then the processing one
    expect(tileTexts()).toContain('Processing…');
    // No player for the dead playlist, and the surviving live tiles were not rebuilt.
    expect(tilePlayer(c.live_stream_id as number)).toEqual([playerC]); // the old instance, unmounted, never recreated
    expect(tilePlayer(b.live_stream_id as number)).toEqual([playerB]);
    expect(tilePlayer(d.live_stream_id as number)).toHaveLength(1); // D now decodes
    expect(store.getState().player.activeVideoId).toBe(PRIMARY_VIDEO_ID);
  });

  it('the PRIMARY ends while B and D are live: the viewer keeps a working page, the flip is handled once, and the poll stops when nothing is live', async () => {
    await renderViewer();
    backend.joinProgram('Mobile · Ben');
    backend.joinProgram('Mobile · Dee');
    await advance(LIVE_REFRESH_MS);
    const mainPlayer = videoPlayers[0];
    expect(store.getState().player.isLive).toBe(true);

    backend.endProgram(PRIMARY_VIDEO_ID);
    await advance(10_000); // the 5 s heartbeat reports the flip before the 20 s re-read is due

    const st = store.getState().player;
    expect(st.status).toBe('ready');
    expect(st.activeVideoId).toBe(PRIMARY_VIDEO_ID); // the active program survives the flip
    expect(st.isLive).toBe(false);
    expect(st.videos.find((v) => v.id === PRIMARY_VIDEO_ID)?.live_stream_state).toBe('processing');
    // `processing` keeps pointing at the (now dead) live playlist, so the source — and the player —
    // must not be swapped out from under the viewer.
    expect(videoPlayers[0]).toBe(mainPlayer);
    expect(st.mapData.loc).toHaveLength(30); // the track is not wiped by the transition
    // `time.end` still collapses to `start` here — a processing Video has duration NULL and
    // playerSlice reports the payload as it is — but that is no longer the timeline's extent:
    // LIVE-027 made `liveEdgeOf` keep the ROLLING live window whenever `duration` is falsy
    // (see timeline/liveExtent.ts + liveWindow.test.ts), so the ruler survives the transcode
    // window instead of snapping to one second. This asserts the slice's raw value only:
    expect(st.time.end).toBe(st.time.start);

    // Two programs are still live -> the 20 s event re-read is still running.
    backend.clearCalls();
    await advance(2 * LIVE_REFRESH_MS);
    expect(backend.countRoute(EVENT_ROUTE)).toBeGreaterThanOrEqual(2);

    // Now every program ends: the periodic re-read must stop (the heartbeat keeps running).
    backend.endProgram(store.getState().player.videos[1].id);
    backend.endProgram(store.getState().player.videos[2].id);
    await advance(2 * LIVE_REFRESH_MS);
    expect(store.getState().player.videos.every((v) => v.live_stream_state !== 'live')).toBe(true);
    backend.clearCalls();
    await advance(3 * LIVE_REFRESH_MS);
    expect(backend.countRoute(EVENT_ROUTE)).toBe(0);
    expect(backend.countRoute(`POST /api/v1/videos/${PRIMARY_VIDEO_ID}/viewing`)).toBeGreaterThanOrEqual(6);
    // And no flight-data polling either: nothing is live any more.
    expect(backend.countRoute(`GET /api/v1/videos/${PRIMARY_VIDEO_ID}/flight_data.json`)).toBe(0);
  });

  it('a program that vanishes from the payload entirely is dropped without touching the active one', async () => {
    await renderViewer();
    const b = backend.joinProgram('Mobile · Ben');
    const c = backend.joinProgram('Mobile · Cy');
    await advance(LIVE_REFRESH_MS);
    await tapTile('Mobile · Cy');
    expect(store.getState().player.activeVideoId).toBe(c.id);

    backend.removeProgram(b.id);
    backend.removeProgram(c.id); // the ACTIVE one disappears (deleted / ACL change)
    await advance(LIVE_REFRESH_MS);

    const st = store.getState().player;
    expect(st.videos.map((v) => v.id)).toEqual([PRIMARY_VIDEO_ID, c.id]); // active kept, B dropped
    expect(st.activeVideoId).toBe(c.id);
    expect(tileLabels()).toEqual(['Flight 12']);
  });
});
