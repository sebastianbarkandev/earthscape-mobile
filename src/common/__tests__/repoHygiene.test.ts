/**
 * SEC-014 (TEST-005). `.gitignore` had an UNANCHORED `ios/`, which excluded
 * `modules/earthscape-live/ios/*.swift` — the entire SRT publisher — as well as the
 * generated top-level `ios/` build tree. The fix was one character (`/ios/`); nothing kept
 * it that way, and the failure only ever surfaces as a native build error on someone
 * else's clone.
 *
 * These assertions are about the repo, not about `src/`, so they read the files/git index
 * directly rather than a module.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { ROOT } from './sourceScan';

/** Non-comment, non-blank patterns of .gitignore, with line numbers. */
function ignorePatterns(): Array<{ line: number; pattern: string }> {
  const src = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  return src
    .split('\n')
    .map((raw, i) => ({ line: i + 1, pattern: raw.trim() }))
    .filter((p) => p.pattern.length > 0 && !p.pattern.startsWith('#'));
}

/** Is `p` tracked-or-ignorable by git? Throws (exit 1) when the path is NOT ignored. */
function isIgnored(p: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', p], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Native-module sources that MUST reach a clone. Derived by walking `modules/`, so a second
 * local module (or an Android one) joins the guard automatically.
 */
function nativeModuleSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'build' || e.name === 'Pods') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(swift|m|mm|h|kt|java|podspec)$/.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  const modules = path.join(ROOT, 'modules');
  if (fs.existsSync(modules)) walk(modules);
  return out;
}

/** Platform directory names that exist INSIDE a local module — those are the ones at risk. */
function moduleplatformDirs(): Set<string> {
  const out = new Set<string>();
  const modules = path.join(ROOT, 'modules');
  if (!fs.existsSync(modules)) return out;
  for (const mod of fs.readdirSync(modules, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    for (const e of fs.readdirSync(path.join(modules, mod.name), { withFileTypes: true })) {
      if (e.isDirectory()) out.add(e.name);
    }
  }
  return out;
}

/**
 * Unanchored patterns that would match a platform directory a local module owns. Extracted so
 * the check itself can be shown to detect the pre-fix shape (the `.gitignore` in the tree is
 * the negative case; a fixture is the positive one).
 */
function unanchoredOffenders(patterns: Array<{ line: number; pattern: string }>, owned: Set<string>): string[] {
  return patterns
    // A pattern naming such a dir with no leading `/` matches at ANY depth — including
    // `modules/<mod>/<dir>/`, which is where the native sources live.
    .filter(({ pattern }) => {
      if (pattern.startsWith('#')) return false;
      const name = pattern.replace(/^[*/]+/, '').replace(/\/$/, '');
      return owned.has(name) && !pattern.startsWith('/');
    })
    .map(({ line, pattern }) => `.gitignore:${line} '${pattern}' matches at any depth — anchor it as '/${pattern.replace(/^[*/]+/, '')}'`);
}

describe('SEC-014 .gitignore never swallows a native module', () => {
  it('no platform directory that a local module owns is ignored at any depth', () => {
    const owned = moduleplatformDirs();
    // Self-check: the walker sees the module's own platform dir, so this cannot pass vacuously.
    expect([...owned]).toContain('ios');
    expect(unanchoredOffenders(ignorePatterns(), owned)).toEqual([]);
    // Self-check: the anchored form is actually present, so this is not passing on an empty file.
    expect(ignorePatterns().map((p) => p.pattern)).toContain('/ios/');
  });

  it('the pattern check detects the shape the fix removed (positive detection)', () => {
    const owned = new Set(['ios', 'android']);
    // The exact pre-SEC-014 line, and the two other ways of writing it.
    for (const bad of ['ios/', 'ios', '**/ios/', '*/ios']) {
      expect(unanchoredOffenders([{ line: 3, pattern: bad }], owned)).toHaveLength(1);
    }
    // The anchored forms, and a dir no module owns, are not offenders.
    for (const ok of ['/ios/', '/ios', 'dist/', 'coverage/', '*.log', '# ios/']) {
      expect(unanchoredOffenders([{ line: 3, pattern: ok }], owned)).toEqual([]);
    }
  });

  it('git does not ignore any native module source', () => {
    const sources = nativeModuleSources();
    // Self-check: the walker found the SRT publisher, so an empty scan cannot pass.
    expect(sources).toContain(path.join('modules', 'earthscape-live', 'ios', 'LivePublisher.swift'));
    expect(sources.length).toBeGreaterThan(3);
    expect(sources.filter(isIgnored)).toEqual([]);
  });

  it('the generated top-level ios/ tree IS still ignored (the anchor did not disable it)', () => {
    expect(isIgnored('ios/Podfile')).toBe(true);
    expect(isIgnored('ios/Earthscape/Info.plist')).toBe(true);
  });
});
