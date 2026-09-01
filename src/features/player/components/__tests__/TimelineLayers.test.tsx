/**
 * UI-016 / UI-025: the playhead / skimmer / AXIS TICK time labels and the clip grips must
 * stay inside the SVG.
 * A live stream keeps the playhead AT the right edge, which is exactly where a
 * start-anchored label used to be clipped away.
 */
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';

// react-native-svg's primitives need a live <Svg> host (native commands) and throw under
// react-test-renderer — stub them as prop-recording Views. Identity is shared with the
// component under test because both import the same mocked module.
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
import { Rect, Text as SvgText } from 'react-native-svg';
// eslint-disable-next-line import/first
import { ClipHandles, Playhead, Skimmer, TICK_FONT_SIZE, TickMarkers } from '../timeline/TimelineLayers';
// eslint-disable-next-line import/first
import { labelWidth } from '../../timeline/geometry';
// eslint-disable-next-line import/first
import { computeTicks } from '../../timeline/tickMarkers';

function render(node: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => { r = create(node); });
  return r;
}
const label = (r: ReactTestRenderer) => r.root.findByType(SvgText).props as { x: number; textAnchor: string };
const rects = (r: ReactTestRenderer) => r.root.findAllByType(Rect).map((n) => n.props as { x: number; width: number });

describe('Playhead label placement', () => {
  it('mid-canvas: label to the right of the line', () => {
    const p = label(render(<Playhead x={100} label="1:23" height={90} width={300} />));
    expect(p.textAnchor).toBe('start');
    expect(p.x).toBeGreaterThan(100);
  });

  it('live (playhead pinned at the right edge): label flips left and stays on canvas', () => {
    const p = label(render(<Playhead x={300} label="12:34:56" height={90} width={300} />));
    expect(p.textAnchor).toBe('end');
    expect(p.x).toBeLessThanOrEqual(300);
    expect(p.x).toBeGreaterThan(0);
  });
});

describe('Skimmer label placement', () => {
  it('scrubbed to the end: label flips left', () => {
    const p = label(render(<Skimmer x={299} label="59:59" height={90} width={300} />));
    expect(p.textAnchor).toBe('end');
    expect(p.x).toBeLessThan(299);
  });
  it('scrubbed to the start: label stays right of the line', () => {
    expect(label(render(<Skimmer x={0} label="0:00" height={90} width={300} />)).textAnchor).toBe('start');
  });
});

describe('ClipHandles', () => {
  it('grips of a clip wider than the window stay fully inside the canvas', () => {
    const r = render(<ClipHandles x1={0} x2={300} height={90} width={300} />);
    for (const g of rects(r)) {
      expect(g.x).toBeGreaterThanOrEqual(0);
      expect(g.x + g.width).toBeLessThanOrEqual(300);
    }
  });
  it('grips inside the window are not moved', () => {
    const r = render(<ClipHandles x1={50} x2={200} height={90} width={300} />);
    expect(rects(r).map((g) => g.x)).toEqual([48, 198]);
  });
});

describe('UI-025 axis tick labels', () => {
  // The dev fixture: video 6 (falls_1.ts, 61s) on a 375pt canvas. The tick ladder puts the
  // last tick at rel=60 -> x = (60/61)*375 = 368.85, and its "0:01:00" is ~42pt wide, so a
  // start-anchored label was drawn from 372.9 to 396.9 — entirely off the canvas.
  const WIDTH = 375;
  const fixture = { start: 0, end: 61, left: 0, right: 61, width: WIDTH, height: 90 };

  it('the fixture really does put a tick within a label width of the right edge', () => {
    const ticks = computeTicks(fixture);
    const last = ticks[ticks.length - 1];
    expect(last.x).toBeGreaterThan(WIDTH - labelWidth(last.label, TICK_FONT_SIZE));
    expect(last.x).toBeLessThanOrEqual(WIDTH);
  });

  it('every tick label is drawn inside the canvas', () => {
    const r = render(<TickMarkers {...fixture} />);
    const labels = r.root.findAllByType(SvgText).map((n) => n.props as { x: number; textAnchor: string; children: string });
    expect(labels.length).toBeGreaterThan(2);
    for (const l of labels) {
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThanOrEqual(WIDTH);
      const w = labelWidth(String(l.children), TICK_FONT_SIZE);
      if (l.textAnchor === 'end') expect(l.x - w).toBeGreaterThanOrEqual(0);
      else expect(l.x + w).toBeLessThanOrEqual(WIDTH);
    }
  });

  it('the right-most label flips to end-anchored instead of vanishing', () => {
    const r = render(<TickMarkers {...fixture} />);
    const labels = r.root.findAllByType(SvgText).map((n) => n.props as { x: number; textAnchor: string; children: string });
    expect(labels[labels.length - 1].textAnchor).toBe('end');
    expect(String(labels[labels.length - 1].children)).toBe('0:01:00');
  });
});
