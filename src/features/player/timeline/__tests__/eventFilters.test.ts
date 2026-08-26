import type { Clipmark } from '../../api';
import { eventAuthors, filterEvents } from '../eventFilters';

const cm = (p: Partial<Clipmark>): Clipmark => ({ id: 1, type: null, text: null, time_start: null, time_end: null, ...p });
const list = [
  cm({ id: 1, type: 'clip', text: 'Bridge', time_start: 30, user: { id: 1, username: 'a' } }),
  cm({ id: 2, type: 'timepoint', text: 'Falls', time_start: 10, user: { id: 2, username: 'b' } }),
  cm({ id: 3, type: 'tak_chat', text: 'hi', time_start: 5 }),
  cm({ id: 4, text: 'note', time_start: 20, the_json: { data: { command: 'action', markerCat: 'Note' } } }),
  cm({ id: 5, text: 'mk', time_start: 25, the_json: { data: { command: 'action', markerCat: 'X' } } }),
];

describe('filterEvents (web TimelineEvents port)', () => {
  it('drops tak_chat and sorts by time by default', () => {
    expect(filterEvents(list, {}).map((c) => c.id)).toEqual([2, 4, 5, 1]);
  });
  it('filters by type incl. note/marker rules', () => {
    expect(filterEvents(list, { type: 'clip' }).map((c) => c.id)).toEqual([1]);
    expect(filterEvents(list, { type: 'note' }).map((c) => c.id)).toEqual([4]);
    expect(filterEvents(list, { type: 'marker' }).map((c) => c.id)).toEqual([5]);
  });
  it('filters by user and text search, and sorts variants', () => {
    expect(filterEvents(list, { user: 'b' }).map((c) => c.id)).toEqual([2]);
    expect(filterEvents(list, { search: 'BRI' }).map((c) => c.id)).toEqual([1]);
    expect(filterEvents(list, { sort: 'last' }).map((c) => c.id)).toEqual([1, 5, 4, 2]);
    expect(filterEvents(list, { sort: 'recent' }).map((c) => c.id)).toEqual([5, 4, 2, 1]);
    expect(filterEvents(list, { sort: 'oldest' }).map((c) => c.id)).toEqual([1, 2, 4, 5]);
  });
  it('lists authors', () => {
    expect(eventAuthors(list)).toEqual(['a', 'b']);
  });
});
