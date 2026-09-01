/**
 * UI-021: the FontAwesome6 typings are `any`, so glyph names are not compile-checked —
 * `<Icon name="chevron-donw" />` renders an invisible tofu square and nothing complains.
 * This test scans every icon name literal in the app (Icon `name=`, the `icon=` props of
 * the local button wrappers, and `icon: '…'` table entries) and asserts it exists in the
 * FontAwesome 6 **Free / solid** glyphmap — the style `Icon` renders with (`iconStyle="solid"`).
 */
import * as fs from 'fs';
import * as path from 'path';
import { ROOT, rel, uiFiles } from './sourceScan';

const META = path.join(ROOT, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/FontAwesome6Free_meta.json');
const GLYPHS = path.join(ROOT, 'node_modules/@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/FontAwesome6Free.json');

const meta = JSON.parse(fs.readFileSync(META, 'utf8')) as { solid: string[]; regular: string[]; brands: string[] };
const glyphmap = JSON.parse(fs.readFileSync(GLYPHS, 'utf8')) as Record<string, number>;
const solid = new Set(meta.solid);

/**
 * String literals in a JSX expression, minus the operands of `===`/`!==` comparisons:
 * `name={t === 'scrub' ? 'hand-pointer' : 'crop-simple'}` yields the two glyph names, not 'scrub'.
 */
function resultLiterals(expr: string): string[] {
  const stripped = expr.replace(/[!=]==?\s*'[^']*'/g, '').replace(/'[^']*'\s*[!=]==?/g, '');
  return [...stripped.matchAll(/'([^']*)'/g)].map((m) => m[1]);
}

function namesIn(src: string): string[] {
  const out: string[] = [];
  const attr = (raw: string, quoted?: string, expr?: string) => {
    if (quoted !== undefined) out.push(quoted);
    else if (expr !== undefined) out.push(...resultLiterals(expr));
  };
  for (const m of src.matchAll(/<Icon\b([^>]*?)\/?>/gs)) {
    const nm = /\bname=("([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})/.exec(m[1]);
    if (nm) attr(nm[1], nm[2], nm[3]);
  }
  // The local wrappers (Btn / Ctl / ActionButton / Act / Chip / TabBtn) take `icon: IconName`.
  for (const m of src.matchAll(/\bicon=("([^"]*)"|\{((?:[^{}]|\{[^{}]*\})*)\})/g)) attr(m[1], m[2], m[3]);
  for (const m of src.matchAll(/\bicon:\s*'([^']*)'/g)) out.push(m[1]);
  return out;
}

const FILES = [...uiFiles(), path.join(ROOT, 'src/features/player/timeline/clipmarkUtils.ts')];
const USED = new Map<string, string>();
for (const f of FILES) {
  if (!fs.existsSync(f)) continue;
  for (const n of namesIn(fs.readFileSync(f, 'utf8'))) if (!USED.has(n)) USED.set(n, rel(f));
}

describe('FontAwesome 6 glyph names', () => {
  it('the glyphmap the test checks against is the one the app ships', () => {
    expect(Object.keys(glyphmap).length).toBeGreaterThan(1000);
    expect(solid.size).toBeGreaterThan(1000);
    expect(solid.has('xmark')).toBe(true);
    expect(solid.has('not-a-real-glyph')).toBe(false);
  });

  it('scans the whole component tree (the scanner is not silently matching nothing)', () => {
    expect(USED.size).toBeGreaterThan(40);
    expect([...USED.keys()]).toContain('xmark');
  });

  it('every icon name used in the app exists in the FA6-Free solid set', () => {
    const bad = [...USED].filter(([name]) => !solid.has(name)).map(([name, file]) => {
      const where = meta.brands.includes(name) ? 'brands-only' : meta.regular.includes(name) ? 'regular-only' : 'not in FA6 Free';
      return `${file}: "${name}" (${where})`;
    });
    expect(bad).toEqual([]);
  });

  it('and is in the glyphmap the native font is subset from', () => {
    const missing = [...USED.keys()].filter((n) => glyphmap[n] === undefined);
    expect(missing).toEqual([]);
  });
});
