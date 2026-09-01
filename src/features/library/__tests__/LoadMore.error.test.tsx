/**
 * UI-029 — a "load more" that fails MID-LIST.
 *
 * Both paginated screens rendered their error only through `ListEmptyComponent`, so a page-2
 * failure with 24 items on screen showed nothing at all: no banner, no spinner (the footer is
 * bound to the loading status), and because paging was gated on `status === 'idle'` the list
 * never asked for another page again. The grid looked complete and healthy while pagination
 * was permanently dead. These tests pin the footer banner, its retry, and that the retry
 * resumes at the FAILED page without duplicating a row.
 */
import React from 'react';
import { FlatList } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { LibraryScreen } from '../LibraryScreen';
import { makeStore, flush } from '@/features/player/__tests__/fixtures';
import { api } from '@/common/api/client';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('../useOpenVideo', () => ({ useOpenVideo: () => jest.fn() }));
jest.mock('@/common/api/client', () => ({ api: jest.fn() }));

const mockApi = api as jest.MockedFunction<typeof api>;

const item = (id: number) => ({
  id, title: `t${id}`, status: 'ready', duration: 10, uploaded_filesize: null, date_posted: null,
  start: null, thumbnail_url: null, deleted_at: null, user: null,
});
const pageOf = (ids: number[], page: number, hasNext: boolean) => ({
  items: ids.map(item), page, per_page: 24, total: 6, pages: 3, has_next: hasNext, has_prev: page > 1, sort: 'recently-uploaded',
});

/** Host (not composite) nodes carrying `label` — one per rendered control. */
const labelled = (r: ReactTestRenderer, label: string): ReactTestInstance[] =>
  r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === label);
const retryBtn = (r: ReactTestRenderer) => labelled(r, 'Retry loading more videos');
const press = (r: ReactTestRenderer, label: string) =>
  r.root.find((n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function').props.onPress();

describe('LibraryScreen: a failed page 2', () => {
  afterEach(() => mockApi.mockReset());

  it('shows a footer retry, and the retry appends the failed page exactly once', async () => {
    mockApi.mockResolvedValueOnce(pageOf([1, 2], 1, true));
    let r!: ReactTestRenderer;
    const store = makeStore();
    await act(async () => { r = create(<Provider store={store}><LibraryScreen /></Provider>); });
    await act(async () => { await flush(); });
    const list = () => r.root.findByType(FlatList);
    expect((list().props.data as unknown[]).length).toBe(2);
    expect(retryBtn(r)).toHaveLength(0);

    // Scroll to the bottom -> page 2 fails.
    mockApi.mockRejectedValueOnce(new Error('Network request failed'));
    await act(async () => { list().props.onEndReached?.({ distanceFromEnd: 0 }); await flush(); });
    expect(store.getState().library.items).toHaveLength(2); // the grid is NOT wiped
    expect(retryBtn(r)).toHaveLength(1);

    // Further scrolling must NOT hammer the failed page (the gate is the error, not the status).
    const callsAfterFailure = mockApi.mock.calls.length;
    await act(async () => { list().props.onEndReached?.({ distanceFromEnd: 0 }); await flush(); });
    expect(mockApi.mock.calls.length).toBe(callsAfterFailure);

    // Retry: page 2 again (never page 1), and the repeated item 2 is dropped by mergeById.
    mockApi.mockResolvedValueOnce(pageOf([2, 3], 2, false));
    await act(async () => { press(r, 'Retry loading more videos'); await flush(); });
    expect(String(mockApi.mock.calls[mockApi.mock.calls.length - 1][0])).toContain('page=2');
    const ids = (list().props.data as Array<{ id: number }>).map((v) => v.id);
    expect(ids).toEqual([1, 2, 3]);
    expect(retryBtn(r)).toHaveLength(0);
    await act(async () => { r.unmount(); });
  });

  it('a failed FIRST page keeps the full-screen error state instead of the footer', async () => {
    mockApi.mockRejectedValueOnce(new Error('offline'));
    let r!: ReactTestRenderer;
    await act(async () => { r = create(<Provider store={makeStore()}><LibraryScreen /></Provider>); });
    await act(async () => { await flush(); });
    expect(retryBtn(r)).toHaveLength(0);
    expect(labelled(r, 'Try again')).toHaveLength(1);
    await act(async () => { r.unmount(); });
  });
});
