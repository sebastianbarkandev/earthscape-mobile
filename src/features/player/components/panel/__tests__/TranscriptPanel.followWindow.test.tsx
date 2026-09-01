/**
 * REG-004, at the panel: with follow ON (the default) and the video playing, the rendered rows
 * must not change when the playhead crosses from a word into the silence after it. The shared
 * fixture cannot show this (24 gapless words = 3 rows, fewer than TRANSCRIPT_FOLLOW_ROWS, so
 * both branches return the same window), hence a gapped 400-word one here.
 */
import React from 'react';
import { Provider } from 'react-redux';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TranscriptPanel, TranscriptRow } from '../TranscriptPanel';
import { fetchTranscript } from '../../../eventThunks';
import { setCurrentTime } from '../../../playerSlice';
import { makeStore, START_UTC, type TestStore } from '../../../__tests__/fixtures';

/** word i spans [2i, 2i+0.5] — 400 words, 50 rows, and 1.5 s of silence between words. */
const gapped = Array.from({ length: 400 }, (_, i) => ({ word: `w${i}`, start: 2 * i, end: 2 * i + 0.5 }));

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('../../../api', () => ({
  ...jest.requireActual('../../../api'),
  getTranscriptStatus: jest.fn(async () => ({
    status: 'success',
    transcript: { text: '', words: Array.from({ length: 400 }, (_, i) => ({ word: `w${i}`, start: 2 * i, end: 2 * i + 0.5 })) },
  })),
}));

const ROW = (TranscriptRow as unknown as { type: React.ComponentType }).type;
const renderedRows = (r: ReactTestRenderer) => r.root.findAllByType(ROW).map((n) => n.props.row as number);
const showMore = (r: ReactTestRenderer) =>
  r.root.findAll((n) => typeof n.props?.accessibilityLabel === 'string' && n.props.accessibilityLabel.startsWith('Show more transcript'));

async function panelAt(store: TestStore, videoTime: number) {
  act(() => {
    store.dispatch({ type: fetchTranscript.fulfilled.type, payload: { status: 'success', transcript: { text: '', words: gapped } } });
    store.dispatch(setCurrentTime({ video: videoTime, utc: START_UTC + videoTime }));
  });
  let r!: ReactTestRenderer;
  await act(async () => { r = create(<Provider store={store}><TranscriptPanel videoId={6} /></Provider>); });
  return r;
}

describe('TranscriptPanel follow window across a silence gap (REG-004)', () => {
  it('a 0.5 s tick into the gap after a word leaves the rendered rows untouched', async () => {
    const store = makeStore();
    const r = await panelAt(store, 400); // inside word #200 -> row 25
    const inWord = renderedRows(r);
    expect(inWord).toEqual([23, 24, 25, 26, 27]);
    expect(showMore(r)).toHaveLength(0);

    act(() => { store.dispatch(setCurrentTime({ video: 401, utc: START_UTC + 401 })); }); // silence
    expect(renderedRows(r)).toEqual(inWord);
    expect(showMore(r)).toHaveLength(0);

    act(() => { store.dispatch(setCurrentTime({ video: 401.5, utc: START_UTC + 401.5 })); }); // still silence
    expect(renderedRows(r)).toEqual(inWord);

    act(() => { store.dispatch(setCurrentTime({ video: 402, utc: START_UTC + 402 })); }); // word #201, row 25
    expect(renderedRows(r)).toEqual(inWord);
    act(() => { r.unmount(); });
  });
});
