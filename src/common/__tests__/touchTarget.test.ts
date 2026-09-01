/**
 * UI-007 / UI-008 guards.
 *
 * A. `touchSlop` maths (src/common/touchTarget.ts).
 * B. Every `<Pressable>` whose box the scanner can measure ends up with a >= 44pt
 *    touchable area (box + 2·hitSlop). The dense chrome ports the web's 10–36pt boxes,
 *    so the slop is what makes them tappable — it may never be a guessed 4.
 * C. Every icon-only `<Pressable>` (a FontAwesome glyph carries no text) declares
 *    accessibilityRole + accessibilityLabel, or VoiceOver announces "button" and nothing else.
 * D. UI-022: every TEXT-sized `<Pressable>` too — a box made of `paddingVertical` + a 12pt
 *    font is ~26pt and used to be invisible to B, which skipped every unmeasurable box.
 * E. UI-023: a control inside a horizontal `ScrollView` cannot be taller than the strip's
 *    frame, so its 44pt must come from real height + contentContainer padding, not slop.
 * F. UI-024: sibling controls' hit rects may not overlap — RN hit-tests siblings back to
 *    front, so an overlap means the later one silently steals the earlier one's presses.
 *    Second pass: a `<Pressable>` written ONCE inside a `.map(` is laid out against a copy of
 *    itself, and a control rendered through a local WRAPPER component (`Chip`, `TimeChip`,
 *    `Tab`, `Btn`) is paired through the instances the row writes — those two shapes are how
 *    six overlapping rows stayed invisible to the first pass.
 * G. UI-028: in a `flexWrap` container the neighbour relation FLIPS once the row wraps — the
 *    control below is a vertical neighbour, so vertical slop overlaps it by `2·slop − rowGap`.
 *    Wrapping rows therefore carry a real 44pt box and no slop (the ClipmarkSheet rule).
 *
 * Remaining blind spot of E, F and G: a control rendered by a wrapper IMPORTED from another
 * file (`VideoCard`, `EmptyState`) cannot be paired — the scanner resolves wrappers declared in
 * the same file only. B and D still hold every one of them to the 44pt height.
 */
import * as fs from 'fs';
import { MIN_TOUCH, effectiveTouchSize, layoutTouchSpans, overlappingTouchSpans, touchInterval, touchSlop, verticalTouchSlop } from '../touchTarget';
import { isLayoutDriven, pressableBox, pressableSiblingGroups, pressableTextBox, pressables, rel, scrollStripRoom, siteMargin, styleObjects, uiFiles, type PressableSite } from './sourceScan';

describe('touchSlop', () => {
  it('grows a dense box to the 44pt HIG minimum', () => {
    expect(touchSlop(44)).toBe(0);
    expect(touchSlop(36)).toBe(4);
    expect(touchSlop(30)).toBe(7);
    expect(touchSlop(26)).toBe(9);
    expect(touchSlop(11)).toBe(17);
    for (const box of [10, 11, 12, 13, 16, 22, 26, 30, 32, 34, 36, 40, 44, 52]) {
      expect(effectiveTouchSize(box, touchSlop(box))).toBeGreaterThanOrEqual(MIN_TOUCH);
    }
  });
  it('never returns a negative slop, and degenerate boxes get the full half-minimum', () => {
    expect(touchSlop(80)).toBe(0);
    expect(touchSlop(0)).toBe(22);
    expect(touchSlop(NaN)).toBe(22);
  });
});

const SITES = uiFiles().flatMap((f) => {
  const src = fs.readFileSync(f, 'utf8');
  const styles = styleObjects(src);
  return pressables(f, src).map((site) => ({ site, box: pressableBox(site, styles) }));
});

/**
 * UI-030: a `hitSlop` the scanner cannot evaluate used to SKIP the site, so hoisting the
 * number into a constant (`hitSlop={SLOP}`, a computed side object) silenced the whole 44pt
 * policy for that control. An unreadable slop is now an offender in its own right.
 */
function touchTargetOffender(site: PressableSite, box: number): string | null {
  if (site.hitSlop === null) {
    return `${rel(site.file)}:${site.line} box=${box} hitSlop is not statically readable — declare it with touchSlop()/verticalTouchSlop() or a literal`;
  }
  return effectiveTouchSize(box, site.hitSlop) < MIN_TOUCH ? `${rel(site.file)}:${site.line} box=${box} slop=${site.hitSlop}` : null;
}

describe('repo-wide Pressable touch targets', () => {
  it('scans a meaningful number of controls (the scanner itself is not silently broken)', () => {
    expect(SITES.length).toBeGreaterThan(60);
    expect(SITES.filter((s) => s.box !== undefined).length).toBeGreaterThan(40);
    // TEST-014: hold the scanner's REACH, not just an absolute count — a wave of `flex: 1`
    // controls would otherwise shrink what the guard measures without failing anything.
    const measured = SITES.filter((s) => s.box !== undefined).length;
    expect(measured / SITES.length).toBeGreaterThan(0.75);
  });

  /**
   * TEST-014: the scanner used to RE-IMPLEMENT the slop arithmetic
   * (`Math.ceil((44 - box) / 2)`) from the literal argument, so the repo-wide guard would
   * have stayed green against a `touchSlop` that returned a constant 4 — the very "guessed 4"
   * its own docstring forbids. It now calls the helper; this pins that it still does.
   */
  it('derives each site slop from the real touchSlop/verticalTouchSlop, not a restatement', () => {
    for (const box of [11, 26, 30, 36, 44, 52]) {
      const [v] = pressables('x.tsx', `<Pressable style={styles.chip} hitSlop={verticalTouchSlop(${box})} />`);
      expect(v.slop).toEqual(verticalTouchSlop(box));
      expect(v.hitSlop).toBe(touchSlop(box));
      const [a] = pressables('x.tsx', `<Pressable style={styles.chip} hitSlop={touchSlop(${box})} />`);
      expect(a.slop).toEqual({ top: touchSlop(box), bottom: touchSlop(box), left: touchSlop(box), right: touchSlop(box) });
    }
    // And every real site in the tree that declares a helper slop agrees with the helper.
    let checked = 0;
    for (const { site } of SITES) {
      const m = /hitSlop=\{(verticalTouchSlop|touchSlop)\((\d+)\)\}/.exec(site.attrs);
      if (!m) continue;
      checked++;
      expect(site.hitSlop).toBe(touchSlop(Number(m[2])));
    }
    expect(checked).toBeGreaterThan(20);
  });

  it('every measurable Pressable is at least 44pt tall including hitSlop', () => {
    const offenders = SITES.flatMap(({ site, box }) => (box === undefined ? [] : [touchTargetOffender(site, box)])).filter(
      (o): o is string => o !== null,
    );
    expect(offenders).toEqual([]);
  });

  it('UI-030: a hitSlop the scanner cannot read is reported instead of exempting the control', () => {
    const [site] = pressables('x.tsx', '<Pressable style={styles.chip} hitSlop={SLOP}><Text style={styles.chipText}>x</Text></Pressable>');
    expect(site.hitSlop).toBeNull();
    expect(touchTargetOffender(site, 28)).toMatch(/not statically readable/);
    const [computed] = pressables('x.tsx', '<Pressable style={styles.chip} hitSlop={{ top: v, bottom: v, left: 0, right: 0 }} />');
    expect(computed.hitSlop).toBeNull();
    expect(touchTargetOffender(computed, 28)).toMatch(/not statically readable/);
    // A slop the scanner CAN read still passes/fails on the geometry alone.
    const [ok] = pressables('x.tsx', '<Pressable style={styles.chip} hitSlop={verticalTouchSlop(30)} />');
    expect(touchTargetOffender(ok, 30)).toBeNull();
  });
});

describe('repo-wide icon-only Pressable accessibility', () => {
  it('every icon-only Pressable names itself for VoiceOver', () => {
    const offenders = SITES.filter(({ site }) => site.hasIcon && !site.hasText && !(/accessibilityLabel/.test(site.attrs) && /accessibilityRole/.test(site.attrs))).map(
      ({ site }) => `${rel(site.file)}:${site.line}`,
    );
    expect(offenders).toEqual([]);
  });
});

const FILES = uiFiles().map((f) => {
  const src = fs.readFileSync(f, 'utf8');
  const styles = styleObjects(src);
  return { file: f, src, styles, sites: pressables(f, src) };
});

/** The height the scanner credits a control with: measured, else estimated from its label. */
const boxOf = (site: Parameters<typeof pressableBox>[0], styles: Record<string, string>) =>
  pressableBox(site, styles) ?? pressableTextBox(site, styles);

/**
 * The ONE deliberate deviation from the 44pt policy, and why. Keyed by file + the style key
 * of the control, so it survives line moves; the test asserts the list is exactly this, so
 * adding an exception is a visible edit rather than a silent regression.
 */
const TOUCH_TARGET_EXCEPTIONS: Array<{ file: string; styleKey: string; reason: string }> = [
  {
    file: 'src/features/player/components/panel/TranscriptPanel.tsx',
    styleKey: 'word',
    reason: 'transcript words are prose that seeks; a 44pt box per word triples the panel and breaks reading',
  },
];

const exempt = (site: { file: string; styleKeys: string[] }) =>
  TOUCH_TARGET_EXCEPTIONS.some((e) => rel(site.file) === e.file && site.styleKeys.includes(e.styleKey));

describe('UI-022 text-sized Pressables', () => {
  it('has exactly one documented exception, and it still exists', () => {
    expect(TOUCH_TARGET_EXCEPTIONS.map((e) => `${e.file}#${e.styleKey}`)).toEqual([
      'src/features/player/components/panel/TranscriptPanel.tsx#word',
    ]);
    const hits = FILES.flatMap(({ sites }) => sites.filter((s) => exempt(s)));
    expect(hits).toHaveLength(1);
  });

  it('estimates a text box from its font and padding', () => {
    // `paddingVertical: 6` + a 12pt label = 6 + 16 + 6 = 28pt, nowhere near 44.
    expect(pressableTextBox({ hasText: true, styleKeys: ['chip'], styleText: '{styles.chip}', body: '<Text style={styles.chipText}>x</Text>' } as never, {
      chip: 'paddingVertical: 6, paddingHorizontal: 12',
      chipText: 'fontSize: 12',
    })).toBe(28);
  });

  it('every text-sized Pressable is 44pt tall too (box or estimate + hitSlop)', () => {
    const offenders: string[] = [];
    for (const { styles, sites } of FILES) {
      for (const site of sites) {
        if (isLayoutDriven(site, styles) || exempt(site)) continue;
        // A wrapper around `{children}` / composed components has no label of its own to
        // size it from — nothing to assert. Leaf controls (a Text and/or an Icon) do.
        if (!site.hasText && !site.hasIcon) continue;
        const box = boxOf(site, styles);
        if (box === undefined) {
          offenders.push(`${rel(site.file)}:${site.line} box=? (unmeasurable and no explicit height)`);
          continue;
        }
        const bad = touchTargetOffender(site, box);
        if (bad) offenders.push(bad);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('UI-023 controls inside a horizontal ScrollView', () => {
  it('gets its 44pt from the strip frame, not from slop that the strip clips away', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const { src, styles, sites } of FILES) {
      for (const site of sites) {
        const room = scrollStripRoom(site, src, styles);
        if (!room) continue;
        const box = boxOf(site, styles);
        if (box === undefined) continue;
        checked++;
        if (box + room.padding < MIN_TOUCH) {
          offenders.push(`${rel(site.file)}:${site.line} box=${box} stripPadding=${room.padding} (strip at :${room.line})`);
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
    expect(offenders).toEqual([]);
  });
});

describe('UI-024 sibling hit rects', () => {
  it('models a row of dense controls and finds the stolen taps', () => {
    // EventsPanel before the fix: 12pt pen + 13pt ✕, gap 12, symmetric touchSlop => overlap.
    const bad = layoutTouchSpans(
      [
        { name: 'edit', box: 12, before: touchSlop(12), after: touchSlop(12) },
        { name: 'delete', box: 13, before: touchSlop(13), after: touchSlop(13) },
      ],
      12,
    );
    expect(overlappingTouchSpans(bad)).toEqual([{ a: 'edit', b: 'delete', overlap: 20 }]);
    // A 32pt box with slop 6 exactly meets the 12pt gap: touching edges, no overlap.
    const good = layoutTouchSpans(
      [
        { name: 'edit', box: 32, before: 6, after: 6 },
        { name: 'delete', box: 32, before: 6, after: 6 },
      ],
      12,
    );
    expect(overlappingTouchSpans(good)).toEqual([]);
    expect(touchInterval(good[1])).toEqual([38, 82]);
    // Vertical-only slop cannot reach a horizontal neighbour at all.
    expect(verticalTouchSlop(36)).toEqual({ top: 4, bottom: 4, left: 0, right: 0 });
  });

  it('models a `.map()`-rendered control against a copy of itself (the pairing hole)', () => {
    // TimelineToolbar before the fix: two 63pt segments, symmetric slop 9, container gap 0.
    const spans = layoutTouchSpans(
      [
        { name: 'scrub', box: 63, before: 9, after: 9 },
        { name: 'clip', box: 63, before: 9, after: 9 },
      ],
      0,
    );
    expect(overlappingTouchSpans(spans)).toEqual([{ a: 'scrub', b: 'clip', overlap: 18 }]);
    // UI-028: the same slop across a wrapped row — 24pt chips, vertical slop 10, rowGap 6.
    const wrapped = layoutTouchSpans(
      [
        { name: 'start (row above)', box: 24, before: 10, after: 10 },
        { name: 'end (row below)', box: 24, before: 10, after: 10 },
      ],
      6,
    );
    expect(overlappingTouchSpans(wrapped)).toEqual([{ a: 'start (row above)', b: 'end (row below)', overlap: 14 }]);
  });

  it('sees the shapes the first pass missed: a mapped Pressable and a wrapper component', () => {
    const src = `
function Row() {
  return (
    <View style={styles.strip}>
      {items.map((t) => (
        <Pressable key={t} style={styles.seg} hitSlop={touchSlop(26)}><Text style={styles.segText}>{t}</Text></Pressable>
      ))}
    </View>
  );
}

function Bar() {
  return (
    <View style={styles.bar}>
      <Chip label="a" />
      <Chip label="b" />
    </View>
  );
}

function Chip({ label }: { label: string }) {
  return <Pressable style={styles.chip} hitSlop={touchSlop(30)}><Text style={styles.chipText}>{label}</Text></Pressable>;
}
`;
    const styles = {
      strip: "flexDirection: 'row', gap: 0",
      seg: 'minHeight: 26',
      segText: 'fontSize: 11',
      bar: "flexDirection: 'row', gap: 4",
      chip: 'minHeight: 30',
      chipText: 'fontSize: 12',
    };
    const groups = pressableSiblingGroups('x.tsx', src, styles);
    const mapped = groups.find((g) => g.children.some((c) => c.repeated));
    expect(mapped?.children).toHaveLength(1);
    expect(mapped?.children[0].repeated).toBe(true);
    const viaWrapper = groups.find((g) => g.children.every((c) => c.via === 'Chip'));
    expect(viaWrapper?.children).toHaveLength(2);
    expect(viaWrapper?.children[0].site.line).toBe(viaWrapper?.children[1].site.line);
  });

  it('no two sibling Pressables in the tree have overlapping touch rects', () => {
    const offenders = new Set<string>();
    let groups = 0;
    let mapped = 0;
    let wrapped = 0;
    for (const { file, src, styles, sites } of FILES) {
      for (const g of pressableSiblingGroups(file, src, styles, sites)) {
        const measured = g.children.map((c, i) => ({
          c,
          i,
          box: boxOf(c.site, styles) ?? 0,
          slop: c.site.slop,
          name: `${rel(c.site.file)}:${c.site.line}${c.via ? ` <${c.via}>` : ''}`,
        }));
        if (measured.some((m) => m.box === 0)) continue;
        groups++;
        if (measured.some((m) => m.c.repeated)) mapped++;
        const where = `${g.containerTag} at ${rel(g.file)}:${g.containerLine}`;
        // Main axis: the order the container lays the children out. A `.map()`-rendered child
        // is laid out against a copy of itself — at runtime that copy is its real neighbour.
        const items: Parameters<typeof layoutTouchSpans>[0] = [];
        for (const m of measured) {
          const side = g.row ? [m.slop?.left, m.slop?.right] : [m.slop?.top, m.slop?.bottom];
          const base = { name: m.name, box: m.box, before: side[0] ?? 0, after: side[1] ?? 0, margin: siteMargin(m.c.site, styles, g.row) };
          // A flex spacer / `margin*: 'auto'` between two siblings pushes them apart by an
          // unknown amount — never an overlap, so model it as far away.
          items.push({ ...base, gapBefore: g.spacerBefore[m.i] ? 10000 : undefined });
          if (m.c.repeated) items.push({ ...base, name: `${m.name} (repeat)` });
        }
        for (const o of overlappingTouchSpans(layoutTouchSpans(items, g.gap))) {
          offenders.add(`${o.a} + ${o.b} overlap ${o.overlap}pt (${where}, gap=${g.gap})`);
        }
        // G / UI-028: once a wrapping row wraps, ANY two of its children can end up one above
        // the other, so the vertical slop meets `rowGap` instead of a horizontal neighbour.
        if (!g.wrap) continue;
        wrapped++;
        for (const a of measured) {
          for (const b of measured) {
            if (a === b && !a.c.repeated) continue;
            const spans = layoutTouchSpans(
              [a, b].map((m, k) => ({
                name: `${m.name} (${k === 0 ? 'row above' : 'row below'})`,
                box: m.box,
                before: m.slop?.top ?? 0,
                after: m.slop?.bottom ?? 0,
                margin: siteMargin(m.c.site, styles, false),
              })),
              g.rowGap,
            );
            for (const o of overlappingTouchSpans(spans)) {
              offenders.add(`${o.a} + ${o.b} overlap ${o.overlap}pt across wrapped rows (${where}, rowGap=${g.rowGap})`);
            }
          }
        }
      }
    }
    expect(groups).toBeGreaterThan(10);
    // The two shapes this pass added must actually be exercised by the real tree.
    expect(mapped).toBeGreaterThan(3);
    expect(wrapped).toBeGreaterThan(1);
    expect([...offenders]).toEqual([]);
  });
});
