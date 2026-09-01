/**
 * Shared source-scanning helpers for the repo-wide UI guard tests (touch targets,
 * accessibility labels, colour tokens, icon glyph names). Not a test file itself —
 * jest only picks up `*.test.ts(x)`.
 *
 * These are deliberately regex-based: the repo writes one StyleSheet entry per line and
 * plain JSX, so a parser would buy nothing. Every scanner errs toward NOT reporting when
 * it cannot determine a value, so a guard failure always points at real source.
 */
import * as fs from 'fs';
import * as path from 'path';
import { touchSlop, verticalTouchSlop, type SlopBox } from '../touchTarget';

export const ROOT = path.resolve(__dirname, '../../..');

export function walkTsx(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkTsx(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Every component file that renders UI (src/ + the expo-router tree). */
export function uiFiles(): string[] {
  return [...walkTsx(path.join(ROOT, 'src')), ...walkTsx(path.join(ROOT, 'app'))];
}

export const rel = (p: string) => path.relative(ROOT, p);

/** `key: { ... }` entries of a StyleSheet.create block, keyed by name. */
export function styleObjects(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /^\s*([A-Za-z0-9_]+):\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}\s*,?\s*$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out[m[1]] = m[2];
  return out;
}

/** Numeric value of `prop:` inside a style body, or undefined. */
export function styleNumber(body: string, prop: string): number | undefined {
  const m = new RegExp(`(?:^|[\\s,{])${prop}:\\s*([0-9.]+)`).exec(body);
  return m ? parseFloat(m[1]) : undefined;
}

export interface PressableSite {
  file: string;
  line: number;
  /** Character offset of `<Pressable` in the source (lets a guard ask who encloses it). */
  index: number;
  attrs: string;
  body: string;
  /** Contains a <Text>/<ActivityIndicator> child — i.e. not an icon-only control. */
  hasText: boolean;
  hasIcon: boolean;
  /** Largest `<Icon size={n}>` in the body. */
  iconSize?: number;
  /** `styles.x` keys referenced by the style prop. */
  styleKeys: string[];
  /** Raw text of the style prop — GREEDY: everything from `style=` to the end of the attrs. */
  styleText: string;
  /** Just the balanced `style={…}` expression. Use this to ask what the style DOES. */
  styleExpr: string;
  /** VERTICAL hitSlop in pt/side; null when it is an expression this scanner cannot evaluate. */
  hitSlop: number | null;
  /** Per-side hitSlop; null when unevaluable. `hitSlop` is its vertical component. */
  slop: SlopBox | null;
}

/** The `{...}` expression of `prop=` in an attribute list, brace-aware. */
export function attrExpr(attrs: string, prop: string): string | undefined {
  const m = new RegExp(`\\b${prop}=\\{`).exec(attrs);
  if (!m) return undefined;
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < attrs.length) {
    if (attrs[i] === '{') depth++;
    else if (attrs[i] === '}') { depth--; if (depth === 0) return attrs.slice(start, i); }
    i++;
  }
  return undefined;
}

/** `hitSlop={…}` as a per-side box; null when the expression is not statically known. */
function parseSlop(attrs: string): SlopBox | null {
  const t = attrExpr(attrs, 'hitSlop')?.trim();
  if (t === undefined) return { top: 0, bottom: 0, left: 0, right: 0 };
  // TEST-014: CALL the helper under test rather than restating its arithmetic — a
  // `touchSlop` that returned a constant 4 used to leave this guard perfectly green.
  const vertical = /^verticalTouchSlop\((\d+)\)$/.exec(t);
  if (vertical) return verticalTouchSlop(Number(vertical[1]));
  const ts = /^touchSlop\((\d+)\)$/.exec(t);
  if (ts) {
    const v = touchSlop(Number(ts[1]));
    return { top: v, bottom: v, left: v, right: v };
  }
  if (/^\d+$/.test(t)) {
    const v = Number(t);
    return { top: v, bottom: v, left: v, right: v };
  }
  // `{{ top: 8, bottom: 8, left: 0, right: 0 }}` — every side must be a literal.
  if (/^\{[^{}]*\}$/.test(t)) {
    const side = (p: string) => styleNumber(t, p);
    const box = { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right') };
    if (Object.values(box).every((v) => v !== undefined)) return box as SlopBox;
  }
  return null;
}

/** Every `<Pressable …>` in a file, with the attributes and the body up to `</Pressable>`. */
export function pressables(file: string, src: string): PressableSite[] {
  const out: PressableSite[] = [];
  const re = /<Pressable\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + '<Pressable'.length;
    let depth = 0;
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { end = i; break; }
      i++;
    }
    if (end < 0) continue;
    const attrs = src.slice(m.index, end);
    const selfClose = src[end - 1] === '/';
    let body = '';
    if (!selfClose) {
      const close = src.indexOf('</Pressable>', end);
      body = close >= 0 ? src.slice(end, close) : src.slice(end, end + 400);
    }
    const iconSizes = [...body.matchAll(/<Icon\b[^>]*?size=\{(\d+)\}/gs)].map((x) => Number(x[1]));
    const styleText = (/style=(\{[\s\S]*)/.exec(attrs) ?? [])[1] ?? '';
    const styleExpr = attrExpr(attrs, 'style') ?? '';
    const slop = parseSlop(attrs);
    out.push({
      file,
      line: src.slice(0, m.index).split('\n').length,
      index: m.index,
      attrs,
      body,
      hasText: /<Text\b|<ActivityIndicator\b/.test(body),
      hasIcon: /<Icon\b/.test(body),
      iconSize: iconSizes.length ? Math.max(...iconSizes) : undefined,
      styleKeys: [...styleText.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]),
      styleText,
      styleExpr,
      hitSlop: slop === null ? null : Math.min(slop.top, slop.bottom),
      slop,
    });
  }
  return out;
}

/**
 * Lower bound on a Pressable's touchable box height, or undefined when the box is
 * layout-driven (flex / absolute fill / text-sized with no explicit height) and therefore
 * not the scanner's business.
 */
export function pressableBox(site: PressableSite, styles: Record<string, string>): number | undefined {
  let h: number | undefined;
  let pad: number | undefined;
  for (const k of site.styleKeys) {
    const b = styles[k];
    if (!b) continue;
    const hh = styleNumber(b, 'height') ?? styleNumber(b, 'minHeight');
    if (hh !== undefined) h = Math.max(h ?? 0, hh);
    const p = styleNumber(b, 'paddingVertical') ?? styleNumber(b, 'padding');
    if (p !== undefined) pad = Math.max(pad ?? 0, p);
    if (/flex:\s*1|absoluteFill/.test(b)) return undefined;
  }
  if (/flex:\s*1|absoluteFill/.test(site.styleText)) return undefined;
  const inline = styleNumber(site.styleText, 'height') ?? styleNumber(site.styleText, 'minHeight');
  if (inline !== undefined) h = Math.max(h ?? 0, inline);
  if (h !== undefined) return h;
  if (!site.hasText && site.iconSize !== undefined) return site.iconSize + 2 * (pad ?? 0);
  return undefined;
}

/**
 * Is the Pressable's box decided by something other than its own padding + font, so that
 * neither `pressableBox` nor `pressableTextBox` can bound it? Flex/absolute fill and
 * `aspectRatio` (ProgramStrip's 16:9 tiles) are sized by the parent; a Pressable holding a
 * flexible child (`<View style={{ flex: 1 }}>` wrapping wrapped paragraphs) is sized by it.
 */
export function isLayoutDriven(site: PressableSite, styles: Record<string, string>): boolean {
  if (/flex:\s*1|flexShrink|absoluteFill|aspectRatio/.test(site.styleText)) return true;
  if (site.styleKeys.some((k) => styles[k] && /flex:\s*1|absoluteFill|aspectRatio/.test(styles[k]))) return true;
  return /style=\{\{[^{}]*flex:\s*1/.test(site.body);
}

/** Line height RN gives a `fontSize`-pt glyph run when no explicit `lineHeight` is set. */
const TEXT_LINE_FACTOR = 1.3;
/** RN's default `fontSize` — used when a Pressable's label has none of its own. */
const DEFAULT_FONT_SIZE = 14;

/**
 * UI-022: the height a TEXT-sized Pressable actually gets — `fontSize · 1.3 + 2·paddingVertical`
 * from its own style plus the largest font among its labels. `pressableBox` deliberately
 * returns undefined for these (no explicit height), which is exactly the hole that let seven
 * ~26pt controls through the guard, so estimate instead of skipping.
 */
export function pressableTextBox(site: PressableSite, styles: Record<string, string>): number | undefined {
  if (!site.hasText) return undefined;
  let padTop: number | undefined;
  let padBottom: number | undefined;
  for (const b of [...site.styleKeys.map((k) => styles[k] ?? ''), site.styleText]) {
    const pv = styleNumber(b, 'paddingVertical') ?? styleNumber(b, 'padding');
    const pt = styleNumber(b, 'paddingTop') ?? pv;
    const pb = styleNumber(b, 'paddingBottom') ?? pv;
    if (pt !== undefined) padTop = Math.max(padTop ?? 0, pt);
    if (pb !== undefined) padBottom = Math.max(padBottom ?? 0, pb);
  }
  // Font sizes of the labels inside the body (their own StyleSheet entries, or inline).
  const keys = [...site.body.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]);
  const fonts = keys.map((k) => styleNumber(styles[k] ?? '', 'fontSize')).filter((n): n is number => n !== undefined);
  const inlineFonts = [...site.body.matchAll(/fontSize:\s*([0-9.]+)/g)].map((x) => parseFloat(x[1]));
  const found = [...fonts, ...inlineFonts];
  const font = found.length ? Math.max(...found) : DEFAULT_FONT_SIZE;
  return Math.ceil(font * TEXT_LINE_FACTOR) + (padTop ?? 0) + (padBottom ?? 0);
}

/** Vertical padding a style body contributes above / below its children. */
export function verticalPadding(body: string): { top: number; bottom: number } {
  const pv = styleNumber(body, 'paddingVertical') ?? styleNumber(body, 'padding');
  return {
    top: styleNumber(body, 'paddingTop') ?? pv ?? 0,
    bottom: styleNumber(body, 'paddingBottom') ?? pv ?? 0,
  };
}

/** Colour literals (hex or rgb/rgba) in a source file, with line numbers. */
export function colorLiterals(src: string): Array<{ literal: string; line: number }> {
  const out: Array<{ literal: string; line: number }> = [];
  const re = /#[0-9A-Fa-f]{3,8}\b|rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(?:,\s*[\d.]+\s*)?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push({ literal: m[0], line: src.slice(0, m.index).split('\n').length });
  return out;
}

export interface JsxElement {
  tag: string;
  attrs: string;
  /** Everything between the opening and the matching closing tag ('' when self-closing). */
  body: string;
  line: number;
  /** Character offset of `<Tag` in the source. */
  start: number;
  /** Character offsets bounding `body` (equal when self-closing). */
  bodyStart: number;
  bodyEnd: number;
}

/**
 * Every `<Capitalised …>` JSX element in a file, with its attributes and its subtree.
 * Brace-aware (so `style={{...}}` / arrow props don't end the tag early) and nesting-aware
 * for the closing tag, which is what lets a guard ask "does THIS box contain a Text?".
 */
export function jsxElements(src: string): JsxElement[] {
  const out: JsxElement[] = [];
  const re = /<([A-Z][A-Za-z0-9_.]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const tag = m[1];
    let i = m.index + m[0].length;
    let depth = 0;
    let end = -1;
    while (i < src.length) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) { end = i; break; }
      i++;
    }
    if (end < 0) continue;
    let body = '';
    let bodyStart = end + 1;
    let bodyEnd = end + 1;
    if (src[end - 1] !== '/') {
      const tagRe = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
      tagRe.lastIndex = end + 1;
      let open = 1;
      let close = src.length;
      let t: RegExpExecArray | null;
      while ((t = tagRe.exec(src))) {
        if (t[0][1] === '/') { open--; if (open === 0) { close = t.index; break; } continue; }
        // A self-closing nested tag (`<View … />`) opens nothing — counting it made the body
        // swallow the rest of the file and reported phantom children.
        if (!selfClosing(src, t.index + t[0].length)) open++;
      }
      body = src.slice(end + 1, close);
      bodyEnd = close;
    }
    out.push({ tag, attrs: src.slice(m.index, end), body, line: src.slice(0, m.index).split('\n').length, start: m.index, bodyStart, bodyEnd });
  }
  return out;
}

/** Does the tag whose attributes start at `i` end in `/>`? Brace-aware. */
function selfClosing(src: string, i: number): boolean {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0) return src[i - 1] === '/';
    i++;
  }
  return false;
}

/** `styles.x` keys referenced by an element's `style=` prop. */
export function styleKeysOfElement(attrs: string): string[] {
  const styleText = (/style=(\{[\s\S]*)/.exec(attrs) ?? [])[1] ?? '';
  return [...styleText.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]);
}

/** Innermost element whose body contains `index` (ignoring the element that starts there). */
function innermostContaining(els: JsxElement[], index: number): JsxElement | undefined {
  let best: JsxElement | undefined;
  for (const e of els) {
    if (e.start === index) continue;
    if (e.bodyStart <= index && index < e.bodyEnd) {
      if (!best || e.bodyEnd - e.bodyStart < best.bodyEnd - best.bodyStart) best = e;
    }
  }
  return best;
}

/** All `styles.x` bodies referenced by an element's `style=` / `contentContainerStyle=`. */
function elementStyleBodies(el: JsxElement, styles: Record<string, string>): string[] {
  const keys = [
    ...styleKeysOfElement(el.attrs),
    ...[...el.attrs.matchAll(/contentContainerStyle=\{?\[?\s*styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]),
    // `<BottomSheet cardStyle={styles.card}>`: BottomSheet applies it to the card view that
    // lays the sheet's children out, so its padding and gap are this container's (UI-024).
    ...[...el.attrs.matchAll(/cardStyle=\{?\[?\s*styles\.([A-Za-z0-9_]+)/g)].map((x) => x[1]),
  ];
  return keys.map((k) => styles[k] ?? '').filter(Boolean);
}

/**
 * UI-023: a `hitSlop` that reaches outside an enclosing horizontal `ScrollView` is dead —
 * `ScrollView` sets `overflow: 'scroll'` on itself, which RN turns into `clipsToBounds = YES`,
 * and `RCTView.m` only descends into subviews when the point is inside a clipping view. So a
 * control in a scroll strip can never be taller than the strip's frame, however much slop it
 * declares. Returns the vertical room the strip gives this control: the contentContainer's
 * vertical padding plus the padding of every container between it and the Pressable.
 */
export function scrollStripRoom(
  site: PressableSite,
  src: string,
  styles: Record<string, string>,
  els: JsxElement[] = jsxElements(src),
): { padding: number; line: number } | undefined {
  const strips = els.filter((e) => e.tag === 'ScrollView' && /\bhorizontal\b/.test(e.attrs));
  const strip = strips
    .filter((e) => e.bodyStart <= site.index && site.index < e.bodyEnd)
    .sort((a, b) => a.bodyEnd - a.bodyStart - (b.bodyEnd - b.bodyStart))[0];
  if (!strip) return undefined;
  let padding = 0;
  for (const body of elementStyleBodies(strip, styles)) {
    const p = verticalPadding(body);
    padding = Math.max(padding, p.top + p.bottom);
  }
  // Containers between the strip and the Pressable add their own vertical padding to the frame.
  for (const e of els) {
    if (e.start === site.index) continue;
    if (e.start <= strip.bodyStart || e.bodyEnd > strip.bodyEnd) continue;
    if (!(e.bodyStart <= site.index && site.index < e.bodyEnd)) continue;
    for (const body of elementStyleBodies(e, styles)) {
      const p = verticalPadding(body);
      padding += p.top + p.bottom;
    }
  }
  return { padding, line: strip.line };
}

/** Tags that lay children out (everything else may be a generic or a custom component). */
const CONTAINER_TAGS = /^(View|ScrollView|SafeAreaView|KeyboardAvoidingView|Animated\.View|Pressable|Modal|BottomSheet)$/;

/**
 * UI-024 (2nd pass): ranges of `.map(` callbacks. A `<Pressable>` written ONCE inside one is
 * rendered N times at runtime, so its runtime neighbours are copies of ITSELF — the dominant
 * dense-row pattern in this repo, and the reason a check that needed two SOURCE sites in one
 * container saw six overlapping rows as single children and skipped them.
 */
export function mapCallRanges(src: string): Array<{ start: number; end: number }> {
  const out: Array<{ start: number; end: number }> = [];
  const re = /\.map\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    if (depth === 0) out.push({ start: m.index, end: i });
  }
  return out;
}

/** Source span of every locally declared capitalised function (i.e. a component). */
export function componentRanges(src: string): Array<{ name: string; start: number; end: number }> {
  const starts: Array<{ name: string; start: number }> = [];
  const re = /^\s*(?:export\s+)?(?:default\s+)?(?:function\s+([A-Z][A-Za-z0-9_]*)|const\s+([A-Z][A-Za-z0-9_]*)\s*(?::[^=]*)?=\s*(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) starts.push({ name: m[1] ?? m[2], start: m.index });
  return starts.map((h, i) => ({ ...h, end: i + 1 < starts.length ? starts[i + 1].start : src.length }));
}

/**
 * UI-024 (2nd pass): the `<Pressable>` a local WRAPPER component renders (`Chip`, `TimeChip`,
 * `Tab`, `Btn`, `Act`…), keyed by component name. The row that lays the instances out is in a
 * different function from the Pressable itself, which was the other half of the blind spot:
 * `<Chip/> <Chip/>` looked like two non-Pressable children. The FIRST Pressable of the
 * component is the one the row positions (the outermost control of its first branch).
 */
export function wrapperPressables(src: string, sites: PressableSite[]): Record<string, PressableSite> {
  const out: Record<string, PressableSite> = {};
  for (const c of componentRanges(src)) {
    const inside = sites.filter((s) => s.index > c.start && s.index < c.end).sort((a, b) => a.index - b.index);
    if (!inside.length) continue;
    // ONLY when the Pressable is the component's ROOT element. If the wrapper returns a View
    // that happens to contain a Pressable (`Row`'s edit pen, `TimeField`'s Playhead), the
    // control sits somewhere inside a full-width box, so pairing instances of it against each
    // other models geometry that does not exist — the guard must not invent overlaps.
    const root = /<[A-Z][A-Za-z0-9_.]*/.exec(src.slice(c.start, c.end));
    if (!root || c.start + root.index !== inside[0].index) continue;
    out[c.name] = inside[0];
  }
  return out;
}

/** One child of a sibling group: the Pressable that ends up in the tree, and how it got there. */
export interface SiblingChild {
  site: PressableSite;
  /** Where the child appears INSIDE the container (the wrapper element's offset, if any). */
  index: number;
  /** Wrapper component the container writes, when the Pressable lives in another function. */
  via?: string;
  /** Rendered N times by a `.map(` inside the container — its neighbour is a copy of itself. */
  repeated: boolean;
}

export interface SiblingGroup {
  file: string;
  containerTag: string;
  containerLine: number;
  /** true when the container lays its children out horizontally. */
  row: boolean;
  /** UI-028: `flexWrap: 'wrap'` — once a row wraps, children also become VERTICAL neighbours. */
  wrap: boolean;
  gap: number;
  /** Gap between wrapped lines (`rowGap`, else `gap`). Only meaningful when `wrap`. */
  rowGap: number;
  children: SiblingChild[];
  /** Source distance flags: a flex spacer between two siblings makes the gap unbounded. */
  spacerBefore: boolean[];
}

/**
 * UI-024: Pressables that end up as children of the same container, in source order — the
 * sibling set whose slop-inflated hit frames RN resolves back-to-front, so an overlap means
 * the later one steals the earlier one's presses. Children come from three shapes: a
 * `<Pressable>` written inline, a `<Pressable>` written once inside a `.map(` (counted as its
 * own neighbour), and a local wrapper component that renders one.
 */
export function pressableSiblingGroups(
  file: string,
  src: string,
  styles: Record<string, string>,
  sites: PressableSite[] = pressables(file, src),
): SiblingGroup[] {
  // Only real layout containers: `<Foo>` also matches TS generics (`useState<Quality>(…)`),
  // and such a phantom "container" spans half the file and pairs unrelated controls.
  const all = jsxElements(src);
  const els = all.filter((e) => CONTAINER_TAGS.test(e.tag));
  const maps = mapCallRanges(src);
  const wrappers = wrapperPressables(src, sites);
  const repeatedIn = (container: JsxElement, index: number) =>
    maps.some((r) => r.start >= container.bodyStart && r.start < index && index < r.end);

  const groups = new Map<number, { el: JsxElement; children: SiblingChild[] }>();
  const add = (el: JsxElement | undefined, child: SiblingChild) => {
    if (!el) return;
    const g = groups.get(el.start) ?? { el, children: [] };
    g.children.push(child);
    groups.set(el.start, g);
  };
  for (const site of sites) {
    const el = innermostContaining(els, site.index);
    if (el) add(el, { site, index: site.index, repeated: repeatedIn(el, site.index) });
  }
  for (const e of all) {
    const site = wrappers[e.tag];
    // A wrapper's own `<Pressable>` is already counted as an inline child of whatever encloses
    // it inside the wrapper function; here we count the INSTANCES the container writes.
    if (!site || rel(file) !== rel(site.file)) continue;
    const el = innermostContaining(els, e.start);
    if (!el || el.start === site.index) continue;
    if (site.index >= el.bodyStart && site.index < el.bodyEnd) continue; // the declaration itself
    add(el, { site, index: e.start, via: e.tag, repeated: repeatedIn(el, e.start) });
  }

  const out: SiblingGroup[] = [];
  for (const { el, children } of groups.values()) {
    const ordered = [...children].sort((a, b) => a.index - b.index);
    if (ordered.length < 2 && !ordered.some((c) => c.repeated)) continue;
    const bodies = elementStyleBodies(el, styles);
    const row = /\bhorizontal\b/.test(el.attrs) || bodies.some((b) => /flexDirection:\s*'row'/.test(b));
    const wrap = bodies.some((b) => /flexWrap:\s*'wrap'/.test(b));
    let gap = 0;
    let rowGap = 0;
    for (const b of bodies) {
      const g = styleNumber(b, 'gap') ?? 0;
      const axis = (row ? styleNumber(b, 'columnGap') : styleNumber(b, 'rowGap')) ?? 0;
      gap = Math.max(gap, g, axis);
      rowGap = Math.max(rowGap, styleNumber(b, 'rowGap') ?? g);
    }
    const spacerBefore = ordered.map((c, i) => {
      if (i === 0) return false;
      const prev = ordered[i - 1];
      const between = src.slice(prev.index, c.index);
      const betweenStyles = [...between.matchAll(/styles\.([A-Za-z0-9_]+)/g)].map((x) => styles[x[1]] ?? '');
      return /flex:\s*1|flexGrow|margin(?:Left|Top):\s*'auto'/.test([between, ...betweenStyles].join('\n'));
    });
    out.push({ file, containerTag: el.tag, containerLine: el.line, row, wrap, gap, rowGap, children: ordered, spacerBefore });
  }
  return out;
}

/** A Pressable's own margin along `axis`, in pt (RN adds it on both sides of the child). */
export function siteMargin(site: PressableSite, styles: Record<string, string>, row: boolean): number {
  let margin = 0;
  for (const b of [...site.styleKeys.map((k) => styles[k] ?? ''), site.styleText]) {
    const m = styleNumber(b, row ? 'marginHorizontal' : 'marginVertical') ?? styleNumber(b, 'margin');
    const a = row ? styleNumber(b, 'marginRight') : styleNumber(b, 'marginBottom');
    const c = row ? styleNumber(b, 'marginLeft') : styleNumber(b, 'marginTop');
    margin = Math.max(margin, m ?? 0, a ?? 0, c ?? 0);
  }
  return margin;
}
