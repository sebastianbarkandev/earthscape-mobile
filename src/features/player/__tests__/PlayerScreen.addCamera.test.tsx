/**
 * SEC-005 / SEC-017 / SEC-021: "Add my camera" is decided by the PRIMARY video's liveness and
 * the caller's permissions ON THAT PRIMARY (`player.primaryPermissions`), not by the
 * permissions of whichever program tile is being watched. Swapping `primaryPermissions` back to
 * `permissions` on the PlayerScreen (the R2 SEC-017(a) defect) or dropping the extra
 * `GET /videos/{primary}/event_id` in loadEvent makes these tests fail.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerScreen } from '../PlayerScreen';
import { ActionRow } from '../components/ActionRow';
import { loadEvent, selectPrimaryVideo, setPaused } from '../playerSlice';
import { canAddCameraTo } from '@/features/broadcast/liveGates';
import * as api from '../api';
import type { VideoPermissions } from '../api';
import { eventPayload, flush, makeStore, permissions, primaryVideo, secondaryVideo } from './fixtures';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
// One shared router so the ORDER of pause-then-navigate can be asserted (LIVE-020).
const mockRouterPush = jest.fn();
// The screen's focus callback is captured instead of run, so a return from /golive can be replayed.
let focusCb: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, back: jest.fn(), replace: jest.fn() }),
  useFocusEffect: (cb: () => void) => {
    focusCb = cb;
  },
}));
// Publishing IS available here — the permission on the primary must be the deciding factor.
jest.mock('../../../../modules/earthscape-live', () => ({ EarthscapeLive: { isSupported: true } }));
jest.mock('@/common/media', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));
jest.mock('../hooks/useFlightData', () => ({ useFlightData: () => undefined }));
jest.mock('../hooks/useViewingHeartbeat', () => ({ useViewingHeartbeat: () => undefined }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), getEvent: jest.fn(), getVideoPermissions: jest.fn() }));

// Leaves are stubbed; ActionRow keeps its props so the `onAddCamera` wiring can be inspected.
// The handle is real enough to record pause() — LIVE-020 hands the audio route over silent.
const mockPlayerPause = jest.fn();
const mockPlayerPlay = jest.fn();
jest.mock('../components/PlayerVideo', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    PlayerVideo: React.forwardRef((p: { children?: React.ReactNode }, ref: unknown) => {
      React.useImperativeHandle(ref, () => ({ pause: mockPlayerPause, play: mockPlayerPlay, togglePlay: jest.fn() }));
      return React.createElement(View, null, p.children);
    }),
  };
});
jest.mock('../components/PlayerControls', () => ({ PlayerControls: () => null }));
jest.mock('../components/FlightMap', () => ({ FlightMap: () => null }));
jest.mock('../components/ProgramStrip', () => ({ ProgramStrip: () => null }));
jest.mock('../components/ActionRow', () => ({ ActionRow: () => null }));
jest.mock('../components/timeline/TimelineCard', () => ({ TimelineCard: () => null }));
jest.mock('../components/panel/SidePanel', () => ({ SidePanel: () => null }));
jest.mock('../components/info/InfoCard', () => ({ InfoCard: () => null }));
jest.mock('../components/timeline/ClipmarkSheet', () => ({ ClipmarkSheet: () => null }));
jest.mock('../components/share/ShareModal', () => ({ ShareModal: () => null }));

const PRIMARY_ID = 6;
const SECONDARY_ID = 7;
const withUpdate = (update: boolean): VideoPermissions => ({ ...permissions, videos: { ...permissions.videos, update } });
const livePrimary = { ...primaryVideo, live_stream_state: 'live' as const, status: 'live' };
const livePhone = secondaryVideo(SECONDARY_ID, { live_stream_state: 'live', status: 'live', program_type: 'Mobile · Ana' });

/** Mount the page on `hint` with per-video permissions; returns the props ActionRow received last. */
async function renderScreen(perms: Record<number, VideoPermissions>, hint: number | undefined, videos = [livePrimary, livePhone]) {
  (api.getEvent as jest.Mock).mockResolvedValue(eventPayload(videos));
  (api.getVideoPermissions as jest.Mock).mockImplementation(async (id: number) => ({ event_id: 1, video_id: id, permissions: perms[id] }));
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <PlayerScreen eventId="1" videoIdHint={hint} />
      </Provider>,
    );
  });
  await act(async () => { await flush(); });
  expect(store.getState().player.status).toBe('ready');
  const actionRow = r.root.findByType(ActionRow);
  return { store, actionRow, r };
}

beforeEach(() => {
  (api.getEvent as jest.Mock).mockReset();
  (api.getVideoPermissions as jest.Mock).mockReset();
  mockRouterPush.mockClear();
  mockPlayerPause.mockClear();
  mockPlayerPlay.mockClear();
  focusCb = null;
});

describe('PlayerScreen "Add my camera" is gated on the PRIMARY video (SEC-017)', () => {
  it('watching a phone tile the user may edit does NOT offer the action when the primary is read-only', async () => {
    const { store, actionRow } = await renderScreen({ [PRIMARY_ID]: withUpdate(false), [SECONDARY_ID]: withUpdate(true) }, SECONDARY_ID);
    // Both permission sets were fetched: the watched tile's and the primary's (one extra call, SEC-017).
    const asked = (api.getVideoPermissions as jest.Mock).mock.calls.map((c) => c[0]).sort();
    expect(asked).toEqual([PRIMARY_ID, SECONDARY_ID]);
    expect(store.getState().player.permissions?.videos.update).toBe(true);
    expect(store.getState().player.primaryPermissions?.videos.update).toBe(false);
    expect(actionRow.props.onAddCamera).toBeUndefined();
  });

  it('watching a read-only phone tile DOES offer the action when the user may update the primary', async () => {
    const { store, actionRow } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(false) }, SECONDARY_ID);
    expect(store.getState().player.permissions?.videos.update).toBe(false);
    expect(store.getState().player.primaryPermissions?.videos.update).toBe(true);
    expect(typeof actionRow.props.onAddCamera).toBe('function');
  });

  it('watching the primary itself: one permissions call, and UPDATE on it offers the action', async () => {
    const { actionRow } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(false) }, undefined);
    expect(api.getVideoPermissions).toHaveBeenCalledTimes(1);
    expect(api.getVideoPermissions).toHaveBeenCalledWith(PRIMARY_ID);
    expect(typeof actionRow.props.onAddCamera).toBe('function');
  });

  it('a primary that is not live never offers the action, even with UPDATE on it', async () => {
    const { actionRow } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(true) }, SECONDARY_ID, [primaryVideo, livePhone]);
    expect(actionRow.props.onAddCamera).toBeUndefined();
  });

  it('reducer: loadEvent.fulfilled keeps primaryPermissions apart from the watched video permissions (and defaults to them when omitted)', () => {
    const store = makeStore();
    const event = eventPayload([livePrimary, livePhone]).events[0];
    store.dispatch(loadEvent.fulfilled({ event, video: livePhone, permissions: withUpdate(true), primaryPermissions: withUpdate(false) }, 'r', { eventId: 1 }));
    let st = store.getState();
    expect(selectPrimaryVideo(st)?.id).toBe(PRIMARY_ID);
    expect(canAddCameraTo(selectPrimaryVideo(st), st.player.permissions, true)).toBe(true); // the WRONG input would allow it
    expect(canAddCameraTo(selectPrimaryVideo(st), st.player.primaryPermissions, true)).toBe(false);

    store.dispatch(loadEvent.fulfilled({ event, video: livePrimary, permissions: withUpdate(true) }, 'r2', { eventId: 1 }));
    st = store.getState();
    expect(st.player.primaryPermissions).toEqual(withUpdate(true));
  });
});

describe('LIVE-020: taking the microphone silences the viewer\'s player', () => {
  it('"Add my camera" pauses playback BEFORE navigating to the Go Live screen', async () => {
    const { store, actionRow } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(true) }, undefined);
    expect(typeof actionRow.props.onAddCamera).toBe('function');
    await act(async () => { actionRow.props.onAddCamera(); });
    expect(mockPlayerPause).toHaveBeenCalledTimes(1);
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    // Pause first: the publisher opens .playAndRecord/.mixWithOthers as soon as /golive mounts.
    expect(mockPlayerPause.mock.invocationCallOrder[0]).toBeLessThan(mockRouterPush.mock.invocationCallOrder[0]);
    expect(mockRouterPush.mock.calls[0][0].pathname).toBe('/golive');
    // The store mirror agrees, so PlayerControls does not show a play state that is not real.
    expect(store.getState().player.playback.paused).toBe(true);
  });

  it('coming back from the Go Live screen resumes the playback it silenced', async () => {
    const { actionRow } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(true) }, undefined);
    await act(async () => { actionRow.props.onAddCamera(); });
    expect(mockPlayerPlay).not.toHaveBeenCalled();
    // /golive popped -> the screen regains focus and the native module has released the mic.
    expect(typeof focusCb).toBe('function');
    await act(async () => { focusCb!(); });
    expect(mockPlayerPlay).toHaveBeenCalledTimes(1);
    // Only once: a later focus (tab switch, rotation remount of the route) must not auto-play.
    await act(async () => { focusCb!(); });
    expect(mockPlayerPlay).toHaveBeenCalledTimes(1);
  });

  // LIVE-030: two /golive screens share one broadcast slice and the singleton native publisher —
  // dismissing the top one ends the stream under the other — and the second press's closure sees
  // the pause it just dispatched, resetting pausedForMicRef and losing the resume. Removing the
  // guard ref from onAddCamera fails this.
  it('a double tap pushes /golive once and keeps the resume flag', async () => {
    const { r } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(true) }, undefined);
    await act(async () => {
      const add = r.root.findByType(ActionRow).props.onAddCamera;
      add();
      add();
    });
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    expect(mockPlayerPause).toHaveBeenCalledTimes(1);
    // A re-render between the taps (the setPaused(true) dispatch) must not change the outcome.
    await act(async () => { r.root.findByType(ActionRow).props.onAddCamera(); });
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    // Coming back still resumes what the FIRST tap silenced, and re-arms the next tap.
    await act(async () => { focusCb!(); });
    expect(mockPlayerPlay).toHaveBeenCalledTimes(1);
    await act(async () => { r.root.findByType(ActionRow).props.onAddCamera(); });
    expect(mockRouterPush).toHaveBeenCalledTimes(2);
  });

  it('returning without anything to resume still re-arms the guard', async () => {
    const { store, r } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(true) }, undefined);
    await act(async () => { store.dispatch(setPaused(true)); }); // viewer had paused it themselves
    await act(async () => { r.root.findByType(ActionRow).props.onAddCamera(); });
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    await act(async () => { focusCb!(); });
    expect(mockPlayerPlay).not.toHaveBeenCalled();
    await act(async () => { r.root.findByType(ActionRow).props.onAddCamera(); });
    expect(mockRouterPush).toHaveBeenCalledTimes(2);
  });

  it('a player the viewer had already paused is left paused on return', async () => {
    const { store, r } = await renderScreen({ [PRIMARY_ID]: withUpdate(true), [SECONDARY_ID]: withUpdate(true) }, undefined);
    await act(async () => { store.dispatch(setPaused(true)); });
    await act(async () => { r.root.findByType(ActionRow).props.onAddCamera(); });
    expect(mockRouterPush).toHaveBeenCalledTimes(1);
    await act(async () => { focusCb!(); });
    expect(mockPlayerPlay).not.toHaveBeenCalled();
  });
});
