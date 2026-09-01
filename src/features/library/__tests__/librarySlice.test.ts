import reducer, { fetchLive, fetchVideos, mergeById } from '../librarySlice';
import type { VideoListItem } from '../librarySlice';

const item = (id: number): VideoListItem => ({
  id, title: `t${id}`, status: 'live', duration: null, uploaded_filesize: null, date_posted: null, start: null, thumbnail_url: null, deleted_at: null, user: null,
});
const page = { items: [item(1)], page: 1, pages: 1, total: 1, per_page: 24 };

describe('fetchLive silent background refresh (LIVE-016)', () => {
  it('a silent refresh with items loaded does not flip liveStatus to loading', () => {
    let s = reducer(undefined, fetchLive.fulfilled(page, 'r', undefined));
    expect(s.liveStatus).toBe('idle');
    s = reducer(s, fetchLive.pending('r2', { silent: true }));
    expect(s.liveStatus).toBe('idle');
    s = reducer(s, fetchLive.pending('r3', undefined));
    expect(s.liveStatus).toBe('loading');
  });
  it('a silent refresh with nothing loaded yet still shows the loader', () => {
    const s = reducer(undefined, fetchLive.pending('r', { silent: true }));
    expect(s.liveStatus).toBe('loading');
  });
});

describe('fetchLive failures (UI-005)', () => {
  const boom = { name: 'Error', message: 'Network request failed' };
  it('a failed poll keeps the streams already on screen and reports the error as stale, not empty', () => {
    let s = reducer(undefined, fetchLive.fulfilled(page, 'r', undefined));
    s = reducer(s, { type: fetchLive.rejected.type, error: boom, meta: { arg: { silent: true }, requestId: 'r2' } });
    expect(s.liveItems).toHaveLength(1); // NOT wiped
    expect(s.liveStatus).toBe('idle'); // the list is still valid, just stale
    expect(s.liveError).toBe('Network request failed');
  });
  it('a failed initial load is an error state (never "No live streams")', () => {
    const s = reducer(undefined, { type: fetchLive.rejected.type, error: boom, meta: { arg: undefined, requestId: 'r' } });
    expect(s.liveStatus).toBe('error');
    expect(s.liveError).toBe('Network request failed');
    expect(s.liveItems).toEqual([]);
  });
  it('a later success clears the error', () => {
    let s = reducer(undefined, { type: fetchLive.rejected.type, error: boom, meta: { arg: undefined, requestId: 'r' } });
    s = reducer(s, fetchLive.fulfilled(page, 'r2', undefined));
    expect(s.liveStatus).toBe('idle');
    expect(s.liveError).toBeNull();
  });
  it('a rejection with no message still says something', () => {
    const s = reducer(undefined, { type: fetchLive.rejected.type, error: {}, meta: { arg: undefined, requestId: 'r' } });
    expect(s.liveError).toBe('Failed to load live streams.');
  });
});

describe('fetchVideos failures (UI-029)', () => {
  const boom = { name: 'Error', message: 'Network request failed' };
  const arg = (page: number) => ({ page, sort: 'recently-uploaded' as const });
  const p1 = { items: [item(1), item(2)], page: 1, pages: 3, total: 6, has_next: true };

  it('a failed page 2 keeps the loaded items and returns to idle so a retry can run', () => {
    let s = reducer(undefined, fetchVideos.fulfilled(p1, 'r', arg(1)));
    s = reducer(s, fetchVideos.pending('r2', arg(2)));
    expect(s.status).toBe('loadingMore');
    s = reducer(s, { type: fetchVideos.rejected.type, error: boom, meta: { arg: arg(2), requestId: 'r2' } });
    expect(s.items).toHaveLength(2); // NOT wiped
    expect(s.status).toBe('idle'); // 'error' hid the footer spinner AND blocked every later page
    expect(s.error).toBe('Network request failed');
    // The cursor still points at the last page that succeeded, so a retry resumes at page 2.
    expect(s.page).toBe(1);
    expect(s.hasNext).toBe(true);
  });

  it('a failed FIRST page is still the full error state (never "No videos yet")', () => {
    let s = reducer(undefined, fetchVideos.pending('r', arg(1)));
    s = reducer(s, { type: fetchVideos.rejected.type, error: boom, meta: { arg: arg(1), requestId: 'r' } });
    expect(s.status).toBe('error');
    expect(s.error).toBe('Network request failed');
  });

  it('retrying the failed page appends it once and clears the error', () => {
    let s = reducer(undefined, fetchVideos.fulfilled(p1, 'r', arg(1)));
    s = reducer(s, { type: fetchVideos.rejected.type, error: boom, meta: { arg: arg(2), requestId: 'r2' } });
    s = reducer(s, fetchVideos.pending('r3', arg(2)));
    expect(s.error).toBeNull();
    // The retried page repeats item 2 (an offset page of a shifted table) — mergeById drops it.
    s = reducer(s, fetchVideos.fulfilled({ items: [item(2), item(3)], page: 2, pages: 3, total: 6, has_next: true }, 'r3', arg(2)));
    expect(s.items.map((v) => v.id)).toEqual([1, 2, 3]);
    expect(s.status).toBe('idle');
    expect(s.page).toBe(2);
  });

  it('a rejection with no message still says something', () => {
    const s = reducer(undefined, { type: fetchVideos.rejected.type, error: {}, meta: { arg: arg(1), requestId: 'r' } });
    expect(s.error).toBe('Failed to load videos.');
  });
});

describe('mergeById pagination (UI-019)', () => {
  it('drops ids already loaded so FlatList never sees a duplicate key', () => {
    expect(mergeById([item(1), item(2)], [item(2), item(3)]).map((v) => v.id)).toEqual([1, 2, 3]);
  });
  it('keeps the first copy (the visible row does not reshuffle) and is order-preserving', () => {
    const first = item(2);
    const shifted = { ...item(2), title: 'renamed' };
    expect(mergeById([item(1), first], [shifted]).map((v) => v.title)).toEqual(['t1', 't2']);
    expect(mergeById([], [item(5), item(4), item(5)]).map((v) => v.id)).toEqual([5, 4]);
  });
  it('page 2 of a shifted table cannot duplicate a key in the reducer either', () => {
    const p1 = { items: [item(1), item(2)], page: 1, pages: 2, total: 4, has_next: true };
    const p2 = { items: [item(2), item(3)], page: 2, pages: 2, total: 4, has_next: false };
    let s = reducer(undefined, fetchVideos.fulfilled(p1, 'r', { page: 1, sort: 'recently-uploaded' }));
    s = reducer(s, fetchVideos.fulfilled(p2, 'r2', { page: 2, sort: 'recently-uploaded' }));
    const ids = s.items.map((v) => v.id);
    expect(ids).toEqual([1, 2, 3]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
