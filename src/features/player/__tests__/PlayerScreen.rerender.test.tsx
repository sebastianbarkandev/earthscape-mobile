/**
 * RESP-002: the 2 Hz playback clock (setCurrentTime from the native player's timeUpdate)
 * must not re-render the whole page. PlayerScreen does not subscribe to time.currentUtc /
 * time.currentVideo; the leaves that need it (PlayerControls, FlightMap, ProgramStrip,
 * TimelineCard) select it themselves.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { PlayerScreen } from '../PlayerScreen';
import { setCurrentTime } from '../playerSlice';
import * as api from '../api';
import { eventPayload, flush, makeStore, permissions, START_UTC } from './fixtures';

const mockRenders: Record<string, number> = {};

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }), useFocusEffect: () => undefined }));
jest.mock('../../../../modules/earthscape-live', () => ({ EarthscapeLive: { isSupported: false } }));
jest.mock('@/common/media', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 393, height: 852, scale: 3, fontScale: 1 }) }));
jest.mock('../hooks/useFlightData', () => ({ useFlightData: () => undefined }));
jest.mock('../hooks/useViewingHeartbeat', () => ({ useViewingHeartbeat: () => undefined }));
jest.mock('../api', () => ({ ...jest.requireActual('../api'), getEvent: jest.fn(), getVideoPermissions: jest.fn() }));

// Counting stubs: a stub only re-renders when PlayerScreen re-renders and hands it new props.
jest.mock('../components/PlayerVideo', () => {
  const React = require('react');
  const { View } = require('react-native');
  return { PlayerVideo: React.forwardRef((p: { children?: React.ReactNode }, _ref: unknown) => { mockRenders.PlayerVideo = (mockRenders.PlayerVideo ?? 0) + 1; return React.createElement(View, null, p.children); }) };
});
jest.mock('../components/PlayerControls', () => ({ PlayerControls: () => { mockRenders.PlayerControls = (mockRenders.PlayerControls ?? 0) + 1; return null; } }));
jest.mock('../components/FlightMap', () => ({ FlightMap: () => { mockRenders.FlightMap = (mockRenders.FlightMap ?? 0) + 1; return null; } }));
jest.mock('../components/ProgramStrip', () => ({ ProgramStrip: () => { mockRenders.ProgramStrip = (mockRenders.ProgramStrip ?? 0) + 1; return null; } }));
jest.mock('../components/ActionRow', () => ({ ActionRow: () => { mockRenders.ActionRow = (mockRenders.ActionRow ?? 0) + 1; return null; } }));
jest.mock('../components/timeline/TimelineCard', () => ({ TimelineCard: () => { mockRenders.TimelineCard = (mockRenders.TimelineCard ?? 0) + 1; return null; } }));
jest.mock('../components/panel/SidePanel', () => ({ SidePanel: () => { mockRenders.SidePanel = (mockRenders.SidePanel ?? 0) + 1; return null; } }));
jest.mock('../components/info/InfoCard', () => ({ InfoCard: () => { mockRenders.InfoCard = (mockRenders.InfoCard ?? 0) + 1; return null; } }));
jest.mock('../components/timeline/ClipmarkSheet', () => ({ ClipmarkSheet: () => null }));
jest.mock('../components/share/ShareModal', () => ({ ShareModal: () => null }));

const LEAVES = ['PlayerVideo', 'PlayerControls', 'FlightMap', 'ProgramStrip', 'ActionRow', 'TimelineCard', 'SidePanel', 'InfoCard'];

describe('PlayerScreen and the playback clock', () => {
  it('three timeUpdate ticks re-render none of the page children', async () => {
    (api.getEvent as jest.Mock).mockResolvedValue(eventPayload());
    (api.getVideoPermissions as jest.Mock).mockResolvedValue({ event_id: 1, video_id: 6, permissions });
    const store = makeStore();
    let r!: ReactTestRenderer;
    await act(async () => {
      r = create(
        <Provider store={store}>
          <PlayerScreen eventId="1" />
        </Provider>,
      );
    });
    await act(async () => { await flush(); });
    expect(store.getState().player.status).toBe('ready');
    // FlightMap only mounts once flight data exists; the map pane shows the empty state until then.
    for (const k of LEAVES.filter((k) => k !== 'FlightMap')) expect({ leaf: k, mounted: (mockRenders[k] ?? 0) >= 1 }).toEqual({ leaf: k, mounted: true });
    const before = { ...mockRenders };

    for (let i = 1; i <= 3; i++) {
      act(() => { store.dispatch(setCurrentTime({ video: i * 0.5, utc: START_UTC + i * 0.5 })); });
    }
    expect(store.getState().player.time.currentVideo).toBe(1.5);
    for (const k of LEAVES) expect({ leaf: k, renders: mockRenders[k] ?? 0 }).toEqual({ leaf: k, renders: before[k] ?? 0 });
    act(() => { r.unmount(); });
  });
});
