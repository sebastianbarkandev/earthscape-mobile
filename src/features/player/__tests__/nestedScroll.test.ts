/**
 * UI-002: the player page is ONE vertical ScrollView (PlayerScreen). A nested vertical
 * ScrollView/FlatList inside it is a touch trap on iOS — the inner view claims the drag, so
 * with the side-rail drawer open (`maxHeight: 340`), the metadata list expanded (260) or the
 * transcript rendered (240) most of the visible page could not be scrolled at all, and in
 * split layout the drawer covered nearly everything below the viewport.
 *
 * The fix: every inner list renders a bounded number of rows and grows on demand
 * (src/common/showMore.ts, src/features/player/transcriptWindow.ts). This guard keeps it
 * that way; the horizontal strips (programs, side-rail tabs, action row, toolbar, chips)
 * are fine — they do not compete with a vertical drag.
 */
import * as fs from 'fs';
import * as path from 'path';
import { pagedSlice, showMoreLabel } from '@/common/showMore';
import {
  TRANSCRIPT_FOLLOW_ROWS,
  TRANSCRIPT_PAGE_ROWS,
  TRANSCRIPT_WORDS_PER_ROW,
  rowCountFor,
  rowOfWord,
  transcriptRowWindow,
} from '../transcriptWindow';

const ROOT = path.resolve(__dirname, '../../../..');
/** Everything rendered INSIDE PlayerScreen's ScrollView. */
const PAGE_SUBTREE = [
  'src/features/player/components/ProgramStrip.tsx',
  'src/features/player/components/ActionRow.tsx',
  'src/features/player/components/panel/SidePanel.tsx',
  'src/features/player/components/panel/EventsPanel.tsx',
  'src/features/player/components/panel/TakChatPanel.tsx',
  'src/features/player/components/panel/DrawingsPanel.tsx',
  'src/features/player/components/panel/TranscriptPanel.tsx',
  'src/features/player/components/timeline/TimelineCard.tsx',
  'src/features/player/components/timeline/TimelineToolbar.tsx',
  'src/features/player/components/timeline/TimelineCanvas.tsx',
  'src/features/player/components/timeline/MetadataWell.tsx',
  'src/features/player/components/timeline/ReadoutList.tsx',
  'src/features/player/components/info/InfoCard.tsx',
];

describe('no nested vertical scroll inside the player page', () => {
  it.each(PAGE_SUBTREE)('%s', (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const scrollViews = [...src.matchAll(/<ScrollView\b([^>]*)>/gs)];
    for (const m of scrollViews) expect({ rel, horizontal: /horizontal/.test(m[1]) }).toEqual({ rel, horizontal: true });
    expect({ rel, flatList: /<FlatList\b/.test(src) }).toEqual({ rel, flatList: false });
    // A capped inner region must not reintroduce a scroll box by pinning its height either.
    expect({ rel, maxHeight: /maxHeight:\s*\d/.test(src) }).toEqual({ rel, maxHeight: false });
  });

  it('PlayerScreen still owns exactly one page ScrollView', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/features/player/PlayerScreen.tsx'), 'utf8');
    expect([...src.matchAll(/<ScrollView\b/g)]).toHaveLength(1);
  });
});

describe('pagedSlice', () => {
  const items = Array.from({ length: 30 }, (_, i) => i);
  it('shows one page first and grows a page at a time', () => {
    expect(pagedSlice(items, 12, 1)).toMatchObject({ hidden: 18, next: 12 });
    expect(pagedSlice(items, 12, 1).shown).toHaveLength(12);
    expect(pagedSlice(items, 12, 2).shown).toHaveLength(24);
    expect(pagedSlice(items, 12, 3)).toMatchObject({ hidden: 0, next: 0 });
    expect(pagedSlice(items, 12, 3).shown).toHaveLength(30);
  });
  it('never over-runs the list and survives nonsense arguments', () => {
    expect(pagedSlice([], 12, 1)).toEqual({ shown: [], hidden: 0, next: 0 });
    expect(pagedSlice(items, 0, 1).shown).toHaveLength(1);
    expect(pagedSlice(items, 12, 0).shown).toHaveLength(12);
    expect(pagedSlice(items, NaN, NaN).shown).toHaveLength(1);
    expect(pagedSlice(items, 12, 99).shown).toHaveLength(30);
  });
  it('labels the reveal control only when something is hidden', () => {
    expect(showMoreLabel(pagedSlice(items, 12, 3), 'field')).toBeNull();
    expect(showMoreLabel(pagedSlice(items, 12, 1), 'field')).toBe('Show 12 more fields (18 hidden)');
    expect(showMoreLabel(pagedSlice(items, 29, 1), 'field')).toBe('Show 1 more field (1 hidden)');
  });
});

describe('transcriptRowWindow', () => {
  it('groups words into rows of 8', () => {
    expect(TRANSCRIPT_WORDS_PER_ROW).toBe(8);
    expect(rowCountFor(0)).toBe(0);
    expect(rowCountFor(1)).toBe(1);
    expect(rowCountFor(16)).toBe(2);
    expect(rowCountFor(17)).toBe(3);
    expect(rowOfWord(0)).toBe(0);
    expect(rowOfWord(9)).toBe(1);
    expect(rowOfWord(-1)).toBe(-1);
  });

  it('following: a small window centred on the active row, no "show more"', () => {
    const w = transcriptRowWindow({ rowCount: 100, activeRow: 50, follow: true, pages: 1 });
    expect(w).toEqual({ start: 48, end: 53, hidden: 0, following: true });
    expect(w.end - w.start).toBe(TRANSCRIPT_FOLLOW_ROWS);
  });

  it('following clamps at both ends instead of showing empty space', () => {
    expect(transcriptRowWindow({ rowCount: 100, activeRow: 0, follow: true, pages: 1 })).toMatchObject({ start: 0, end: 5 });
    expect(transcriptRowWindow({ rowCount: 100, activeRow: 99, follow: true, pages: 1 })).toMatchObject({ start: 95, end: 100 });
    expect(transcriptRowWindow({ rowCount: 3, activeRow: 1, follow: true, pages: 1 })).toMatchObject({ start: 0, end: 3 });
  });

  it('not following (or nothing playing): the first page, growing on demand', () => {
    expect(transcriptRowWindow({ rowCount: 100, activeRow: 50, follow: false, pages: 1 })).toEqual({ start: 0, end: TRANSCRIPT_PAGE_ROWS, hidden: 100 - TRANSCRIPT_PAGE_ROWS, following: false });
    expect(transcriptRowWindow({ rowCount: 100, activeRow: -1, follow: true, pages: 2 })).toEqual({ start: 0, end: 24, hidden: 76, following: false });
    expect(transcriptRowWindow({ rowCount: 10, activeRow: -1, follow: false, pages: 1 })).toEqual({ start: 0, end: 10, hidden: 0, following: false });
  });

  it('an empty transcript renders nothing at all', () => {
    expect(transcriptRowWindow({ rowCount: 0, activeRow: -1, follow: true, pages: 1 })).toEqual({ start: 0, end: 0, hidden: 0, following: false });
  });
});
