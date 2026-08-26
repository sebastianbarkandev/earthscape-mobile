import type { Clipmark } from '../api';

/** Web TimelineEvents.jsx filter/sort pipeline (pure). */
export type EventTypeFilter = 'all' | 'clip' | 'timepoint' | 'note' | 'plate' | 'marker' | 'hardware' | string;
export type EventSort = 'time' | 'last' | 'recent' | 'oldest';

export function matchesType(c: Clipmark, type: EventTypeFilter): boolean {
  if (type === 'all') return true;
  const d = c.the_json?.data;
  switch (type) {
    case 'note':
      return d?.markerCat === 'Note';
    case 'plate':
      return d?.markerCat === 'Plate' || c.type === 'plate';
    case 'marker':
      return d?.command === 'action' && d?.markerCat !== 'Plate' && d?.markerCat !== 'Note';
    default:
      return c.type === type;
  }
}

export function filterEvents(
  clipmarks: Clipmark[],
  opts: { search?: string; type?: EventTypeFilter; user?: string | null; sort?: EventSort },
): Clipmark[] {
  const q = (opts.search ?? '').trim().toLowerCase();
  let out = clipmarks.filter((c) => c.type !== 'tak_chat');
  if (opts.type && opts.type !== 'all') out = out.filter((c) => matchesType(c, opts.type as EventTypeFilter));
  if (opts.user) out = out.filter((c) => c.user?.username === opts.user);
  if (q) out = out.filter((c) => (c.text ?? '').toLowerCase().includes(q)); // web: text only
  const byTime = (a: Clipmark, b: Clipmark) => (a.time_start ?? 0) - (b.time_start ?? 0);
  switch (opts.sort ?? 'time') {
    case 'last':
      return out.slice().sort(byTime).reverse();
    case 'recent':
      return out.slice().sort((a, b) => b.id - a.id);
    case 'oldest':
      return out.slice().sort((a, b) => a.id - b.id);
    default:
      return out.slice().sort(byTime);
  }
}

/** Usernames present on the clipmarks (web intersects the org user list with these). */
export function eventAuthors(clipmarks: Clipmark[]): string[] {
  const set = new Set<string>();
  clipmarks.forEach((c) => c.user?.username && set.add(c.user.username));
  return [...set].sort();
}
