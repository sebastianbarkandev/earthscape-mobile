/**
 * UI-009 / UI-011 / UI-012 guard: colours live in `src/common/theme.ts` and nowhere else
 * (CLAUDE.md rule 7 — "no invented colors"). Re-typed literals were the actual defect:
 * `#FFF` vs `theme.overlayText`, five copies of the modal backdrop, `#cc0000` for the
 * default graph line, and toolbar sensor swatches that disagreed with the bands they label.
 *
 * A. no hex / rgb(a) literal in any src or app source outside theme.ts
 * B. the sensor legend swatch is DERIVED from the band (one source of truth)
 * C. the tokens the call sites depend on exist and keep their meaning
 */
import * as fs from 'fs';
import * as path from 'path';
import { theme } from '../theme';
import { SENSOR_COLORS, compositeOverSurface, sensorColor, sensorSwatchColor } from '@/features/player/timeline/sensorBands';
import { ROOT, attrExpr, colorLiterals, pressables, rel, uiFiles, walkTsx } from './sourceScan';

/** Every source file (not just .tsx — StyleSheet-free helpers hold colours too). */
function walkSources(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkSources(p, out);
    else if (/\.tsx?$/.test(p)) out.push(p);
  }
  return out;
}

/**
 * Files allowed to hold a raw colour, with the reason. Keep this list empty-ish: a new
 * entry means a new colour outside the design system.
 */
const ALLOWED = new Set<string>([
  'src/common/theme.ts', // the token source itself
]);

describe('colour tokens', () => {
  it('A. no colour literal outside theme.ts', () => {
    const offenders: string[] = [];
    for (const f of walkSources(path.join(ROOT, 'src')).concat(walkSources(path.join(ROOT, 'app')))) {
      if (ALLOWED.has(rel(f))) continue;
      for (const { literal, line } of colorLiterals(fs.readFileSync(f, 'utf8'))) {
        offenders.push(`${rel(f)}:${line} ${literal}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('A2. the scanner sees the tokens it is supposed to police (self-check)', () => {
    const found = colorLiterals(fs.readFileSync(path.join(ROOT, 'src/common/theme.ts'), 'utf8'));
    expect(found.length).toBeGreaterThan(20);
    // .tsx walker is shared with the other guards — make sure it still finds the component tree.
    expect(walkTsx(path.join(ROOT, 'src')).length).toBeGreaterThan(20);
  });

  it('D3. the native module keeps exactly one literal, and depends on no app code', () => {
    // `modules/earthscape-live` is outside case A's roots on purpose (it is its own package).
    // The boundary is what makes the literal acceptable, so assert the boundary.
    const moduleRoot = path.join(ROOT, 'modules/earthscape-live');
    const files = walkSources(moduleRoot);
    expect(files.length).toBeGreaterThan(1);
    const literals = files.flatMap((f) => colorLiterals(fs.readFileSync(f, 'utf8')).map(({ literal }) => `${rel(f)} ${literal}`));
    expect(literals).toEqual([
      'modules/earthscape-live/src/EarthscapeLivePreviewView.tsx #000',
    ]);
    for (const f of files) {
      const src = fs.readFileSync(f, 'utf8');
      expect(src).not.toMatch(/from '@\//);
      expect(src).not.toMatch(/from '(\.\.\/)+src\//);
    }
  });

  it('C. the roles the call sites rely on exist and are distinct', () => {
    expect(theme.scrim).toMatch(/^rgba\(0,0,0,0\.45\)$/);
    expect(theme.overlayShadow).toMatch(/^rgba\(0,0,0,0\.8/);
    expect(theme.graphDefault.toUpperCase()).toBe(theme.tlPlayhead.toUpperCase());
    for (const t of ['overlayControl', 'overlayTrack', 'overlayField', 'overlayBorder', 'overlayHairline'] as const) {
      expect(theme[t]).toMatch(/^rgba\(255,255,255,0\./);
    }
    expect(new Set([theme.warning, theme.warningText, theme.successText]).size).toBe(3);
  });
});

describe('shape ladder and states (UI-014 / UI-019)', () => {
  it('D. no component re-derives a border radius off the ladder', () => {
    const offenders: string[] = [];
    for (const f of uiFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      for (const m of src.matchAll(/border(?:Top|Bottom)?(?:Left|Right)?Radius:\s*(\d+)/g)) {
        offenders.push(`${rel(f)}:${src.slice(0, m.index).split('\n').length} ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('D2. the ladder is the documented one plus the sub-20pt swatch step', () => {
    expect([theme.radiusXs, theme.radiusSm, theme.radiusMd, theme.radiusLg]).toEqual([3, 6, 12, 16]);
    expect(theme.radiusPill).toBeGreaterThanOrEqual(999); // also how circles are drawn
  });

  // UI-026: this used to read `site.styleText`, which the scanner captures GREEDILY (from
  // `style=` to the end of the attribute list). Every `disabled={busy}` written after `style`
  // therefore landed inside the text it was testing, so the check passed itself: 10 of the 12
  // disable-able Pressables matched on their own `disabled=` prop. Read the BALANCED style
  // expression instead — only a style that actually reacts to the state counts.
  it('E. every Pressable that can be disabled shows it (style or a busy spinner)', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of uiFiles()) {
      const src = fs.readFileSync(f, 'utf8');
      for (const site of pressables(f, src)) {
        if (!/disabled=\{/.test(site.attrs)) continue;
        checked++;
        if (!showsDisabledState(site)) offenders.push(`${rel(f)}:${site.line}`);
      }
    }
    expect(checked).toBeGreaterThan(8);
    expect(offenders).toEqual([]);
  });

  it('E3. UI-030: the state match is a whole identifier, not a substring of a style prop', () => {
    // `disabled={op.busy}` yields the identifier `op`, whose letters occur inside `opacity`:
    // a control with a STATIC opacity and no spinner looked identical enabled and disabled.
    const [sneaky] = pressables('x.tsx', '<Pressable disabled={op.busy} style={[styles.btn, { opacity: 1 }]} />');
    expect(sneaky.styleExpr).toContain('opacity');
    expect(showsDisabledState(sneaky)).toBe(false);
    // A style that really does react still passes, and so does a spinner swap.
    const [real] = pressables('x.tsx', '<Pressable disabled={op.busy} style={[styles.btn, op.busy && { opacity: 0.4 }]} />');
    expect(showsDisabledState(real)).toBe(true);
    const [spinner] = pressables('x.tsx', '<Pressable disabled={busy} style={styles.btn}><ActivityIndicator /></Pressable>');
    expect(showsDisabledState(spinner)).toBe(true);
  });

  it('E2. the guard reads the balanced style expression, not the greedy attribute tail', () => {
    // A Pressable whose style says nothing about the state, with `disabled` written AFTER it —
    // the exact shape that used to pass. `styleExpr` must not contain the `disabled` prop.
    const [site] = pressables('x.tsx', '<Pressable style={[styles.goLive, styles.stopBtn]} disabled={busy} accessibilityLabel="End" />');
    expect(site.styleExpr).toBe('[styles.goLive, styles.stopBtn]');
    expect(site.styleText).toContain('disabled={busy}');
  });
});

/**
 * Does a Pressable visibly react to its own `disabled` state? "Reacts" = the BALANCED style
 * expression names one of the identifiers the `disabled` prop is computed from (`busy &&
 * {opacity}`, `(!timeOk) && …`, a `styles.xDisabled` variant), or the body swaps in a spinner.
 * UI-030: the identifier must match as a WHOLE WORD — a plain `includes()` let `disabled={op.busy}`
 * pass on the letters of a static `opacity`.
 */
function showsDisabledState(site: { attrs: string; styleExpr: string; body: string }): boolean {
  const ids = [...(attrExpr(site.attrs, 'disabled') ?? '').matchAll(/[A-Za-z_$][\w$]*/g)].map((m) => m[0]);
  const reactsToState = ids.some((id) => id !== 'undefined' && new RegExp(`\\b${id}\\b`).test(site.styleExpr));
  return reactsToState || /ActivityIndicator/.test(site.body);
}

describe('sensor bands and their legend swatches (UI-009)', () => {
  it('B. every swatch is the band composited over the card — never a second hand-picked colour', () => {
    for (const v of [1, 2, 3]) {
      expect(sensorSwatchColor(v)).toBe(compositeOverSurface(sensorColor(v) as string));
    }
    expect(sensorSwatchColor(4)).toBeNull();
  });

  it('B2. the bands come from theme tokens and keep their identity (blue / red / yellow)', () => {
    expect(SENSOR_COLORS[1]).toBe(theme.sensorBand1);
    expect(SENSOR_COLORS[2]).toBe(theme.sensorBand2);
    expect(SENSOR_COLORS[3]).toBe(theme.sensorBand3);
    const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const [r1, g1, b1] = rgb(sensorSwatchColor(1) as string);
    expect(b1).toBeGreaterThan(r1); // sensor 1 reads blue
    expect(b1).toBeGreaterThanOrEqual(g1);
    const [r2, g2, b2] = rgb(sensorSwatchColor(2) as string);
    expect(r2).toBeGreaterThan(g2); // sensor 2 reads red
    expect(r2).toBeGreaterThan(b2);
    const [r3, g3, b3] = rgb(sensorSwatchColor(3) as string);
    expect(Math.min(r3, g3)).toBeGreaterThan(b3); // sensor 3 reads yellow
  });

  it('B3. compositing is alpha-correct and passes opaque colours through', () => {
    expect(compositeOverSurface('rgba(0,0,0,0.5)')).toBe('#808080');
    expect(compositeOverSurface('rgba(255,255,0,0.4)')).toBe('#FFFF99');
    expect(compositeOverSurface('#FFEAEA')).toBe('#FFEAEA');
    expect(compositeOverSurface('rgb(10,20,30)')).toBe('#0A141E');
    expect(compositeOverSurface('papayawhip')).toBe('papayawhip');
  });
});
