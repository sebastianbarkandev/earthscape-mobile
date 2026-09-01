/**
 * Geometry of the Go Live overlay chrome. Pure, because the screen itself needs a camera,
 * a native module and a device to look at.
 */

/** Top bar: `paddingTop: insets.top + PAD_TOP`, a ROW_H tall row, then GAP before the banner. */
export const TOP_BAR = { padTop: 6, rowH: 36, gap: 8 } as const;

/**
 * Top of the "Adding your camera to: …" banner (UI-018). It used to be a hardcoded
 * `top: 96`, which sits INSIDE the top bar on any device with a Dynamic Island
 * (insets.top 59 + 6 + 36 = 101 > 96) — the banner covered the status pill and the close
 * button. Derive it from the same insets the bar uses instead.
 */
export function bannerTop(insets: { top: number }): number {
  const top = Number.isFinite(insets.top) ? Math.max(0, insets.top) : 0;
  return top + TOP_BAR.padTop + TOP_BAR.rowH + TOP_BAR.gap;
}

/**
 * Placement of the absolutely-positioned bottom bar (UI-001). With the keyboard up, the bar
 * sits directly on top of it (the home indicator is irrelevant then — the keyboard covers
 * that strip); otherwise it clears the home indicator as before.
 */
export function bottomBarInset(keyboardHeight: number, insetsBottom: number): { bottom: number; paddingBottom: number } {
  const kb = Number.isFinite(keyboardHeight) ? Math.max(0, keyboardHeight) : 0;
  const inset = Number.isFinite(insetsBottom) ? Math.max(0, insetsBottom) : 0;
  return kb > 0 ? { bottom: kb, paddingBottom: 12 } : { bottom: 0, paddingBottom: inset + 12 };
}

/**
 * Smallest the bottom block may be squeezed to — below this the settings scroller is not
 * usable at all, so the block is allowed to reach a little way under the top bar instead.
 */
export const BOTTOM_BLOCK_MIN_H = 140;

/**
 * RESP-026: the bottom block is `position: absolute` and grows UPWARD from
 * `bottom: keyboardHeight`. With the settings open in landscape (~249pt on a 15/16, ~278pt on
 * an SE where the hint and the GPS label wrap) and the keyboard up (~162-205pt) the block was
 * taller than the room left, so its TOP — the camera-name field, the one setting the join flow
 * exists to set — left the screen (393 - 162 - 249 = -18pt) and nothing scrolled.
 *
 * This is the room the block actually has: the window minus the keyboard minus the top bar it
 * must not slide under (the same arithmetic `bannerTop` uses). The screen puts it on the block
 * as `maxHeight` and makes the settings subtree a ScrollView with `flexShrink: 1`, so the
 * controls row and the Go live / Join live button stay pinned and the settings scroll.
 */
export function bottomBlockMaxHeight(o: { height: number; keyboardHeight: number; insetsTop: number }): number {
  const h = Number.isFinite(o.height) && o.height > 0 ? o.height : 0;
  const kb = Number.isFinite(o.keyboardHeight) ? Math.max(0, o.keyboardHeight) : 0;
  const top = Number.isFinite(o.insetsTop) ? Math.max(0, o.insetsTop) : 0;
  const chrome = top + TOP_BAR.padTop + TOP_BAR.rowH + TOP_BAR.gap;
  return Math.max(BOTTOM_BLOCK_MIN_H, Math.round(h - kb - chrome));
}
