/**
 * Regression tests for the R1 security review (SEC-001/002/006/007/008): every
 * assertion here failed (or was untested) before the corresponding fix.
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseId } from '../routeParams';
import { ROOT, rel, walkTsx } from './sourceScan';
import { safeFilename, downloadToCache } from '../media';
import { sanitizeGraphData } from '../sanitizeGraphData';
import graphReducer, { appendGraphs } from '@/features/player/graphSlice';

jest.mock('expo-file-system', () => ({
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  downloadAsync: jest.fn(async (_url: string, target: string) => ({ uri: target, status: 200, headers: {} })),
  deleteAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('expo-media-library', () => ({ requestPermissionsAsync: jest.fn(), saveToLibraryAsync: jest.fn() }));

type ConfigModule = typeof import('../config');
function loadConfig(): ConfigModule {
  let mod!: ConfigModule;
  jest.isolateModules(() => {
    mod = require('../config') as ConfigModule;
  });
  return mod;
}

describe('SEC-001 deep-link id validation (parseId)', () => {
  it('accepts plain positive integers', () => {
    expect(parseId('42')).toBe(42);
    expect(parseId(['7', '8'])).toBe(7);
  });
  it('rejects path traversal, query injection and non-numeric input', () => {
    for (const bad of ['../signout', '6?x=1', '6/../../signout', '../../../signout?x=', '1.json', '1e3', '', ' ', '0', '-1', 'abc', '1 2', '6#x', '%2e%2e', '1234567890123']) {
      expect(parseId(bad)).toBeNull();
    }
    expect(parseId(undefined)).toBeNull();
    expect(parseId(null)).toBeNull();
  });
});

describe('SEC-002 org subdomain validation', () => {
  it('rejects anything that is not one RFC 1123 label and leaves the current org unchanged', () => {
    const config = loadConfig();
    expect(config.setSubdomain('demo')).toBe(true);
    for (const bad of ['evil.com/', 'evil.example/#', 'a:b', 'x y', 'x?y', '', '   ', '-bad', 'bad-', 'ünï', 'a.b', 'a/b', '@', 'a'.repeat(64)]) {
      expect(config.setSubdomain(bad)).toBe(false);
      expect(config.getSubdomain()).toBe('demo');
      expect(config.getApiHost()).toBe('http://demo.earthscape.localdocker');
    }
  });
  it('normalises case/whitespace and accepts hyphenated labels', () => {
    const config = loadConfig();
    expect(config.setSubdomain('  Stage-ACL-2 ')).toBe(true);
    expect(config.getSubdomain()).toBe('stage-acl-2');
    expect(config.normalizeSubdomain('DEMO')).toBe('demo');
    expect(config.normalizeSubdomain('Evil.com/')).toBeNull();
    expect(config.normalizeSubdomain(null)).toBeNull();
    expect(config.setSubdomain('a'.repeat(63))).toBe(true);
  });
  it('can forget a bad persisted org', () => {
    const config = loadConfig();
    config.setSubdomain('demo');
    config.clearSubdomain();
    expect(config.isHostConfigured()).toBe(false);
    expect(config.getApiHost()).toBe('');
  });
});

/**
 * SEC-001 is a CALL-SITE discipline (CLAUDE.md: "route ids only via
 * `src/common/routeParams.ts` `parseId`"), and `parseId` itself being well tested says
 * nothing about a fourth route. expo-router URL-DECODES segments, so
 * `earthscape:///clip/..%2F..%2Fsignout` interpolated straight into an API path drives an
 * authenticated request at an arbitrary org-host path. This is the repo-wide guard (TEST-015).
 */
describe('SEC-001 every route id goes through parseId', () => {
  /** Names destructured from `useLocalSearchParams()` in a file. */
  function routeParamNames(src: string): string[] {
    const out: string[] = [];
    for (const m of src.matchAll(/const\s*\{([^}]*)\}\s*=\s*useLocalSearchParams/g)) {
      for (const raw of m[1].split(',')) {
        const name = raw.split(':')[0].trim();
        if (/^[A-Za-z_$][\w$]*$/.test(name)) out.push(name);
      }
    }
    return out;
  }

  /** A param whose value is an id — i.e. must never reach an API path unvalidated. */
  const isIdParam = (n: string) => /(^id|Id)$/.test(n);

  /** Params in `src` that are ids but never appear inside a `parseId(` argument. */
  function unvalidatedIdParams(src: string): string[] {
    const validated = new Set(
      [...src.matchAll(/parseId\(\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]),
    );
    return routeParamNames(src).filter((n) => isIdParam(n) && !validated.has(n));
  }

  it('no route file interpolates a raw id param', () => {
    const offenders: string[] = [];
    let checked = 0;
    for (const f of walkTsx(path.join(ROOT, 'app'))) {
      const src = fs.readFileSync(f, 'utf8');
      if (!/useLocalSearchParams/.test(src)) continue;
      const ids = routeParamNames(src).filter(isIdParam);
      checked += ids.length;
      for (const bad of unvalidatedIdParams(src)) offenders.push(`${rel(f)} '${bad}' is not passed through parseId()`);
    }
    // Self-check: the scan really found the id params it is meant to police
    // (video/[eventId].tsx: eventId + videoId; golive.tsx: eventId).
    expect(checked).toBeGreaterThanOrEqual(3);
    expect(offenders).toEqual([]);
  });

  it('detects the shape it forbids (a new route that skips parseId)', () => {
    const bad = "const { clipId, q } = useLocalSearchParams<{ clipId: string }>();\nreturn <Clip id={clipId} />;";
    expect(unvalidatedIdParams(bad)).toEqual(['clipId']);
    // Renaming while destructuring does not hide it either.
    const renamed = "const { id: videoId } = useLocalSearchParams();\nreturn <V id={videoId} />;";
    expect(unvalidatedIdParams(renamed)).toEqual(['id']);
    // The validated shape passes; non-id params are none of this guard's business.
    const good = "const { clipId, q } = useLocalSearchParams();\nconst id = parseId(clipId);";
    expect(unvalidatedIdParams(good)).toEqual([]);
  });
});

describe('SEC-006 absolute http:// media URLs in https builds', () => {
  it('upgrades http:// to https:// when the build is not insecure', () => {
    const { normalizeMediaScheme } = loadConfig();
    expect(normalizeMediaScheme('http://cdn.198-51-100-9.nip.io/x.m3u8', false)).toBe('https://cdn.198-51-100-9.nip.io/x.m3u8');
    expect(normalizeMediaScheme('https://d1.cloudfront.net/x.m3u8', false)).toBe('https://d1.cloudfront.net/x.m3u8');
  });
  it('passes http:// through in insecure (dev) builds', () => {
    const config = loadConfig();
    expect(config.normalizeMediaScheme('http://cdn/x.m3u8', true)).toBe('http://cdn/x.m3u8');
    // Default jest build is __DEV__ → insecure, so resolveMediaUrl keeps http here (pinned by config.test.ts too).
    config.setSubdomain('demo');
    expect(config.resolveMediaUrl('http://example.com/a.mp4')).toBe('http://example.com/a.mp4');
  });

  /**
   * TEST-002: every media URL in the app goes through `resolveMediaUrl`, not
   * `normalizeMediaScheme` — so unwiring the upgrade hop was invisible to the two tests
   * above (the default jest build is `__DEV__` → insecure, where the two branches agree).
   * These drive the REAL call path in the build mode that actually ships.
   */
  describe('the shipped https build, driven through resolveMediaUrl', () => {
    /** Loads config with the env of an https (stage/prod) build — `insecure` is read at import. */
    function loadHttpsConfig(): ConfigModule {
      const saved = { i: process.env.EXPO_PUBLIC_API_INSECURE, d: process.env.EXPO_PUBLIC_API_BASE_DOMAIN };
      process.env.EXPO_PUBLIC_API_INSECURE = '0';
      process.env.EXPO_PUBLIC_API_BASE_DOMAIN = 'earthscape.com';
      try {
        return loadConfig();
      } finally {
        if (saved.i === undefined) delete process.env.EXPO_PUBLIC_API_INSECURE; else process.env.EXPO_PUBLIC_API_INSECURE = saved.i;
        if (saved.d === undefined) delete process.env.EXPO_PUBLIC_API_BASE_DOMAIN; else process.env.EXPO_PUBLIC_API_BASE_DOMAIN = saved.d;
      }
    }

    it('is actually an https build (guards the rest of this describe against a silent no-op)', () => {
      const config = loadHttpsConfig();
      config.setSubdomain('stage');
      expect(config.getApiHost()).toBe('https://stage.earthscape.com');
    });

    it('upgrades an absolute http:// CloudFront/on-prem URL', () => {
      const config = loadHttpsConfig();
      config.setSubdomain('stage');
      expect(config.resolveMediaUrl('http://cdn.example.com/x.m3u8')).toBe('https://cdn.example.com/x.m3u8');
      expect(config.resolveMediaUrl('https://cdn.example.com/x.m3u8')).toBe('https://cdn.example.com/x.m3u8');
      // The upgrade must not touch anything but the scheme.
      expect(config.resolveMediaUrl('http://cdn.example.com:8080/a/b.mp4?token=t')).toBe('https://cdn.example.com:8080/a/b.mp4?token=t');
    });

    it('composes a server-relative on-prem URL onto the https org host', () => {
      const config = loadHttpsConfig();
      config.setSubdomain('demo');
      expect(config.resolveMediaUrl('/static/x.m3u8')).toBe('https://demo.earthscape.com/static/x.m3u8');
      expect(config.resolveMediaUrl('live/5/playlist.m3u8')).toBe('https://demo.earthscape.com/live/5/playlist.m3u8');
      // No cleartext can survive resolveMediaUrl in an https build, whatever the payload says.
      for (const u of ['http://a/b', 'http://a.b.c/d.ts', '/rel', 'rel']) {
        expect(config.resolveMediaUrl(u)!.startsWith('https://')).toBe(true);
      }
    });
  });
});

describe('SEC-007 server-supplied download filenames', () => {
  it('strips directories and unsafe characters', () => {
    expect(safeFilename('../Documents/anything.png')).toBe('anything.png');
    expect(safeFilename('..\\..\\evil.png')).toBe('evil.png');
    expect(safeFilename('/etc/passwd')).toBe('passwd');
    expect(safeFilename('a b/c?d=1.png')).toBe('c_d_1.png');
    expect(safeFilename('..')).toBe('download.bin');
    expect(safeFilename('')).toBe('download.bin');
    expect(safeFilename(null, 'shot.png')).toBe('shot.png');
    expect(safeFilename('x'.repeat(200)).length).toBe(100);
    expect(safeFilename('screenshot_6_12.png')).toBe('screenshot_6_12.png');
  });
  it('downloadToCache never writes outside the cache directory', async () => {
    const FileSystem = require('expo-file-system');
    await downloadToCache('https://cdn/x.png', '../x/y.png');
    expect(FileSystem.downloadAsync).toHaveBeenCalledWith('https://cdn/x.png', 'file:///cache/y.png');
  });
});

describe('SEC-008 prototype pollution through flight_data graphs', () => {
  it('sanitizeGraphData drops __proto__/constructor/prototype at both levels and keeps the rest', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":[[1,1]]},"Aircraft":{"__proto__":{"x":1},"constructor":[[1,1]],"Altitude":[[1,100]]},"constructor":{"a":[[1,1]]},"prototype":{}}');
    const clean = sanitizeGraphData(payload);
    expect(Object.keys(clean)).toEqual(['Aircraft']);
    expect(Object.keys(clean.Aircraft)).toEqual(['Altitude']);
    expect(clean.Aircraft.Altitude).toEqual([[1, 100]]);
    expect(sanitizeGraphData(null)).toEqual({});
  });
  it('appendGraphs does not pollute Object.prototype', () => {
    const payload = JSON.parse('{"__proto__":{"polluted":[[1,1]]},"Aircraft":{"Altitude":[[1,100]]}}');
    let state = graphReducer(undefined, { type: 'init' });
    state = graphReducer(state, appendGraphs(payload));
    state = graphReducer(state, appendGraphs(JSON.parse('{"Aircraft":{"__proto__":{"polluted2":[[2,2]]},"Altitude":[[2,200]]}}')));
    expect(({} as any).polluted).toBeUndefined();
    expect(({} as any).polluted2).toBeUndefined();
    expect(Object.keys(state.data)).toEqual(['Aircraft']);
    expect(Object.keys(state.data.Aircraft)).toEqual(['Altitude']);
    expect(state.data.Aircraft.Altitude).toEqual([[1, 100], [2, 200]]);
  });
});
