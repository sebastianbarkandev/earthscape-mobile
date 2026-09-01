/**
 * RESP-005 / RESP-020 Dynamic Type policy guard (source scan; see src/common/typography.ts).
 *  A1. No style object may pin a fixed `height` on something that also sets text metrics
 *      (`fontSize` / `lineHeight`): at AX sizes the glyphs overflow the box. Use `minHeight`.
 *  A2. STRUCTURAL (RESP-020): no fixed-`height` box may contain UNCAPPED text. A1 only ever
 *      saw the degenerate case where the height and the font sat in the same style object;
 *      real chrome puts `height: 40` on the row and the `fontSize` on a sibling style, so ~30
 *      live offenders (header rows, chips, tabs, share buttons, search pills, field rows)
 *      passed A1 while clipping their labels at AX3. A box is compliant when it either grows
 *      (`minHeight`) or every `<Text>` / `<TextInput>` in its subtree is capped
 *      (`{...denseText}` / `maxFontSizeMultiplier`, or `allowFontScaling={false}` for a glyph
 *      used as an icon).
 *  B.  Dense-chrome files adopt the policy (`denseText`) so their labels are capped at 1.3×.
 *  C.  The footer tab bar labels go through TabLabel (capped, single line) instead of
 *      `tabBarLabelStyle` inside React Navigation's fixed-height bar.
 * Touch-target sizes and colour tokens are guarded elsewhere (touchTarget.test.ts,
 * themeTokens.test.ts) — this file only owns text scaling.
 */
import * as fs from 'fs';
import * as path from 'path';
import { ROOT, jsxElements, rel, styleKeysOfElement, styleNumber, styleObjects, uiFiles } from './sourceScan';

const FILES = uiFiles();
/** Tags that lay their children out in a row (case D). */
const ROW_TAGS = /^(View|Animated\.View|ScrollView)$/;
/** `el`'s subtree with every nested horizontal ScrollView blanked out (case D). */
function maskStrips(el: { body: string; bodyStart: number }, strips: Array<{ bodyStart: number; bodyEnd: number; start: number }>, src: string): string {
  let out = el.body;
  for (const sv of strips) {
    if (sv.start <= el.bodyStart || sv.bodyEnd > el.bodyStart + el.body.length) continue;
    const from = sv.start - el.bodyStart;
    const to = sv.bodyEnd - el.bodyStart;
    out = out.slice(0, from) + ' '.repeat(Math.max(0, to - from)) + out.slice(to);
  }
  return out;
}
/** A cap on the element itself: the dense policy, an explicit multiplier, or an icon glyph. */
const CAPPED = /maxFontSizeMultiplier|\.\.\.denseText|allowFontScaling/;

describe('Dynamic Type policy', () => {
  it('A1. no fixed-height text style (height + fontSize/lineHeight in one object)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes('StyleSheet.create')) continue;
      const styles = styleObjects(src);
      for (const [key, body] of Object.entries(styles)) {
        const fixedHeight = /(^|[\s,{])height:\s*\d+/.test(body);
        const textMetrics = /\b(fontSize|lineHeight):/.test(body);
        if (fixedHeight && textMetrics) offenders.push(`${rel(f)} → ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('A2. no fixed-height box holds uncapped text (the box must grow, or the text must be capped)', () => {
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes('StyleSheet.create')) continue;
      const styles = styleObjects(src);
      for (const el of jsxElements(src)) {
        const boxed = styleKeysOfElement(el.attrs).filter((k) => styles[k] !== undefined && styleNumber(styles[k], 'height') !== undefined);
        if (!boxed.length) continue;
        const texts = [el, ...jsxElements(el.body)].filter((x) => x.tag === 'Text' || x.tag === 'TextInput');
        const uncapped = texts.filter((t) => !CAPPED.test(t.attrs));
        if (uncapped.length) {
          offenders.push(`${rel(f)}:${el.line} <${el.tag} styles.${boxed.join('+')}> holds ${uncapped.length} uncapped ${uncapped[0].tag}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('A2 detects the pattern it is meant to detect (height on the row, fontSize on the label)', () => {
    // The exact shape that slipped past A1 in 13 files, as a fixture.
    const src = [
      'const x = (',
      '  <Pressable style={styles.tab}>',
      '    <Text style={styles.tabText}>Details</Text>',
      '  </Pressable>',
      ');',
      'const styles = StyleSheet.create({',
      "  tab: { paddingHorizontal: 12, height: 32, borderRadius: 6 },",
      '  tabText: { fontSize: 13, fontWeight: \'700\' },',
      '});',
    ].join('\n');
    const styles = styleObjects(src);
    expect(/(^|[\s,{])height:\s*\d+/.test(styles.tab) && /fontSize/.test(styles.tab)).toBe(false); // A1 is blind
    const el = jsxElements(src).find((e) => e.tag === 'Pressable')!;
    const boxed = styleKeysOfElement(el.attrs).filter((k) => styleNumber(styles[k] ?? '', 'height') !== undefined);
    const texts = jsxElements(el.body).filter((t) => t.tag === 'Text');
    expect(boxed).toEqual(['tab']);
    expect(texts.filter((t) => !CAPPED.test(t.attrs))).toHaveLength(1); // A2 sees it
    // …and the two compliant shapes are accepted.
    expect(CAPPED.test('<Text {...denseText} style={styles.tabText}>')).toBe(true);
    expect(styleNumber('{ paddingHorizontal: 12, minHeight: 32 }', 'height')).toBeUndefined();
  });

  /**
   * TEST-016: B used to be `expect(/denseText/.test(src) && /\{\.\.\.denseText\}/.test(src))`
   * over a frozen file list — it proved the token was spread SOMEWHERE in each file, so a
   * single label losing its cap was invisible, and a new dense component never joined. B is
   * now three things: a tree-derived set of adopting files, the historical list asserted to
   * be a SUBSET of it (so a file cannot silently drop the policy), and B2 — the per-label
   * property, scanned repo-wide.
   */
  it('B. dense-chrome components cap their labels with denseText', () => {
    /** Files that adopt the policy, derived from the tree. */
    const adopting = FILES.filter((f) => {
      const src = fs.readFileSync(f, 'utf8');
      return /denseText|DENSE_MAX_FONT_SCALE/.test(src) && /\{\.\.\.denseText\}|maxFontSizeMultiplier=/.test(src);
    }).map((f) => rel(f).split(path.sep).join('/'));
    // Every historically migrated file still adopts it (the list is a floor, not the scope).
    const DENSE = [
      'src/features/player/components/PlayerControls.tsx',
      'src/features/player/components/timeline/TimelineToolbar.tsx',
      'src/features/player/components/panel/SidePanel.tsx',
      'src/features/player/components/ActionRow.tsx',
      'src/features/player/components/FlightMap.tsx',
      'src/features/broadcast/GoLiveScreen.tsx',
      'src/common/components/LiveBadge.tsx',
      'src/common/components/TabLabel.tsx',
      // RESP-020: migrated from fixed `height` boxes to minHeight + the capped policy.
      'src/common/components/AppHeader.tsx',
      // RESP-028: the sort strip's chips + result count.
      'src/features/library/LibraryScreen.tsx',
      'src/features/library/LiveListScreen.tsx',
      'src/features/search/SearchScreen.tsx',
      'src/features/search/FilterSheet.tsx',
      'src/features/player/components/info/InfoCard.tsx',
      'src/features/player/components/timeline/MetadataWell.tsx',
      'src/features/player/components/timeline/ClipmarkSheet.tsx',
      'src/features/player/components/share/ShareModal.tsx',
      'src/features/player/components/share/PublicShareTab.tsx',
      'src/features/player/components/panel/EventsPanel.tsx',
      'src/features/player/components/panel/TranscriptPanel.tsx',
      'src/features/player/components/panel/TakChatPanel.tsx',
      'src/features/player/components/panel/DrawingsPanel.tsx',
    ];
    for (const f of DENSE) expect({ file: f, adopts: adopting.includes(f) }).toEqual({ file: f, adopts: true });
    expect(adopting.length).toBeGreaterThanOrEqual(DENSE.length);
  });

  /**
   * TEST-016 (B2): the per-LABEL property. Once a `styles.x` text style is capped anywhere in
   * a file it is a dense style, so every `<Text>`/`<TextInput>` using it must be capped too —
   * which is exactly what a copy-pasted new label, or one label losing its `{...denseText}`,
   * breaks. Repo-wide; no file list.
   */
  it('B2. no label reuses a capped text style without the cap', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of FILES) {
      const src = fs.readFileSync(f, 'utf8');
      const texts = jsxElements(src).filter((e) => e.tag === 'Text' || e.tag === 'TextInput');
      const cappedKeys = new Set<string>();
      for (const t of texts) if (CAPPED.test(t.attrs)) for (const k of styleKeysOfElement(t.attrs)) cappedKeys.add(k);
      for (const t of texts) {
        const keys = styleKeysOfElement(t.attrs);
        if (!keys.some((k) => cappedKeys.has(k))) continue;
        checked++;
        if (!CAPPED.test(t.attrs)) offenders.push(`${rel(f)}:${t.line} <${t.tag} styles.${keys.join('+')}> reuses a capped style uncapped`);
      }
    }
    // Self-check: the scan reaches a real share of the dense chrome, not two labels.
    expect(checked).toBeGreaterThan(20);
    expect(offenders).toEqual([]);
  });

  it('B2 detects the shape it forbids (a sibling label written without the spread)', () => {
    const bad = [
      '<View>',
      '  <Text {...denseText} style={styles.ctlText}>1x</Text>',
      '  <Text style={styles.ctlText}>Live</Text>',
      '</View>',
    ].join('\n');
    const texts = jsxElements(bad).filter((e) => e.tag === 'Text');
    const cappedKeys = new Set(texts.filter((t) => CAPPED.test(t.attrs)).flatMap((t) => styleKeysOfElement(t.attrs)));
    expect([...cappedKeys]).toEqual(['ctlText']);
    expect(texts.filter((t) => styleKeysOfElement(t.attrs).some((k) => cappedKeys.has(k)) && !CAPPED.test(t.attrs))).toHaveLength(1);
  });

  it('D. a variable-length row of controls can scroll (or wrap) instead of overflowing', () => {
    // RESP-028: LibraryScreen's sort row was a rigid `flexDirection: 'row'` holding a mapped
    // list of chips — nothing could wrap, shrink or scroll, so the last chip walked off the
    // right edge at AX3 (and the count already did at iPad Split View's 320pt). Every other
    // dense strip in the app is a horizontal ScrollView or wraps; this is the guard for it.
    const offenders: string[] = [];
    for (const f of FILES) {
      const src = fs.readFileSync(f, 'utf8');
      if (!src.includes('StyleSheet.create')) continue;
      const styles = styleObjects(src);
      const els = jsxElements(src).filter((e) => ROW_TAGS.test(e.tag));
      const strips = els.filter((e) => e.tag === 'ScrollView' && /\bhorizontal\b/.test(e.attrs));
      for (const el of els) {
        if (strips.some((sv) => sv.start === el.start)) continue; // the strip itself is fine
        if (strips.some((sv) => sv.bodyStart <= el.start && el.start < sv.bodyEnd)) continue; // inside one
        const bodies = [...el.attrs.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => styles[x[1]] ?? '');
        if (!(/\bhorizontal\b/.test(el.attrs) || bodies.some((b) => /flexDirection:\s*'row'/.test(b)))) continue;
        if (bodies.some((b) => /flexWrap/.test(b))) continue; // wraps -> bounded
        // Ignore the parts of the row that a nested horizontal strip already takes care of.
        const rigid = maskStrips(el, strips, src);
        if (/flex:\s*1/.test(rigid)) continue; // a flexible child absorbs the width
        if (/\.map\(/.test(rigid) && /<Pressable\b/.test(rigid)) {
          offenders.push(`${rel(f)}:${el.line} <${el.tag}> maps controls into a rigid row`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('C. tab bar labels render through TabLabel, not a scaled style in a fixed bar', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/(tabs)/_layout.tsx'), 'utf8');
    expect(src).toMatch(/TabLabel/);
    expect(src).not.toMatch(/tabBarLabelStyle/);
  });
});
