/**
 * Dynamic Type policy (RESP-005).
 *
 * Body copy (descriptions, cards, sheets, hints) scales freely with the OS setting.
 * Dense chrome — toolbar pills, chips, badges, tab labels, numeric readouts, the player
 * controls bar — sits in boxes a few pt taller than its glyphs and cannot grow 2.35×
 * (AX3) without overflowing its neighbours, so it is capped at 1.3× and its boxes use
 * `minHeight` (never `height`) so a capped label still gets room instead of clipping.
 */
export const DENSE_MAX_FONT_SCALE = 1.3;

/** Spread onto a dense-chrome `<Text {...denseText}>`. */
export const denseText = { maxFontSizeMultiplier: DENSE_MAX_FONT_SCALE } as const;
