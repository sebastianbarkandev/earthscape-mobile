/**
 * RESP-019: horizontal safe-area insets. `orientation: "default"` means every screen can be
 * landscape, where iOS reports `insets.left/right ≈ 47–59pt`; app-drawn chrome that hugs the
 * screen edge must be padded out of that strip or it is clipped and partly untappable.
 * (The tab bar and the native stack header handle it themselves; these files do not.)
 */
import * as fs from 'fs';
import * as path from 'path';
import { edgePadding } from '../layout';
import { jsxElements, styleObjects } from './sourceScan';

const ROOT = path.resolve(__dirname, '../../..');

/** App-drawn chrome that reaches the left/right screen edge. */
const EDGE_CHROME = [
  'src/common/components/AppHeader.tsx',
  'src/common/components/BottomSheet.tsx',
  'src/features/player/components/PlayerControls.tsx',
  'src/features/library/LibraryScreen.tsx',
  'src/features/library/LiveListScreen.tsx',
  'src/features/search/SearchScreen.tsx',
];

describe('edgePadding', () => {
  it('portrait (no side insets) keeps the designed spacing', () => {
    expect(edgePadding({ left: 0, right: 0 }, 12)).toEqual({ paddingLeft: 12, paddingRight: 12 });
    expect(edgePadding({}, 6)).toEqual({ paddingLeft: 6, paddingRight: 6 });
  });
  it('landscape iPhone: the cut-out strip is cleared on both sides', () => {
    expect(edgePadding({ left: 59, right: 59 }, 8)).toEqual({ paddingLeft: 59, paddingRight: 59 });
    expect(edgePadding({ left: 47, right: 47 }, 6)).toEqual({ paddingLeft: 47, paddingRight: 47 });
  });
  it('asymmetric / bogus insets never shrink below the floor and never produce NaN', () => {
    expect(edgePadding({ left: 59, right: 0 }, 8)).toEqual({ paddingLeft: 59, paddingRight: 8 });
    expect(edgePadding({ left: Number.NaN, right: -10 }, 8)).toEqual({ paddingLeft: 8, paddingRight: 8 });
  });
});

describe('edge chrome consumes the horizontal insets', () => {
  it.each(EDGE_CHROME)('%s pads from the safe-area insets', (f) => {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    expect(src).toMatch(/useSafeAreaInsets/);
    // TEST-013: not just "mentions edgePadding" — the padding must be fed the HOOK's insets
    // and must reach a `style=` prop, either inline or through a named local.
    const calls = [...src.matchAll(/(?:const\s+([A-Za-z0-9_]+)\s*=\s*)?edgePadding\(\s*([A-Za-z0-9_.]+)/g)];
    // Every call takes the hook's insets, never a literal or a stale copy.
    const args = calls.map((m) => m[2]);
    expect(args.length).toBeGreaterThan(0);
    expect(args.every((a) => a === 'insets')).toBe(true);
    // The result is applied: inline inside a `style=`/`contentContainerStyle=` prop, or via a
    // local that one of those props then names.
    const styled = jsxElements(src).filter((e) => /(?:style|contentContainerStyle|cardStyle)=/.test(e.attrs));
    const locals = calls.map((m) => m[1]).filter((n): n is string => !!n);
    const appliedInline = styled.some((e) => /edgePadding\(/.test(e.attrs));
    const appliedViaLocal = locals.some((n) => styled.some((e) => new RegExp(`\\b${n}\\b`).test(e.attrs)));
    expect(appliedInline || appliedViaLocal).toBe(true);
  });

  /**
   * TEST-013: FlightMap's own assertion used to be `expect(src).toMatch(/insets\.right/)` —
   * presence, not application. It is now a RENDER assertion in
   * `src/features/player/components/__tests__/FlightMap.test.tsx`
   * ("RESP-019: the overlays clear the landscape cut-out"), which flattens the overlay
   * containers' styles at insets {left:59,right:59} and at zero. All that is left here is the
   * structural half: whatever expression it uses must CONSUME the inset, not just name it.
   */
  it('FlightMap pins its own controls / track label away from the pane edge', () => {
    const src = fs.readFileSync(path.join(ROOT, 'src/features/player/components/FlightMap.tsx'), 'utf8');
    expect(src).toMatch(/useSafeAreaInsets/);
    // The value has to reach a style prop of a rendered element, not merely be read.
    for (const side of ['right', 'left'] as const) {
      const applied = jsxElements(src).filter(
        (e) => /style=/.test(e.attrs) && new RegExp(`${side}:[\\s\\S]{0,40}insets\\.${side}\\b`).test(e.attrs),
      );
      expect(applied.length).toBeGreaterThan(0);
    }
  });
});

/**
 * RESP-019 (2nd pass) — the sweep above is a per-file "does this file mention edgePadding"
 * check, which is why two Live-tab banner rows and the Search summary were added later and
 * kept a hardcoded 12pt gutter. This is the structural guard: in a screen that spans the
 * whole window, an element at the TOP of the tree (the root or one of its direct children)
 * that draws its own horizontal gutter is by definition edge-hugging, so its gutter must
 * come from `edgePadding(insets, …)`. Deeper elements sit inside a padded parent and are
 * none of this guard's business.
 */
const FULL_WIDTH_SCREENS = [
  'src/common/components/AppHeader.tsx',
  'src/features/library/LibraryScreen.tsx',
  'src/features/library/LiveListScreen.tsx',
  'src/features/search/SearchScreen.tsx',
  'src/features/auth/LoginScreen.tsx',
  'src/features/player/PlayerScreen.tsx',
];
/** Only real layout tags: `<Foo>` also matches a TS generic, whose phantom body spans the file. */
const LAYOUT_TAGS = /^(View|ScrollView|SafeAreaView|KeyboardAvoidingView|Animated\.View|Pressable|Modal|FlatList|Text|TextInput)$/;
/** A gutter the element draws itself (a literal, so `edgePadding`'s own output is not one). */
const OWN_GUTTER = /(^|[\s,{])(padding|paddingHorizontal|paddingLeft|paddingRight|margin|marginHorizontal|marginLeft|marginRight):\s*\d/;

describe('top-level chrome takes its horizontal gutter from the safe area', () => {
  it('no edge-hugging row draws its own hardcoded gutter', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of FULL_WIDTH_SCREENS) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const styles = styleObjects(src);
      const els = jsxElements(src).filter((e) => LAYOUT_TAGS.test(e.tag));
      for (const el of els) {
        // Depth 0 = the screen root, 1 = a direct child of it. Both reach the screen edge.
        const depth = els.filter((e) => e.start !== el.start && e.bodyStart <= el.start && el.start < e.bodyEnd).length;
        if (depth > 1) continue;
        const keys = [...el.attrs.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]);
        const gutter = keys.filter((k) => styles[k] && OWN_GUTTER.test(styles[k]));
        if (!gutter.length) continue;
        checked++;
        if (!/edgePadding\(/.test(el.attrs)) offenders.push(`${f}:${el.line} <${el.tag} styles.${gutter.join('+')}>`);
      }
    }
    // Sanity: the scan must actually be finding the rows it is meant to police.
    expect(checked).toBeGreaterThanOrEqual(6);
    expect(offenders).toEqual([]);
  });

  it('detects the shape it is meant to detect (LiveListScreen before the fix)', () => {
    const src = [
      'const x = (',
      '  <View style={styles.screen}>',
      '    <View style={styles.goLiveRow}><Pressable /></View>',
      '  </View>',
      ');',
      'const styles = StyleSheet.create({',
      '  screen: { flex: 1 },',
      '  goLiveRow: { flexDirection: \'row\', margin: 12, padding: 12 },',
      '});',
    ].join('\n');
    const styles = styleObjects(src);
    const row = jsxElements(src).filter((e) => LAYOUT_TAGS.test(e.tag)).find((e) => /goLiveRow/.test(e.attrs))!;
    expect(OWN_GUTTER.test(styles.goLiveRow)).toBe(true);
    expect(/edgePadding\(/.test(row.attrs)).toBe(false);
    // …and the fixed shape passes.
    expect(/edgePadding\(/.test('<View style={[styles.goLiveRow, edgePadding(insets, 12)]}>')).toBe(true);
  });
});
