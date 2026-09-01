/**
 * Which transcript rows the panel renders (UI-002). The transcript used to be a FlatList
 * with `maxHeight: 240` nested inside the side-rail drawer, itself nested in the page
 * ScrollView — three vertical scroll regions stacked, and the transcript ate every drag
 * that started on it.
 *
 * Now there is no inner scroll:
 *  - following the playhead: a small window centred on the active row, so the current word
 *    is always visible at a stable spot (the web auto-scrolls; a phone cannot without
 *    stealing the page's scroll);
 *  - browsing (follow off, or nothing playing): the first N rows, grown by "Show more".
 */
export const TRANSCRIPT_WORDS_PER_ROW = 8;
/** Rows kept on screen while following — ~2.5 lines of context either side of the word. */
export const TRANSCRIPT_FOLLOW_ROWS = 5;
/** Rows per page while browsing. */
export const TRANSCRIPT_PAGE_ROWS = 12;

export interface RowWindow {
  start: number;
  /** Exclusive. */
  end: number;
  /** Rows below the window that "Show more" would reveal (0 while following). */
  hidden: number;
  following: boolean;
}

export function rowCountFor(wordCount: number): number {
  if (!Number.isFinite(wordCount) || wordCount <= 0) return 0;
  return Math.ceil(wordCount / TRANSCRIPT_WORDS_PER_ROW);
}

export function rowOfWord(index: number): number {
  return index < 0 ? -1 : Math.floor(index / TRANSCRIPT_WORDS_PER_ROW);
}

/** Just the timing fields of a transcript word (`api.TranscriptWord` satisfies it). */
interface WordTiming {
  start: number;
  end: number;
}

/**
 * The word the playhead is INSIDE, or -1 in the silence between words. This is the highlight:
 * it is meant to disappear during a pause in speech.
 */
export function activeWordIndex(words: ReadonlyArray<WordTiming>, videoTime: number | null | undefined): number {
  if (videoTime == null || !Number.isFinite(videoTime)) return -1;
  return words.findIndex((w) => w.start <= videoTime && videoTime <= w.end);
}

/**
 * The word the FOLLOW WINDOW anchors on: the last word that started at or before the playhead
 * (clamped to the first word before speech starts). Unlike `activeWordIndex` it does not vanish
 * between words — which is the whole point (REG-004): the window used to be derived from the
 * exact-containment index, so every silence gap flipped the panel from the 5-row follow window
 * to the 12·pages browse window and back, twice a second (the clock ticks at 0.5 s), moving the
 * reading position by hundreds of pt and swapping word Pressables under the user's finger.
 * -1 only when nothing is playing or there are no words, i.e. when browsing is the right mode.
 */
export function followWordIndex(words: ReadonlyArray<WordTiming>, videoTime: number | null | undefined): number {
  if (videoTime == null || !Number.isFinite(videoTime) || words.length === 0) return -1;
  let lo = 0;
  let hi = words.length - 1;
  let best = 0; // before the first word: keep the top of the transcript, don't fall back to browsing
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (words[mid].start <= videoTime) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

export function transcriptRowWindow(o: { rowCount: number; activeRow: number; follow: boolean; pages: number }): RowWindow {
  const rows = Math.max(0, Math.floor(o.rowCount) || 0);
  if (rows === 0) return { start: 0, end: 0, hidden: 0, following: false };
  if (o.follow && o.activeRow >= 0) {
    const span = Math.min(rows, TRANSCRIPT_FOLLOW_ROWS);
    const half = Math.floor(span / 2);
    const start = Math.min(Math.max(0, o.activeRow - half), rows - span);
    return { start, end: start + span, hidden: 0, following: true };
  }
  const end = Math.min(rows, Math.max(1, Math.floor(o.pages) || 1) * TRANSCRIPT_PAGE_ROWS);
  return { start: 0, end, hidden: rows - end, following: false };
}
