/**
 * FlightMap: reads the playback clock from the store (RESP-002), honours Reduce Motion for
 * camera easing (RESP-008), labels its controls (RESP-009) and re-fits the path when the
 * pane's size changes while free-panning (RESP-015).
 */
import React from 'react';
import { AccessibilityInfo, Pressable, StyleSheet, Text } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { FlightMap } from '../FlightMap';
import { setCurrentTime, setMapFollow } from '../../playerSlice';
import { flightPath, flush, makeStore, START_UTC } from '../../__tests__/fixtures';

const mockFit = jest.fn();
const mockAnimate = jest.fn();

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
// RESP-019: FlightMap reads safe-area insets so its controls clear the landscape cut-out.
// Mutable so the landscape case can be RENDERED, not grepped for (TEST-013).
const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('../MapLayersSheet', () => ({ MapLayersSheet: () => null }));
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((p: { children?: React.ReactNode }, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ fitToCoordinates: mockFit, animateCamera: mockAnimate }));
    return React.createElement(View, { testID: 'MapView' }, p.children);
  });
  const stub = (name: string) => (p: Record<string, unknown>) => React.createElement(View, { testID: name, ...p });
  return { __esModule: true, default: MapView, Marker: stub('Marker'), Polyline: stub('Polyline'), Polygon: stub('Polygon'), Circle: stub('Circle') };
});

afterEach(() => { Object.assign(mockInsets, { top: 0, bottom: 0, left: 0, right: 0 }); });

const host = (id: string) => (n: ReactTestInstance) => typeof n.type === 'string' && n.props.testID === id;
const mapData = { loc: flightPath(60), target: [], footprint: [], acft_hdg: [] as Array<[number, number]> };

async function render(reduceMotion: boolean, props: { trackLabel?: string } = {}) {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(reduceMotion);
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockReturnValue({ remove: jest.fn() } as never);
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <FlightMap mapData={mapData} followLatest={false} {...props} />
      </Provider>,
    );
  });
  await act(async () => { await flush(); });
  return { r, store };
}
const layout = (r: ReactTestRenderer, width: number, height: number) =>
  act(() => { r.root.find(host('flight-map-pane')).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } }); });

describe('FlightMap', () => {
  it('RESP-002: the aircraft marker follows the store clock without any prop from the page', async () => {
    const { r, store } = await render(false);
    expect(r.root.findAll(host('Marker'))).toHaveLength(0); // no clock yet
    act(() => { store.dispatch(setCurrentTime({ video: 10, utc: START_UTC + 10 })); });
    const m = r.root.find(host('Marker'));
    expect(m.props.coordinate.latitude).toBeCloseTo(39.5 + 0.01, 6);
    expect(m.props.coordinate.longitude).toBeCloseTo(-104.9 + 0.01, 6);
    act(() => { store.dispatch(setCurrentTime({ video: 30, utc: START_UTC + 30 })); });
    expect(r.root.find(host('Marker')).props.coordinate.latitude).toBeCloseTo(39.5 + 0.03, 6);
  });

  it('RESP-015: fits once on data, then again only when the pane size changes while free-panning', async () => {
    const { r, store } = await render(false);
    expect(mockFit).toHaveBeenCalledTimes(1); // first flight points
    layout(r, 375, 281);
    const afterFirstLayout = mockFit.mock.calls.length;
    layout(r, 375, 281);
    expect(mockFit).toHaveBeenCalledTimes(afterFirstLayout); // same size: nothing
    layout(r, 812, 343); // rotate
    expect(mockFit).toHaveBeenCalledTimes(afterFirstLayout + 1);
    act(() => { store.dispatch(setMapFollow('vehicle')); });
    layout(r, 375, 281);
    expect(mockFit).toHaveBeenCalledTimes(afterFirstLayout + 1); // following: the camera is owned by follow mode
  });

  it('RESP-008: Reduce Motion → camera moves with duration 0; otherwise 300ms', async () => {
    const a = await render(true);
    act(() => { a.store.dispatch(setCurrentTime({ video: 5, utc: START_UTC + 5 })); });
    act(() => { a.store.dispatch(setMapFollow('vehicle')); });
    expect(mockAnimate).toHaveBeenCalled();
    expect(mockAnimate.mock.calls.at(-1)?.[1]).toEqual({ duration: 0 });

    mockAnimate.mockClear();
    const b = await render(false);
    act(() => { b.store.dispatch(setCurrentTime({ video: 5, utc: START_UTC + 5 })); });
    act(() => { b.store.dispatch(setMapFollow('vehicle')); });
    expect(mockAnimate.mock.calls.at(-1)?.[1]).toEqual({ duration: 300 });
  });

  /**
   * TEST-013: the RESP-019 guard for FlightMap was `expect(src).toMatch(/insets\.right/)` — a
   * file that reads the inset into a variable a refactor stops using passes. Render it instead.
   */
  describe('RESP-019: the overlays clear the landscape cut-out', () => {
    /** The absolutely-positioned box that holds the map controls (parent of "Map layers"). */
    const controlsStyle = (r: ReactTestRenderer) => {
      const btn = r.root.findAllByType(Pressable).find((p) => p.props.accessibilityLabel === 'Map layers')!;
      expect(btn).toBeDefined();
      return StyleSheet.flatten(btn.parent!.props.style) as { position?: string; right?: number };
    };
    /** The track caption box (parent of the caption Text). */
    const trackStyle = (r: ReactTestRenderer, label: string) => {
      const t = r.root.findAllByType(Text).find((n) => n.props.children === label)!;
      expect(t).toBeDefined();
      return StyleSheet.flatten(t.parent!.props.style) as { position?: string; left?: number };
    };

    it('pins the controls and the track caption out of a 59pt inset', async () => {
      Object.assign(mockInsets, { left: 59, right: 59 });
      const { r } = await render(false, { trackLabel: 'Track: N123AB (primary)' });
      const c = controlsStyle(r);
      expect(c.position).toBe('absolute');
      expect(c.right).toBeGreaterThanOrEqual(59);
      const t = trackStyle(r, 'Track: N123AB (primary)');
      expect(t.position).toBe('absolute');
      expect(t.left).toBeGreaterThanOrEqual(59);
    });

    it('portrait keeps the designed 8pt gutter (the inset is a floor, not a replacement)', async () => {
      const { r } = await render(false, { trackLabel: 'Track: N123AB (primary)' });
      expect(controlsStyle(r).right).toBe(8);
      expect(trackStyle(r, 'Track: N123AB (primary)').left).toBe(8);
    });

    it('an asymmetric inset is consumed per side', async () => {
      Object.assign(mockInsets, { left: 0, right: 47 });
      const { r } = await render(false, { trackLabel: 'T' });
      expect(controlsStyle(r).right).toBe(47);
      expect(trackStyle(r, 'T').left).toBe(8);
    });
  });

  it('RESP-009: every map control is a labelled button', async () => {
    const { r } = await render(false);
    const buttons = r.root.findAllByType(Pressable);
    expect(buttons.length).toBeGreaterThanOrEqual(2);
    for (const b of buttons) {
      expect(b.props.accessibilityRole).toBe('button');
      expect(typeof b.props.accessibilityLabel).toBe('string');
      expect(b.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
  });
});
