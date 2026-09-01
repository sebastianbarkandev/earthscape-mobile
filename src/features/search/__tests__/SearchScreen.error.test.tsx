/**
 * UI-027: a failed search must offer a retry — before this, the only way out of "Search
 * failed" was editing the query, because `EmptyState.action` was never wired here.
 * UI-029: and a failure on page 2+ must not look like nothing happened — the results stay,
 * the footer says so, and its Retry resumes the FAILED page without duplicating a row.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SearchScreen } from '../SearchScreen';
import * as api from '../api';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('@/features/library/useOpenVideo', () => ({ useOpenVideo: () => jest.fn() }));
jest.mock('../api', () => ({
  ...jest.requireActual('../api'),
  searchVideos: jest.fn(),
  getFilterChoices: jest.fn(async () => ({ users: [], tags: [], categories: [], tail_numbers: [] })),
}));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('SearchScreen error state', () => {
  it('renders Try again and re-runs the search', async () => {
    (api.searchVideos as jest.Mock).mockRejectedValue(new Error('Network request failed'));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<SearchScreen initialQuery="falls" />); });
    await act(async () => { await flush(); });
    const calls = (api.searchVideos as jest.Mock).mock.calls.length;
    expect(calls).toBeGreaterThanOrEqual(1);

    const retry = r.root.findAll((n) => n.props?.accessibilityLabel === 'Try again' && typeof n.props?.onPress === 'function');
    expect(retry.length).toBeGreaterThanOrEqual(1);
    await act(async () => { retry[0].props.onPress(); await flush(); });
    expect((api.searchVideos as jest.Mock).mock.calls.length).toBeGreaterThan(calls);
    // Let the FlatList's own deferred cell update land inside act().
    await act(async () => { await flush(); });
  });
});

const item = (id: number) => ({
  id, title: `t${id}`, status: 'ready', duration: 10, uploaded_filesize: null, date_posted: null,
  start: null, thumbnail_url: null, deleted_at: null, user: null,
});
const pageOf = (ids: number[], page: number, has_next: boolean) => ({
  items: ids.map(item), page, per_page: 24, total: 6, pages: 3, has_next, has_prev: page > 1, sort: 'recently-uploaded',
});
/** Host (not composite) nodes carrying `label` — one per rendered control. */
const labelled = (r: ReactTestRenderer, label: string): ReactTestInstance[] =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === label);

describe('SearchScreen infinite scroll dedupes by id (UI-018/UI-019)', () => {
  /**
   * TEST-010: `mergeById` was pinned in `librarySlice` but not at THIS call site — replacing
   * it with a plain spread concat left the suite green. A shifted offset page repeats a row,
   * React logs "two children with the same key" and the FlatList drops one of them, so a
   * result the user searched for disappears.
   */
  it('a page 2 that repeats page 1 rows appends only the new ones', async () => {
    const mock = api.searchVideos as jest.Mock;
    mock.mockReset();
    mock.mockResolvedValue(pageOf([1, 2], 1, true));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<SearchScreen initialQuery="falls" />); });
    await act(async () => { await flush(); });
    const list = () => r.root.findByType(FlatList);
    const ids = () => (list().props.data as Array<{ id: number }>).map((v) => v.id);
    expect(ids()).toEqual([1, 2]);

    // The table shifted between requests: page 2 comes back overlapping page 1 by one row.
    mock.mockResolvedValueOnce(pageOf([2, 3], 2, true));
    await act(async () => { list().props.onEndReached?.({ distanceFromEnd: 0 }); await flush(); });
    expect(ids()).toEqual([1, 2, 3]);
    expect(new Set(ids()).size).toBe(ids().length);

    // A page that repeats EVERY row adds nothing and still leaves no duplicate.
    mock.mockResolvedValueOnce(pageOf([1, 2, 3], 3, false));
    await act(async () => { list().props.onEndReached?.({ distanceFromEnd: 0 }); await flush(); });
    expect(ids()).toEqual([1, 2, 3]);
    // And the keyExtractor really keys on the id, so a duplicate WOULD have collided.
    expect(list().props.keyExtractor(item(7), 0)).toBe('7');
    await act(async () => { await flush(); });
    await act(async () => { r.unmount(); });
  });
});

describe('SearchScreen: a failed page 2 (UI-029)', () => {
  it('keeps the results, shows a footer retry, and appends the failed page once', async () => {
    const mock = api.searchVideos as jest.Mock;
    mock.mockReset();
    // The mount effect can run `load(1, false)` more than once (the ?q= effect replaces the
    // filters object), so page 1 is the DEFAULT resolution; the once-values below queue ahead.
    mock.mockResolvedValue(pageOf([1, 2], 1, true));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<SearchScreen initialQuery="falls" />); });
    await act(async () => { await flush(); });
    const list = () => r.root.findByType(FlatList);
    expect((list().props.data as unknown[]).length).toBe(2);
    expect(labelled(r, 'Retry loading more results')).toHaveLength(0);

    mock.mockRejectedValueOnce(new Error('Network request failed'));
    await act(async () => { list().props.onEndReached?.({ distanceFromEnd: 0 }); await flush(); });
    expect((list().props.data as unknown[]).length).toBe(2); // results NOT wiped
    expect(labelled(r, 'Try again')).toHaveLength(0); // the full-page error state is for an EMPTY list
    expect(labelled(r, 'Retry loading more results')).toHaveLength(1);

    // Scrolling again must not re-fire the failed page in a loop.
    const calls = mock.mock.calls.length;
    await act(async () => { list().props.onEndReached?.({ distanceFromEnd: 0 }); await flush(); });
    expect(mock.mock.calls.length).toBe(calls);

    mock.mockResolvedValueOnce(pageOf([2, 3], 2, false));
    const retry = r.root.find((n) => n.props?.accessibilityLabel === 'Retry loading more results' && typeof n.props?.onPress === 'function');
    await act(async () => { retry.props.onPress(); await flush(); });
    expect(mock.mock.calls[mock.mock.calls.length - 1][2]).toBe(2); // the failed page, not page 1
    expect((list().props.data as Array<{ id: number }>).map((v) => v.id)).toEqual([1, 2, 3]);
    expect(labelled(r, 'Retry loading more results')).toHaveLength(0);
    await act(async () => { await flush(); });
    await act(async () => { r.unmount(); });
  });
});
