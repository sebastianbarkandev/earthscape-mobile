/**
 * RESP-003 / UI-016 — the canvas must NOT claim every touch. The fix is two lines of
 * PanResponder *wiring* (`onStartShouldSetPanResponder: () => false` and
 * `onMoveShouldSetPanResponder: shouldClaimMove(...)`); `timeline/__tests__/gesture.test.ts`
 * pins the pure helpers only, so setting either line back to `() => true` used to leave the
 * whole suite green (TEST-001). This suite asserts the config object the rendered component
 * actually hands to `PanResponder.create`.
 */
import React from 'react';
import { PanResponder, View, type PanResponderCallbacks, type PanResponderInstance } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const stub = (name: string) => {
    const C = (props: Record<string, unknown>) => React.createElement(View, props);
    C.displayName = name;
    return C;
  };
  return { __esModule: true, default: stub('Svg'), Svg: stub('Svg'), G: stub('G'), Line: stub('Line'), Path: stub('Path'), Polygon: stub('Polygon'), Rect: stub('Rect'), Text: stub('SvgText') };
});

// eslint-disable-next-line import/first
import { TimelineCanvas } from '../timeline/TimelineCanvas';
// eslint-disable-next-line import/first
import { loadEvent, setTimelineTool } from '../../playerSlice';
// eslint-disable-next-line import/first
import { restoreSession } from '@/features/auth/authSlice';
// eslint-disable-next-line import/first
import { GhostBand } from '../timeline/TimelineLayers';
// eslint-disable-next-line import/first
import { eventPayload, makeStore, permissions, primaryVideo, type TestStore } from '../../__tests__/fixtures';

const WIDTH = 400;
const HEIGHT = 64;

/** The gesture-state shape the two `*ShouldSet*` callbacks read. */
const gs = (dx: number, dy: number) => ({ dx, dy, dy0: 0, dx0: 0, moveX: 0, moveY: 0, vx: 0, vy: 0, x0: 0, y0: 0, numberActiveTouches: 1, stateID: 1 }) as never;
const evt = (locationX: number, touches = 1) =>
  ({ nativeEvent: { locationX, locationY: 10, touches: Array.from({ length: touches }, (_, i) => ({ locationX: locationX + i * 40, locationY: 10 })) } }) as never;

const mounted: ReactTestRenderer[] = [];
afterEach(() => { mounted.splice(0).forEach((r) => act(() => { r.unmount(); })); });

const loaded = (): TestStore => {
  const store = makeStore();
  act(() => { store.dispatch({ type: loadEvent.fulfilled.type, payload: { event: eventPayload().events[0], video: primaryVideo, permissions } }); });
  return store;
};

/** Renders the canvas and returns the config it passed to `PanResponder.create`. */
function renderAndCapture(store: TestStore): PanResponderCallbacks {
  const real = PanResponder.create.bind(PanResponder);
  let captured: PanResponderCallbacks | undefined;
  const spy = jest.spyOn(PanResponder, 'create').mockImplementation((cfg): PanResponderInstance => {
    captured = cfg;
    return real(cfg);
  });
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <View>
          <TimelineCanvas videoId={6} height={HEIGHT} onSelectClipmark={() => undefined} onSkimmerChange={() => undefined} />
        </View>
      </Provider>,
    );
  });
  mounted.push(r);
  const surface = r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function' && typeof n.props.onResponderRelease === 'function')[0];
  act(() => { surface.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: WIDTH, height: HEIGHT } } }); });
  spy.mockRestore();
  if (!captured) throw new Error('PanResponder.create was never called — the canvas no longer uses a PanResponder');
  return captured;
}

describe('TimelineCanvas PanResponder wiring (RESP-003 / UI-016)', () => {
  it('never claims the touch on START — the page ScrollView keeps it', () => {
    const cfg = renderAndCapture(loaded());
    expect(typeof cfg.onStartShouldSetPanResponder).toBe('function');
    expect(cfg.onStartShouldSetPanResponder!(evt(100), gs(0, 0))).toBe(false);
    // Two fingers down is still not a START claim (the pinch is claimed on MOVE).
    expect(cfg.onStartShouldSetPanResponder!(evt(100, 2), gs(0, 0))).toBe(false);
    // A capture-phase claim would be even worse than a bubble-phase one.
    expect(cfg.onStartShouldSetPanResponderCapture?.(evt(100), gs(0, 0)) ?? false).toBe(false);
    expect(cfg.onMoveShouldSetPanResponderCapture?.(evt(100), gs(30, 4)) ?? false).toBe(false);
  });

  it('claims a MOVE only when it is horizontal-dominant or has two fingers', () => {
    const cfg = renderAndCapture(loaded());
    const claim = (e: never, g: never) => cfg.onMoveShouldSetPanResponder!(e, g);
    expect(claim(evt(100), gs(4, 30))).toBe(false); // vertical swipe -> page scrolls
    expect(claim(evt(100), gs(20, 25))).toBe(false); // diagonal
    expect(claim(evt(100), gs(2, 0))).toBe(false); // inside the tap slop
    expect(claim(evt(100), gs(30, 4))).toBe(true); // scrub
    expect(claim(evt(100), gs(-30, 4))).toBe(true);
    expect(claim(evt(100, 2), gs(0, 0))).toBe(true); // pinch
  });

  it('a committed scrub refuses termination; an idle canvas releases', () => {
    const cfg = renderAndCapture(loaded());
    expect(cfg.onPanResponderTerminationRequest!(evt(100), gs(0, 0))).toBe(true); // no session yet
    act(() => { cfg.onMoveShouldSetPanResponder!(evt(130), gs(30, 4)); });
    act(() => { cfg.onPanResponderGrant!(evt(130), gs(30, 4)); });
    expect(cfg.onPanResponderTerminationRequest!(evt(130), gs(30, 4))).toBe(false);
    act(() => { cfg.onPanResponderRelease!(evt(130), gs(30, 4)); });
    expect(cfg.onPanResponderTerminationRequest!(evt(130), gs(0, 0))).toBe(true);
  });

  it('the claim records the touch-down x, so a clip drag starts where the finger landed', () => {
    const store = loaded();
    // The clip tool needs a signed-in user (selectCurrentUserId) and tool === 'clip'.
    act(() => {
      store.dispatch({ type: restoreSession.fulfilled.type, payload: { subdomain: 'demo', loggedIn: true, bootstrap: { current_user: { id: 1 } } } });
      store.dispatch(setTimelineTool('clip'));
    });
    const cfg = renderAndCapture(store);
    // Finger down at x=0, dragged 200pt right before the claim landed: the drag must have
    // opened at x=0, not at the claim-time location.
    act(() => { cfg.onMoveShouldSetPanResponder!(evt(200), gs(200, 4)); });
    act(() => { cfg.onPanResponderGrant!(evt(200), gs(200, 4)); });
    const ghost = mounted[mounted.length - 1].root.findAllByType(GhostBand)[0].props as { x1: number; x2: number };
    expect(ghost.x1).toBeCloseTo(0, 3);
    expect(ghost.x2).toBeCloseTo(200, 3);
  });
});
