/**
 * SCENARIO 8 — ground ↔ air on the Go Live screen.
 *
 * Real `useAircraftTrack` + `AirLinkOverlay` against the fake API: the aircraft tail is read
 * from `now - 90 s` and then only its tail, teammates' tracks are asked for with `?own=1`
 * (LIVE-003: without it the backend would hand back the PRIMARY's points for every program),
 * this phone is hidden from the teammates, the event is re-read every 20 s so joiners/leavers
 * show up, a 403 backs off and re-reads the event, and the overlay's frame chip / arrows /
 * nearby-aircraft suggestion follow the phone's GPS fix and compass.
 */
import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { useAircraftTrack, type AircraftTrack } from '@/features/broadcast/airlink/useAircraftTrack';
import { AirLinkOverlay } from '@/features/broadcast/airlink/AirLinkOverlay';
import { poseSource } from '@/features/broadcast/pose/poseSource';
import { theme } from '@/common/theme';
import { EVENT_ID, PRIMARY_VIDEO_ID, T0, installFakeBackend, type FakeBackend } from './fakeBackend';
import { advance, settle } from './harness';

jest.mock('@/common/api/client', () => {
  const actual = jest.requireActual('@/common/api/client');
  return { ...actual, api: (path: string, opts?: unknown) => require('./fakeBackend').dispatchFakeApi(path, opts) };
});
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((p: { children?: React.ReactNode }, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ fitToCoordinates: () => undefined, animateCamera: () => undefined }));
    return React.createElement(View, { testID: 'MapView' }, p.children);
  });
  const stub = (name: string) => (p: Record<string, unknown>) => React.createElement(View, { testID: name, ...p });
  return { __esModule: true, default: MapView, Marker: stub('Marker'), Polyline: stub('Polyline'), Polygon: stub('Polygon'), Circle: stub('Circle') };
});
// No CoreMotion in the test: poseSource falls back to the compass (expo-location heading watch).
jest.mock('../../../modules/earthscape-pose', () => ({
  EarthscapePose: { isSupported: false, setCamera: () => undefined, start: async () => undefined, stop: async () => undefined },
  addPoseListener: () => ({ remove: () => undefined }),
  isPoseError: (e: { error?: unknown }) => typeof e.error === 'string',
}));

type PositionCb = (loc: { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number }) => void;
type HeadingCb = (h: { trueHeading: number; magHeading: number; accuracy: number }) => void;
const locState: { granted: boolean; positions: PositionCb[]; headings: HeadingCb[] } = { granted: false, positions: [], headings: [] };
jest.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getForegroundPermissionsAsync: async () => ({ granted: locState.granted, status: locState.granted ? 'granted' : 'denied' }),
  watchPositionAsync: async (_o: unknown, cb: PositionCb) => {
    locState.positions.push(cb);
    return { remove: () => locState.positions.splice(locState.positions.indexOf(cb), 1) };
  },
  watchHeadingAsync: async (cb: HeadingCb) => {
    locState.headings.push(cb);
    return { remove: () => locState.headings.splice(locState.headings.indexOf(cb), 1) };
  },
}));

const NOW_S = T0 + 200;
let backend: FakeBackend;
let renderer: ReactTestRenderer | null = null;
let tracks: AircraftTrack[];

function Probe({ eventId, own, enabled }: { eventId?: number; own: number | null; enabled?: boolean }) {
  tracks.push(useAircraftTrack(eventId, own, enabled));
  return null;
}
const latest = () => tracks[tracks.length - 1];

function mount(el: React.ReactElement) {
  act(() => {
    if (renderer) renderer.update(el);
    else renderer = create(el);
  });
}
const host = (id: string) => (n: ReactTestInstance) => typeof n.type === 'string' && n.props.testID === id;
/** Tap a Pressable by testID (the composite carries onPress; its host View only has responder props). */
const press = (id: string) =>
  act(() => {
    (renderer as ReactTestRenderer).root.findAll((n) => n.props.testID === id && typeof n.props.onPress === 'function')[0].props.onPress();
  });
const texts = () =>
  (renderer as ReactTestRenderer).root
    .findAll((n) => typeof n.type === 'string' && n.type === 'Text')
    .map((n) => React.Children.toArray(n.props.children).join(''));
const flightCalls = (videoId: number) => backend.calls.filter((c) => c.route === `/api/v1/videos/${videoId}/flight_data.json`);

const setPosition = (lat: number, lon: number) =>
  act(() => {
    locState.positions.forEach((cb) => cb({ coords: { latitude: lat, longitude: lon, accuracy: 5 }, timestamp: Date.now() }));
  });
const setHeading = (deg: number, accuracy = 3) =>
  act(() => {
    locState.headings.forEach((cb) => cb({ trueHeading: deg, magHeading: deg, accuracy }));
  });

// The aircraft's camera looks at a block around [39.70, -105.10]; its own track ends near there.
const TARGET: [number, number] = [39.7, -105.1];
const FOOTPRINT: [number, number][] = [
  [39.695, -105.105],
  [39.695, -105.095],
  [39.705, -105.095],
  [39.705, -105.105],
];

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW_S * 1000);
  backend = installFakeBackend();
  backend.pushPoints(PRIMARY_VIDEO_ID, 100, T0 + 100); // T0+100 .. T0+199, the newest 1 s ago
  tracks = [];
  locState.granted = false;
  locState.positions.length = 0;
  locState.headings.length = 0;
  poseSource._reset();
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  if (renderer) act(() => (renderer as ReactTestRenderer).unmount());
  renderer = null;
  jest.useRealTimers();
});

describe('scenario 8a — useAircraftTrack', () => {
  it('reads the aircraft tail from now-90s, teammates with ?own=1, hides this phone, then polls only the tail', async () => {
    const mate = backend.joinProgram('Mobile · Sam');
    const mine = backend.joinProgram('Mobile · Ana');
    backend.pushPoints(mate.id, 5, T0 + 190);
    backend.pushPoints(mine.id, 5, T0 + 190);

    mount(<Probe eventId={EVENT_ID} own={mine.id} />);
    await settle(12);

    const t = latest();
    expect(t.status).toBe('ready');
    expect(t.primary).toEqual({ id: PRIMARY_VIDEO_ID, title: 'Flight 12', live: true });
    expect(t.aircraft?.utc).toBe(T0 + 199);
    expect(t.aircraft?.loc[0]).toBeCloseTo(39.5 + 0.199, 6);
    expect(t.aircraft?.heading).toBe(90);
    expect(t.aircraft?.footprint).toBeNull();
    expect(t.teammates.map((m) => m.videoId)).toEqual([mate.id]);
    expect(t.teammates[0].label).toBe('Mobile · Sam');
    expect(t.teammates[0].fix?.utc).toBe(T0 + 194);

    // The aircraft: no ?own (it IS the primary), 90 s window. The teammate: ?own=1.
    expect(flightCalls(PRIMARY_VIDEO_ID)[0].query).toEqual({ after: String(NOW_S - 90) });
    expect(flightCalls(mate.id)[0].query).toEqual({ after: String(NOW_S - 90), own: '1' });
    expect(flightCalls(mine.id)).toHaveLength(0);

    backend.clearCalls();
    backend.pushPoints(PRIMARY_VIDEO_ID, 3); // T0+200..202
    await advance(5_000);
    expect(flightCalls(PRIMARY_VIDEO_ID)[0].query.after).toBe(String(T0 + 199));
    expect(flightCalls(mate.id)[0].query).toEqual({ after: String(T0 + 194), own: '1' });
    expect(latest().aircraft?.utc).toBe(T0 + 202);
    expect(backend.countRoute(`GET /api/v1/events/${EVENT_ID}.json`)).toBe(0); // not before 20 s
  });

  it('re-reads the event every 20 s so joiners appear and leavers vanish', async () => {
    mount(<Probe eventId={EVENT_ID} own={null} />);
    await settle(12);
    expect(latest().teammates).toEqual([]);

    const mate = backend.joinProgram('Mobile · Sam');
    await advance(20_000);
    expect(backend.countRoute(`GET /api/v1/events/${EVENT_ID}.json`)).toBe(2);
    expect(latest().teammates.map((m) => m.videoId)).toEqual([mate.id]);
    expect(flightCalls(mate.id).length).toBeGreaterThan(0);

    backend.endProgram(mate.id);
    await advance(20_000);
    expect(latest().teammates).toEqual([]);
  });

  it('a 403 (permission flip mid-transition) surfaces as an error, backs off 15 s and re-reads the event first', async () => {
    backend.flightForbidden = true;
    mount(<Probe eventId={EVENT_ID} own={null} />);
    await settle(12);
    expect(latest().status).toBe('error');
    expect(latest().aircraft).toBeNull();
    expect(flightCalls(PRIMARY_VIDEO_ID)).toHaveLength(1);

    backend.flightForbidden = false;
    backend.clearCalls();
    await advance(10_000);
    expect(flightCalls(PRIMARY_VIDEO_ID)).toHaveLength(0); // still backing off
    await advance(5_500);
    expect(backend.routes('GET')[0]).toBe(`/api/v1/events/${EVENT_ID}.json`);
    expect(latest().status).toBe('ready');
    expect(latest().aircraft?.utc).toBe(T0 + 199);
  });

  it('stops asking when disabled or unmounted', async () => {
    mount(<Probe eventId={EVENT_ID} own={null} />);
    await settle(12);
    mount(<Probe eventId={EVENT_ID} own={null} enabled={false} />);
    expect(latest().status).toBe('idle');
    backend.clearCalls();
    await advance(30_000);
    expect(backend.calls).toHaveLength(0);
  });
});

describe('scenario 8b — AirLinkOverlay', () => {
  const overlay = (over: Partial<React.ComponentProps<typeof AirLinkOverlay>> = {}) => (
    <AirLinkOverlay eventId={EVENT_ID} ownVideoId={null} telemetryEnabled={false} visible top={80} sideInsets={{ paddingLeft: 12, paddingRight: 12 }} landscape={false} {...over} />
  );

  it('frame chip: GPS off → in frame → arrow follows the compass → out of frame; the map shows footprint, target, aircraft, me', async () => {
    backend.setSensor(PRIMARY_VIDEO_ID, { target: TARGET, footprint: FOOTPRINT });
    mount(overlay());
    await settle(12);
    expect(texts()).toContain('Turn on GPS to check the frame');
    expect(locState.positions).toHaveLength(0); // never prompts, never watches without a grant
    expect(locState.headings).toHaveLength(1); // the compass hold, shared with telemetry

    // Location granted via the telemetry toggle → the overlay re-checks and starts watching.
    locState.granted = true;
    mount(overlay({ telemetryEnabled: true }));
    await settle(6);
    expect(locState.positions).toHaveLength(1);
    setPosition(39.701, -105.1); // ~110 m north of the target, inside the footprint
    await settle(2);
    const r = renderer as ReactTestRenderer;
    expect(texts()).toContain("You're in frame");
    expect(r.root.find(host('airlink-frame')).props.style).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: theme.success })]));
    // No heading yet: absolute compass points instead of arrows.
    expect(r.root.findAll(host('airlink-target-arrow'))).toHaveLength(0);
    expect(r.root.find(host('airlink-target')).props.accessibilityLabel).toBe('Target 111 m S');
    expect(r.root.find(host('airlink-aircraft')).props.accessibilityLabel).toMatch(/^Aircraft \d+(\.\d)? k?m /);

    // Facing east, the target (due south) is a 90° turn to the right.
    setHeading(90);
    await settle(2);
    expect(r.root.find(host('airlink-target-arrow')).props.style.transform).toEqual([{ rotate: '90deg' }]);

    // Poor compass → calibration hint; good again → gone.
    setHeading(90, 0);
    await settle(2);
    expect(texts().some((s) => s.includes('Compass needs calibration'))).toBe(true);
    setHeading(90, 3);
    await settle(2);
    expect(texts().some((s) => s.includes('Compass needs calibration'))).toBe(false);

    setPosition(39.72, -105.1); // north, outside the footprint
    await settle(2);
    expect(texts()).toContain('Out of frame');

    // Expand: the mini map draws the footprint, the aircraft→target sight line and the markers.
    press('airlink-summary');
    expect(r.root.findAll(host('Polygon'))).toHaveLength(1);
    expect(r.root.find(host('Polygon')).props.coordinates).toHaveLength(4);
    expect(r.root.findAll(host('Polyline'))).toHaveLength(1);
    expect(r.root.findAll(host('Marker'))).toHaveLength(3); // target, aircraft, me
    press('airlink-summary');
    expect(r.root.findAll(host('airlink-map'))).toHaveLength(0);
  });

  it('without sensor metadata the chip says so, and a stale aircraft is flagged with its age', async () => {
    locState.granted = true;
    mount(overlay({ telemetryEnabled: true }));
    await settle(12);
    setPosition(39.701, -105.1);
    await settle(2);
    expect(texts()).toContain('No camera footprint yet');
    expect(texts().some((s) => s.startsWith('Aircraft position'))).toBe(false);

    await advance(30_000); // no new points: the newest is now 31 s old
    expect(texts().some((s) => /^Aircraft position 3\d s old/.test(s))).toBe(true);
  });

  it('hidden from the teammates once this phone has its own video id; the count shows the others', async () => {
    const mate = backend.joinProgram('Mobile · Sam');
    const mine = backend.joinProgram('Mobile · Ana');
    backend.pushPoints(mate.id, 3, T0 + 195);
    mount(overlay({ ownVideoId: mine.id }));
    await settle(12);
    expect(texts()).toContain('1');
    press('airlink-summary');
    const mates = (renderer as ReactTestRenderer).root.findAll(host('Marker')).filter((m) => m.props.title);
    expect(mates.map((m) => m.props.title)).toEqual(['Mobile · Sam']);
  });

  it('with no event to join it suggests the nearest streaming aircraft and joins it on tap', async () => {
    const onJoin = jest.fn();
    locState.granted = true;
    mount(overlay({ eventId: undefined, telemetryEnabled: true, onJoinNearby: onJoin }));
    await settle(12);
    expect((renderer as ReactTestRenderer).root.findAll(host('airlink-nearby'))).toHaveLength(0); // no position yet
    setPosition(39.71, -105.1); // ~1.2 km north of the aircraft's newest point
    await settle(12);
    expect(backend.countRoute('GET /api/v1/live/list')).toBe(1);
    expect(flightCalls(PRIMARY_VIDEO_ID)[0].query).toEqual({ after: String(NOW_S - 90) });
    expect((renderer as ReactTestRenderer).root.findAll(host('airlink-nearby'))).toHaveLength(1);
    expect(texts().some((s) => /^Flight 12 is streaming 1\.\d km S of you$/.test(s))).toBe(true);
    press('airlink-join');
    expect(onJoin).toHaveBeenCalledWith(EVENT_ID, 'Flight 12');
  });

  it('far from every aircraft (or with none live) nothing is suggested', async () => {
    locState.granted = true;
    mount(overlay({ eventId: undefined, telemetryEnabled: true, onJoinNearby: jest.fn() }));
    await settle(12);
    setPosition(45.0, -105.1); // ~590 km away
    await settle(12);
    expect((renderer as ReactTestRenderer).root.findAll(host('airlink-nearby'))).toHaveLength(0);
  });
});
