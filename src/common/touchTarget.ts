/**
 * Touch-target policy (UI-007). Apple's HIG floor is 44×44pt; the player chrome, the
 * timeline toolbar and every chip row are drawn much denser than that (11–36pt boxes) to
 * match the web's information density. The visual box stays dense — the TOUCHABLE box is
 * grown back to 44pt with `hitSlop`, computed from the box instead of guessed per site.
 *
 * Every `hitSlop` in the app must come from here: `src/common/__tests__/touchTarget.test.ts`
 * re-derives each Pressable's box from its StyleSheet entry (or its icon size) and fails
 * when box + 2·slop < MIN_TOUCH.
 */
export const MIN_TOUCH = 44;

/** Slop, in pt per side, that grows a `box`-pt control to the 44pt minimum. */
export function touchSlop(box: number): number {
  if (!Number.isFinite(box) || box <= 0) return Math.ceil(MIN_TOUCH / 2);
  return Math.max(0, Math.ceil((MIN_TOUCH - box) / 2));
}

/** The touchable size a control ends up with — what the guard test asserts against. */
export function effectiveTouchSize(box: number, slop: number): number {
  return (Number.isFinite(box) ? box : 0) + 2 * (Number.isFinite(slop) ? slop : 0);
}

/** A per-side `hitSlop`, the object form RN accepts. */
export interface SlopBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Slop that grows `box` to 44pt TALL and nothing more (UI-024).
 *
 * RN hit-tests `[sortedSubviews reverseObjectEnumerator]` and takes the FIRST hit
 * (RCTView.m), so wherever two siblings' slop-inflated frames overlap the one written LATER
 * in JSX wins — a symmetric slop in a dense row (`gap: 2`) silently steals its neighbour's
 * taps. In a row the height is the scarce axis, so grow only that.
 */
export function verticalTouchSlop(box: number): SlopBox {
  const v = touchSlop(box);
  return { top: v, bottom: v, left: 0, right: 0 };
}

/** One control laid out along a single axis, with the slop it adds on each side. */
export interface TouchSpan {
  name: string;
  /** Leading edge of the visible box, in container content coordinates. */
  offset: number;
  box: number;
  /** Slop before the box. */
  before: number;
  /** Slop after the box. */
  after: number;
}

/** The interval RN actually hit-tests for a span: `[offset - before, offset + box + after]`. */
export function touchInterval(s: TouchSpan): [number, number] {
  return [s.offset - s.before, s.offset + s.box + s.after];
}

/**
 * Lay siblings out end-to-end the way a flex row/column with `gap` does, so their touch
 * intervals can be compared. `margin` is the child's own margin on that axis (added on both
 * sides of the child, as RN does).
 */
export function layoutTouchSpans(
  items: Array<{ name: string; box: number; before?: number; after?: number; margin?: number; /** Overrides `gap` for this item only (a flex spacer sits in between). */ gapBefore?: number }>,
  gap = 0,
): TouchSpan[] {
  let cursor = 0;
  const out: TouchSpan[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const margin = it.margin ?? 0;
    if (i > 0) cursor += it.gapBefore ?? gap;
    cursor += margin;
    out.push({ name: it.name, offset: cursor, box: it.box, before: it.before ?? 0, after: it.after ?? 0 });
    cursor += it.box + margin;
  }
  return out;
}

/**
 * Pairs of spans whose hit intervals genuinely overlap (a shared edge is not an overlap —
 * a zero-area intersection cannot steal a press). `overlap` is in pt.
 */
export function overlappingTouchSpans(spans: TouchSpan[]): Array<{ a: string; b: string; overlap: number }> {
  const out: Array<{ a: string; b: string; overlap: number }> = [];
  for (let i = 0; i < spans.length; i++) {
    for (let j = i + 1; j < spans.length; j++) {
      const [aMin, aMax] = touchInterval(spans[i]);
      const [bMin, bMax] = touchInterval(spans[j]);
      const overlap = Math.min(aMax, bMax) - Math.max(aMin, bMin);
      if (overlap > 0) out.push({ a: spans[i].name, b: spans[j].name, overlap });
    }
  }
  return out;
}
