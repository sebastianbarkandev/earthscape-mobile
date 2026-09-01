/**
 * REG-004: the rendered transcript window flipped between two unrelated windows twice a second.
 * `transcriptRowWindow` branches on `activeRow >= 0`, and the panel fed it the EXACT-containment
 * word index, which is -1 in every silence gap between words — most of a real transcript. With
 * the clock ticking at 0.5 s, rows [activeRow-2 … activeRow+2] and rows [0 … 12·pages]
 * alternated: "Show more" appeared and vanished, the panel's height oscillated by hundreds of pt
 * inside the page ScrollView, and a word Pressable could be swapped between touch-down and
 * touch-up.
 */
import { activeWordIndex, followWordIndex, rowOfWord, transcriptRowWindow } from '../transcriptWindow';

/** 400 words with real silence between them: word i spans [2i, 2i+0.5], so [2i+0.5, 2i+2) is a gap. */
const gapped = Array.from({ length: 400 }, (_, i) => ({ word: `w${i}`, start: 2 * i, end: 2 * i + 0.5 }));
const windowAt = (t: number | null, pages = 1) =>
  transcriptRowWindow({ rowCount: 50, activeRow: rowOfWord(followWordIndex(gapped, t)), follow: true, pages });

describe('followWordIndex (the window anchor)', () => {
  it('holds the last word that started, through the silence after it', () => {
    expect(followWordIndex(gapped, 400)).toBe(200); // inside word #200 ([400, 400.5])
    expect(followWordIndex(gapped, 400.5)).toBe(200); // its last instant
    expect(followWordIndex(gapped, 401)).toBe(200); // 0.5 s later: in the gap, SAME anchor
    expect(followWordIndex(gapped, 401.9)).toBe(200);
    expect(followWordIndex(gapped, 402)).toBe(201); // the next word starts
  });

  it('anchors at the top before speech starts and at the end past it, never at -1', () => {
    expect(followWordIndex(gapped, 0)).toBe(0);
    expect(followWordIndex([{ start: 5, end: 6 }], 1)).toBe(0); // lead-in before the first word
    expect(followWordIndex(gapped, 10_000)).toBe(399);
  });

  it('is -1 only when there is nothing to follow (no clock, no words)', () => {
    expect(followWordIndex(gapped, null)).toBe(-1);
    expect(followWordIndex(gapped, undefined)).toBe(-1);
    expect(followWordIndex(gapped, NaN)).toBe(-1);
    expect(followWordIndex([], 12)).toBe(-1);
  });

  it('the HIGHLIGHT still disappears in a gap (that part was correct)', () => {
    expect(activeWordIndex(gapped, 400.2)).toBe(200);
    expect(activeWordIndex(gapped, 401)).toBe(-1);
    expect(activeWordIndex(gapped, null)).toBe(-1);
  });
});

describe('the rendered window is stable across a 0.5 s tick into a silence gap', () => {
  it('keeps following: the same 5 rows, no "Show more" appearing and vanishing', () => {
    const inWord = windowAt(400);
    const inGap = windowAt(401); // the very next clock tick
    expect(inWord).toEqual({ start: 23, end: 28, hidden: 0, following: true }); // word 200 -> row 25
    expect(inGap).toEqual(inWord);
    expect(windowAt(401.5)).toEqual(inWord);
  });

  it('a "Show more" tap is not undone by the next tick', () => {
    // Browsing pages are irrelevant while following, but the branch must not flip and lose them.
    expect(windowAt(401, 2).following).toBe(true);
    expect(windowAt(401, 2)).toEqual(windowAt(400, 2));
  });

  it('nothing playing still browses from the top, growing on demand', () => {
    expect(windowAt(null, 2)).toEqual({ start: 0, end: 24, hidden: 26, following: false });
  });
});
