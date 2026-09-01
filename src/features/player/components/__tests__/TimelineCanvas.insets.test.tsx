/**
 * RESP-025 — the timeline scrub surface is the one region drawn deliberately edge-to-edge
 * (`wrap: { width: '100%' }`, SVG x = 0…width), so in landscape its t=start / t=end ends sat
 * under the rounded corner and the sensor housing. The page now insets everything below the
 * viewport (PlayerScreen `player-content`); this suite pins the part that could have gone
 * wrong: the canvas measures ITSELF, so the time<->x mapping must follow the narrower
 * surface — a tap at the right edge of a 734pt canvas is t=end, not 734/852 of the way in.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 21, left: 59, right: 59 }) }));
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
import Svg from 'react-native-svg';
// eslint-disable-next-line import/first
import { TimelineCanvas } from '../timeline/TimelineCanvas';
// eslint-disable-next-line import/first
import { loadEvent } from '../../playerSlice';
// eslint-disable-next-line import/first
import { edgePadding } from '@/common/layout';
// eslint-disable-next-line import/first
import { eventPayload, makeStore, permissions, primaryVideo, type TestStore } from '../../__tests__/fixtures';

const LANDSCAPE_W = 852;
const INSET = 59;
/** What the padded page hands the canvas in landscape. */
const CANVAS_W = LANDSCAPE_W - 2 * INSET;

const loaded = (): TestStore => {
  const store = makeStore();
  act(() => { store.dispatch({ type: loadEvent.fulfilled.type, payload: { event: eventPayload().events[0], video: primaryVideo, permissions } }); });
  return store;
};

/** The canvas's measured surface: the View that carries `onLayout` + the pan handlers. */
const surface = (r: ReactTestRenderer): ReactTestInstance =>
  r.root.findAll((n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function' && typeof n.props.onResponderRelease === 'function')[0];

function renderCanvas(store: TestStore) {
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        {/* Exactly what PlayerScreen's `player-content` wrapper does in landscape. */}
        <View style={edgePadding({ left: INSET, right: INSET }, 0)}>
          <TimelineCanvas videoId={6} height={64} onSelectClipmark={() => undefined} onSkimmerChange={() => undefined} />
        </View>
      </Provider>,
    );
  });
  act(() => {
    surface(r).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: CANVAS_W, height: 64 } } });
  });
  return r;
}

describe('TimelineCanvas geometry follows the inset surface (RESP-025)', () => {
  it('draws at the measured width, not the window width', () => {
    const store = loaded();
    const r = renderCanvas(store);
    const svg = r.root.findAllByType(Svg)[0].props as { width: number; height: number };
    expect(svg.width).toBe(CANVAS_W);
    expect(svg.width).toBeLessThan(LANDSCAPE_W);
    act(() => { r.unmount(); });
  });

  it('a tap at the right edge of the inset surface is t=end (the mapping is not skewed)', () => {
    const store = loaded();
    const r = renderCanvas(store);
    const press = r.root.findAllByType(Pressable).filter((n) => n.props.accessibilityLabel === 'Timeline')[0];
    expect(press).toBeDefined();

    act(() => { press.props.onPress({ nativeEvent: { locationX: CANVAS_W } }); });
    // primaryVideo: start = START_UTC, duration 300s, no time_mapping -> utc->video is identity.
    expect(store.getState().player.seek?.videoTime).toBeCloseTo(300, 3);

    // Half way across the SURFACE is half way through the video — the old edge-to-edge canvas
    // would have put t=150 at x=426 (half the WINDOW), i.e. 59pt of the track was unreachable.
    act(() => { press.props.onPress({ nativeEvent: { locationX: CANVAS_W / 2 } }); });
    expect(store.getState().player.seek?.videoTime).toBeCloseTo(150, 3);
    act(() => { r.unmount(); });
  });
});
