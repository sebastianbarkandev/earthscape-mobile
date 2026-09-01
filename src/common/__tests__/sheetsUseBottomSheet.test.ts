/**
 * RESP-004 regression guard: every sheet / dialog goes through BottomSheet (keyboard
 * avoidance, safe-area padding, pt max height, iPad max width, landscape). A raw
 * `<Modal` in one of these files means a sheet lost all of that again.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ROOT, jsxElements, rel as relOf, styleObjects, uiFiles } from './sourceScan';

/**
 * TEST-008: derived from the tree, not frozen — every component that renders a
 * `<BottomSheet>` or a raw `<Modal>` IS a sheet and must obey the rules below, including one
 * added tomorrow. The former hardcoded list of five is asserted to be a subset, so a sheet
 * cannot leave the guard by being renamed away from it either.
 */
const EXPECTED_SHEETS = [
  'src/features/search/FilterSheet.tsx',
  'src/features/player/components/share/ShareModal.tsx',
  'src/features/player/components/timeline/ClipmarkSheet.tsx',
  'src/features/player/components/MapLayersSheet.tsx',
  'src/common/components/TextPromptModal.tsx',
];

/** Files that render a sheet, as POSIX-ish repo-relative paths. */
function sheetFiles(): string[] {
  return uiFiles()
    .filter((f) => {
      if (/[/\\]components[/\\]BottomSheet\.tsx$/.test(f)) return false; // the primitive itself
      const src = fs.readFileSync(f, 'utf8');
      return /<BottomSheet\b/.test(src) || /<Modal\b/.test(src);
    })
    .map((f) => relOf(f).split(path.sep).join('/'));
}

const SHEETS = sheetFiles();

/**
 * The two RESP-004 / RESP-022 rules, as a property of the FILE rather than of a style named
 * `card`: BottomSheet owns the home-indicator inset (so the sheet's own card must not add a
 * bottom padding of its own) and owns the pt height budget (so no style in the file may set a
 * max height, whatever the value or the key name). Inner rows may pad freely — only the style
 * BottomSheet lays out (`cardStyle=`) is the sheet's card.
 */
function sheetStyleOffenders(src: string, styles: Record<string, string>): string[] {
  const cardKeys = [...src.matchAll(/cardStyle=\{?\[?\s*styles\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
  const offenders: string[] = [];
  for (const key of cardKeys) {
    if (/(?:^|[\s,{])paddingBottom:/.test(styles[key] ?? '')) offenders.push(`${key}.paddingBottom`);
  }
  for (const [key, body] of Object.entries(styles)) {
    // Any max height at all — a percentage, a literal or a variable — is the sheet
    // re-deciding its own height instead of taking BottomSheet's pt budget (RESP-022).
    if (/(?:^|[\s,{])maxHeight:/.test(body)) offenders.push(`${key}.maxHeight`);
  }
  return offenders;
}

describe('the style rules detect the shapes RESP-004 / RESP-022 removed', () => {
  it('flags a card paddingBottom and any maxHeight, and passes an inner row padding', () => {
    const bad = "<BottomSheet cardStyle={styles.card}>\n  card: { paddingBottom: 34 },\n";
    expect(sheetStyleOffenders(bad, styleObjects(bad))).toEqual(['card.paddingBottom']);
    for (const v of ["'80%'", '340', 'PANEL_H', 'maxH']) {
      const src2 = `<BottomSheet>\n  body: { maxHeight: ${v} },\n`;
      expect(sheetStyleOffenders(src2, styleObjects(src2))).toEqual(['body.maxHeight']);
    }
    const ok = "<BottomSheet cardStyle={styles.card}>\n  card: { gap: 12 },\n  head: { paddingBottom: 8 },\n";
    expect(sheetStyleOffenders(ok, styleObjects(ok))).toEqual([]);
  });
});

/**
 * REG-003: BottomSheet caps the card in pt (0.88 x window) and bottom-anchors it, and sheet rows
 * are `minHeight` boxes with the RN default `flexShrink: 0` — so a sheet with no scroll region
 * does not shrink into the cap, it renders its tail BELOW the screen edge, untappable. A
 * landscape iPhone window is ~393pt, which is shorter than most of these sheets. Returns the
 * scroll regions rendered inside the sheet's own `<BottomSheet>` subtree.
 */
function sheetScrollRegions(src: string): number {
  const sheet = jsxElements(src).find((e) => e.tag === 'BottomSheet');
  if (!sheet) return 0;
  return (sheet.body.match(/<ScrollView\b|<FlatList\b/g) ?? []).length;
}

describe('the scroll-region rule detects the shape REG-003 removed', () => {
  it('counts only scroll regions INSIDE the sheet, and none when there are none', () => {
    expect(sheetScrollRegions('<BottomSheet>\n  <View><Text>x</Text></View>\n</BottomSheet>')).toBe(0);
    expect(sheetScrollRegions('<ScrollView/>\n<BottomSheet>\n  <Text>x</Text>\n</BottomSheet>')).toBe(0);
    expect(sheetScrollRegions('<BottomSheet>\n  <ScrollView><Text>x</Text></ScrollView>\n</BottomSheet>')).toBe(1);
  });
});

describe('the sheet set is derived from the tree', () => {
  it('finds every known sheet (a renamed/moved file cannot slip out of the guard)', () => {
    for (const s of EXPECTED_SHEETS) expect(SHEETS).toContain(s);
    expect(SHEETS.length).toBeGreaterThanOrEqual(EXPECTED_SHEETS.length);
  });
});

describe.each(SHEETS)('%s', (rel) => {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  it('renders through BottomSheet, not a raw Modal', () => {
    expect(src).toMatch(/<BottomSheet\b/);
    expect(src).not.toMatch(/<Modal\b/);
  });
  /**
   * TEST-008: the old check extracted a style named `card:` — `FilterSheet` and `ShareModal`
   * have no such key, so it asserted twice against `''`. Scan EVERY style object in the file
   * instead, with a self-check that the extractor found some.
   */
  it('does not hardcode the home-indicator inset or a max height in ANY of its styles', () => {
    const styles = styleObjects(src);
    expect(Object.keys(styles).length).toBeGreaterThan(0); // the extractor really ran
    expect(sheetStyleOffenders(src, styles)).toEqual([]);
  });
  it('gives its content a scroll region, so BottomSheet\'s pt cap scrolls instead of clipping (REG-003)', () => {
    expect(sheetScrollRegions(src)).toBeGreaterThanOrEqual(1);
  });
});
