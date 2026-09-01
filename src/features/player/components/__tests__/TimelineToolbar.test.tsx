/** RESP-009 / RESP-005: toolbar buttons are labelled for VoiceOver; pills use minHeight and capped text. */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TimelineToolbar } from '../timeline/TimelineToolbar';

jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));

const noop = () => undefined;
const props = {
  canClip: true,
  tool: 'scrub' as const,
  onToolChange: noop,
  clipInActive: true,
  onMark: noop,
  onClipIn: noop,
  onClipOut: noop,
  onCancelClipIn: noop,
  hasEvents: true,
  onPrev: noop,
  onNext: noop,
  zoomed: true,
  onResetZoom: noop,
  clipmarksVisible: true,
  onToggleClipmarks: noop,
  sensorsAvailable: true,
  sensorVisibility: { 1: true, 2: false, 3: true } as Record<1 | 2 | 3, boolean>,
  onToggleSensor: noop,
  busy: false,
};

describe('TimelineToolbar', () => {
  let r: ReactTestRenderer;
  beforeEach(() => {
    act(() => { r = create(<TimelineToolbar {...props} />); });
  });

  it('every pressable has a role and a non-empty label (icon-only ones included)', () => {
    const ps = r.root.findAllByType(Pressable);
    // Mark, Clip out, Cancel clip in, Scrub, Clip, Prev, Next, Eye, Reset zoom, Sensor 1-3
    expect(ps.length).toBe(12);
    for (const p of ps) {
      expect(['button', 'tab', 'checkbox']).toContain(p.props.accessibilityRole);
      expect(typeof p.props.accessibilityLabel).toBe('string');
      expect(p.props.accessibilityLabel.length).toBeGreaterThan(0);
    }
    const labels = ps.map((p) => p.props.accessibilityLabel);
    expect(labels).toEqual(expect.arrayContaining(['Cancel clip in', 'Previous event', 'Next event', 'Hide events on the timeline', 'Scrub tool', 'Sensor 2']));
    const sensor2 = ps.find((p) => p.props.accessibilityLabel === 'Sensor 2');
    expect(sensor2?.props.accessibilityState).toEqual({ checked: false });
    const scrub = ps.find((p) => p.props.accessibilityLabel === 'Scrub tool');
    expect(scrub?.props.accessibilityState).toEqual({ selected: true });
  });

  it('pills grow with Dynamic Type (minHeight, never height) and their text is capped', () => {
    for (const p of r.root.findAllByType(Pressable)) {
      const s = StyleSheet.flatten(typeof p.props.style === 'function' ? p.props.style({ pressed: false }) : p.props.style) as { height?: number; minHeight?: number };
      expect(s.height).toBeUndefined();
      expect(s.minHeight).toBeGreaterThanOrEqual(26);
    }
    for (const t of r.root.findAllByType(Text)) expect(t.props.maxFontSizeMultiplier).toBeLessThanOrEqual(1.5);
  });
});
