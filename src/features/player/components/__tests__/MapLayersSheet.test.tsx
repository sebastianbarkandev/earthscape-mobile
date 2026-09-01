/**
 * REG-003: `BottomSheet` caps the card at 0.88 x window height and anchors it to the bottom
 * edge. This sheet's content is 393-531pt (8-12 rows plus the Done button), a landscape iPhone
 * window is ~393pt -> 346pt of card, and its children are `minHeight` boxes that cannot shrink.
 * Without a scroll region the overlay toggles and Done are BELOW the screen edge and untappable
 * — the target-heatmap toggle became unreachable in landscape entirely.
 */
import React from 'react';
import { Pressable, ScrollView, Switch, Text } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MapLayersSheet } from '../MapLayersSheet';
import { makeStore } from '../../__tests__/fixtures';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 21, left: 59, right: 59 }) }));
// Landscape iPhone: 852 x 393 -> the sheet has 346pt to render 393pt+ of content.
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({ __esModule: true, default: () => ({ width: 852, height: 393, scale: 3, fontScale: 1 }) }));

function render() {
  const store = makeStore();
  let r!: ReactTestRenderer;
  act(() => {
    r = create(
      <Provider store={store}>
        <MapLayersSheet visible onClose={() => undefined} hasTarget hasDrawings />
      </Provider>,
    );
  });
  return r;
}

describe('MapLayersSheet in a short (landscape) window', () => {
  it('puts every row and the Done button inside a scroll region', () => {
    const r = render();
    const scrolls = r.root.findAllByType(ScrollView);
    expect(scrolls).toHaveLength(1);
    const scroll = scrolls[0];
    // The overlay switches (target heatmap included) and Done all live inside it, so the pt cap
    // scrolls them into reach instead of clipping them off-screen.
    expect(scroll.findAllByType(Switch).length).toBeGreaterThanOrEqual(5);
    const done = scroll.findAll((n) => n.type === Pressable && n.findAll((c) => c.type === Text && c.props.children === 'Done').length > 0);
    expect(done).toHaveLength(1);
    act(() => r.unmount());
  });
});
