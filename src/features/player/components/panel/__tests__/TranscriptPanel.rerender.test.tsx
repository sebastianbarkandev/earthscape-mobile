/**
 * RESP-024: the transcript follows the 2 Hz playhead, but a word row only CHANGES when the
 * active word enters or leaves it. Before this, `renderItem` was an inline closure over
 * `activeIndex`, so every visible row (8 Pressables each) re-rendered twice a second.
 *
 * The rows are now `React.memo`'d, which bails out on shallow-equal props — so this asserts
 * exactly that: across a tick that does not move the active word, every row's props are
 * shallow-equal (including the `onSeek` identity, an inline arrow would have broken it), and
 * when the active word moves, only the rows that own it change.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TranscriptPanel, TranscriptRow } from '../TranscriptPanel';
import { fetchTranscript } from '../../../eventThunks';
import { setCurrentTime } from '../../../playerSlice';
import { makeStore, START_UTC, type TestStore } from '../../../__tests__/fixtures';
import { words } from './transcriptFixture';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
// the panel re-fetches on mount; keep that request from wiping the seeded words.
jest.mock('../../../api', () => ({
  ...jest.requireActual('../../../api'),
  getTranscriptStatus: jest.fn(async () => ({ status: 'success', transcript: { text: '', words: jest.requireActual('./transcriptFixture').words } })),
}));

async function panel(store: TestStore) {
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<Provider store={store}><TranscriptPanel videoId={6} /></Provider>); });
  return r;
}
/**
 * `React.memo(fn)` renders as a SimpleMemoComponent fiber whose `type` is the inner
 * function, so the test instances are found by `TranscriptRow.type`, not by the memo object.
 */
const ROW = (TranscriptRow as unknown as { type: React.ComponentType }).type;
const rowProps = (r: ReactTestRenderer) => r.root.findAllByType(ROW).map((n) => ({ ...n.props }));
const shallowEqual = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);

describe('TranscriptPanel rows and the playback clock (RESP-024)', () => {
  it('a tick inside the same word leaves every row memo-identical', async () => {
    const store = makeStore();
    act(() => {
      store.dispatch({ type: fetchTranscript.fulfilled.type, payload: { status: 'success', transcript: { text: '', words } } });
      store.dispatch(setCurrentTime({ video: 2.2, utc: START_UTC + 2.2 }));
    });
    const r = await panel(store);
    const before = rowProps(r);
    expect(before.length).toBeGreaterThan(0);

    act(() => { store.dispatch(setCurrentTime({ video: 2.7, utc: START_UTC + 2.7 })); }); // still word #2
    const after = rowProps(r);
    expect(after).toHaveLength(before.length);
    after.forEach((p, i) => expect({ row: p.row, same: shallowEqual(before[i], p) }).toEqual({ row: p.row, same: true }));
    act(() => { r.unmount(); });
  });

  it('moving the active word changes only the rows that own it', async () => {
    const store = makeStore();
    act(() => {
      store.dispatch({ type: fetchTranscript.fulfilled.type, payload: { status: 'success', transcript: { text: '', words } } });
      store.dispatch(setCurrentTime({ video: 2.2, utc: START_UTC + 2.2 }));
    });
    const r = await panel(store);
    const before = rowProps(r);
    act(() => { store.dispatch(setCurrentTime({ video: 3.2, utc: START_UTC + 3.2 })); }); // word #2 -> #3, same row
    const after = rowProps(r);
    const changed = after.filter((p, i) => !shallowEqual(before[i] ?? {}, p));
    expect(changed).toHaveLength(1);
    expect(changed[0].activeIdx).toBe(3);
    // the callback identity is what makes memo work at all
    expect(after.every((p) => p.onSeek === before[0].onSeek)).toBe(true);
    act(() => { r.unmount(); });
  });
});
