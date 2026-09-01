import React, { createContext, forwardRef, useCallback, useContext, useMemo, useState } from 'react';
import { Animated, StyleSheet, type LayoutChangeEvent, type View } from 'react-native';

/**
 * RESP-018 — a sticky header whose PINNING can be switched off without changing the element
 * type at the ScrollView's sticky slot.
 *
 * `stickyHeaderIndices` must NEVER be toggled on a ScrollView whose sticky child hosts native
 * state: RN wraps the sticky child in `ScrollViewStickyHeader` (ScrollView.js:1662-1687), so
 * flipping the prop swaps a host `View` for that wrapper at the same slot — different type,
 * same key → React deletes the fiber and mounts a fresh subtree. For the player that means a
 * brand-new AVPlayer (playing from t=0) and a re-created MapView on every rotation.
 *
 * So `PlayerScreen` keeps `stickyHeaderIndices={[0]}` constant and passes this component as
 * `StickyHeaderComponent`; it reads `StickyEnabledContext` and simply stops translating with
 * the scroll offset when pinning is unwanted (landscape, where the viewport already fills the
 * visible height and must be allowed to scroll away). The rendered tree is the same in both
 * modes, so the viewport subtree — video player and map — is never remounted.
 */
export const StickyEnabledContext = createContext<boolean>(true);

/** The subset of RN's sticky-header contract we need (see ScrollView.js:1671-1683). */
interface PinnedHeaderProps {
  children?: React.ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
  scrollAnimatedValue?: Animated.Value;
}

export const PinnedHeader = forwardRef<View, PinnedHeaderProps>(function PinnedHeader(props, ref) {
  const sticky = useContext(StickyEnabledContext);
  const [layoutY, setLayoutY] = useState(0);

  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const y = event.nativeEvent.layout.y;
      setLayoutY((prev) => (prev === y ? prev : y));
      props.onLayout?.(event);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onLayout],
  );

  const scrollValue = props.scrollAnimatedValue;
  // translateY = max(0, scrollY - layoutY): the header rides the scroll once it reaches the top.
  const translateY = useMemo<Animated.AnimatedInterpolation<number> | number>(() => {
    if (!sticky || !scrollValue) return 0;
    const inputRange = layoutY > 0 ? [-1, 0, layoutY, layoutY + 1] : [-1, 0, 1];
    const outputRange = layoutY > 0 ? [0, 0, 0, 1] : [0, 0, 1];
    return scrollValue.interpolate({ inputRange, outputRange });
  }, [sticky, scrollValue, layoutY]);

  return (
    <Animated.View
      ref={ref}
      collapsable={false}
      testID={sticky ? 'viewport-pinned' : 'viewport-unpinned'}
      onLayout={onLayout}
      style={[sticky && styles.pinned, { transform: [{ translateY }] }]}
    >
      {props.children}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  // Only a pinned header has to stack above the content that scrolls under it.
  pinned: { zIndex: 10 },
});
