/**
 * UI-020. Two halves: the optional `action` recovery affordance (covered end-to-end by
 * `SearchScreen.error.test.tsx`) and the CENTRED title — a two-line title (long org / video
 * names, or any title at AX text sizes) used to sit left-ragged under a centred icon and a
 * centred detail line. Removing `textAlign: 'center'` from `styles.title` left the whole
 * suite green (TEST-011), because nothing asserted the alignment.
 */
import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { EmptyState } from '../components/EmptyState';

const mounted: ReactTestRenderer[] = [];
afterEach(() => { mounted.splice(0).forEach((r) => act(() => { r.unmount(); })); });

const LONG = 'a very long empty-state title that must wrap onto a second line';

function render(el: React.ReactElement): ReactTestRenderer {
  let r!: ReactTestRenderer;
  act(() => { r = create(el); });
  mounted.push(r);
  return r;
}

/** Flattened style of the `<Text>` whose content is `text`. */
const styleOf = (r: ReactTestRenderer, text: string) => {
  const node = r.root.findAllByType(Text).find((t) => t.props.children === text);
  expect(node).toBeDefined();
  return StyleSheet.flatten(node!.props.style) as Record<string, unknown>;
};

describe('EmptyState (UI-020)', () => {
  it('centres a wrapping title, and the detail line with it', () => {
    const r = render(<EmptyState title={LONG} detail="Try a different search." />);
    expect(styleOf(r, LONG).textAlign).toBe('center');
    expect(styleOf(r, 'Try a different search.').textAlign).toBe('center');
    // Nothing may cap the title to one line — the whole point is that it wraps and stays centred.
    const title = r.root.findAllByType(Text).find((t) => t.props.children === LONG)!;
    expect(title.props.numberOfLines).toBeUndefined();
  });

  it('stays centred in the compact variant and with an action', () => {
    const r = render(<EmptyState title={LONG} detail="d" compact action={{ label: 'Try again', onPress: () => undefined }} />);
    expect(styleOf(r, LONG).textAlign).toBe('center');
    expect(styleOf(r, 'd').textAlign).toBe('center');
  });

  it('offers the recovery affordance and calls it (UI-005)', () => {
    const onPress = jest.fn();
    const r = render(<EmptyState title="Could not load" detail="d" action={{ label: 'Try again', onPress }} />);
    const [btn] = r.root.findAllByType(Pressable).filter((p) => p.props.accessibilityLabel === 'Try again');
    expect(btn).toBeDefined();
    act(() => { btn.props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders no action pressable when none is offered', () => {
    const r = render(<EmptyState title="Nothing here yet" />);
    expect(r.root.findAllByType(Pressable)).toHaveLength(0);
  });
});
