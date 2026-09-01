/**
 * Progressive disclosure for the lists that live INSIDE the player page's ScrollView (UI-002).
 *
 * A vertical ScrollView/FlatList nested in the page scroll is a touch trap on iOS: the inner
 * view claims the drag, so with the side-rail drawer open (340pt) or the metadata list
 * expanded (260pt) most of the visible page could not be scrolled at all. Those inner scroll
 * regions are gone; the lists render a bounded number of rows and grow on demand instead, so
 * there is exactly ONE scroll gesture on the page and render cost stays bounded.
 */
export interface Paged<T> {
  shown: T[];
  /** Rows not rendered yet. */
  hidden: number;
  /** Rows the next "Show more" tap would add. */
  next: number;
}

export function pagedSlice<T>(items: readonly T[], pageSize: number, pages: number): Paged<T> {
  const size = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 1;
  const p = Number.isFinite(pages) && pages > 0 ? Math.floor(pages) : 1;
  const end = Math.min(items.length, size * p);
  const hidden = Math.max(0, items.length - end);
  return { shown: items.slice(0, end), hidden, next: Math.min(hidden, size) };
}

/** Label for the reveal control, or null when everything is on screen. */
export function showMoreLabel(paged: Paged<unknown>, noun: string): string | null {
  if (paged.hidden === 0) return null;
  return `Show ${paged.next} more ${noun}${paged.next === 1 ? '' : 's'} (${paged.hidden} hidden)`;
}
