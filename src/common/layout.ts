/**
 * Grid column policy for the Library / Live / Search FlatLists (RESP-011).
 * Phones keep 2 columns; iPad and iPad landscape get 3–4 so cards stay ~240–340pt wide
 * instead of 500–680pt; iPad Split View (320pt) still gets 2.
 * RN needs `key={cols}` on the FlatList to remount when numColumns changes.
 */
export const GRID_MIN_COLS = 2;
export const GRID_MAX_COLS = 4;
export const GRID_TARGET_CARD_W = 240;

export function gridColumns(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return GRID_MIN_COLS;
  return Math.max(GRID_MIN_COLS, Math.min(GRID_MAX_COLS, Math.floor(windowWidth / GRID_TARGET_CARD_W)));
}

/**
 * Width cap for one grid cell (UI-003). A grid card is `flex: 1` so cards share a row
 * evenly, but flex only distributes between the children that are PRESENT: a last row with
 * a single card (a library page ending on an odd item, or one live stream) stretched that
 * card across the whole row and blew its 16:9 thumbnail up to full width. Capping at
 * 100/cols % costs nothing on a full row (each child already gets less than its share once
 * margins are removed) and pins the lone card to one column's width.
 */
export function gridItemMaxWidth(cols: number = GRID_MIN_COLS): `${number}%` {
  const n = Number.isFinite(cols) && cols >= 1 ? Math.floor(cols) : GRID_MIN_COLS;
  return `${100 / n}%`;
}

/**
 * NOTE: no current caller — the transcript's nested FlatList was replaced by a windowed,
 * non-scrolling list (UI-002). Kept for the next virtualized list that needs it.
 *
 * FlatList `scrollToIndex` fails for rows outside the rendered window when rows have
 * variable heights and no getItemLayout (RESP-017). Estimate an offset from the average
 * measured row so the list jumps near the target; the caller retries scrollToIndex once
 * the rows around it are rendered.
 */
export function scrollToIndexFallbackOffset(info: { index: number; averageItemLength: number }): number {
  const avg = Number.isFinite(info.averageItemLength) && info.averageItemLength > 0 ? info.averageItemLength : 0;
  return Math.max(0, Math.floor(info.index) * avg);
}
/** Delay before the retry — long enough for the window to render around the new offset. */
export const SCROLL_TO_INDEX_RETRY_MS = 80;

/**
 * RESP-019: horizontal safe-area padding for app-drawn chrome that sits at the screen edge.
 * `orientation: "default"` means every iPhone screen can be landscape, where iOS reports
 * `insets.left/right ≈ 47–59pt` (Dynamic Island side + rounded corners): anything pinned to
 * x = 0 / x = width there is clipped and partly untappable. Portrait insets are 0, so the
 * `min` fallback keeps the normal spacing.
 * NOTE: a pane that does not span the full width (the video half of landscape split view)
 * gets the inset on its inner edge too — extra breathing room, never a clipped control.
 */
export function edgePadding(
  insets: { left?: number; right?: number },
  min: number = 8,
): { paddingLeft: number; paddingRight: number } {
  const safe = (v: number | undefined) => (Number.isFinite(v) && (v as number) > 0 ? (v as number) : 0);
  return { paddingLeft: Math.max(min, safe(insets.left)), paddingRight: Math.max(min, safe(insets.right)) };
}

/**
 * RESP-030: the same policy for an ABSOLUTELY POSITIONED overlay, where the horizontal offset
 * is `left`/`right` (position) rather than padding — padding on such a box moves its content
 * but leaves the box itself pinned to x = 0 / x = width, i.e. still under the sensor housing.
 * Used by the Go Live cards, which are the only exit from a `fullScreenModal` route.
 */
export function edgeOffset(
  insets: { left?: number; right?: number },
  min: number = 8,
): { left: number; right: number } {
  const p = edgePadding(insets, min);
  return { left: p.paddingLeft, right: p.paddingRight };
}
