/**
 * config.ts is the only place URLs are built, and the backend redirects away from
 * any Host whose first label isn't a real org subdomain — so the composition rules
 * are worth pinning down.
 *
 * Note on env: babel-preset-expo INLINES process.env.EXPO_PUBLIC_* at transform
 * time, so mutating process.env here would not change what the module sees. These
 * tests therefore cover the default (dev) resolution and the pure composition
 * logic; per-profile base domains are a build concern, verified against a real
 * build rather than here.
 */

type ConfigModule = typeof import('../config');

function loadConfig(): ConfigModule {
  let mod!: ConfigModule;
  jest.isolateModules(() => {
    mod = require('../config') as ConfigModule;
  });
  return mod;
}

describe('config host composition', () => {
  it('has no API host until an org is resolved', () => {
    const config = loadConfig();
    expect(config.getApiHost()).toBe('');
    expect(config.isHostConfigured()).toBe(false);
  });

  it('composes the org host from the dev base domain', () => {
    const config = loadConfig();
    config.setSubdomain('demo');
    expect(config.getApiHost()).toBe('http://demo.earthscape.localdocker');
    expect(config.isHostConfigured()).toBe(true);
  });

  it('resolves the org-less lookup host on the api label', () => {
    const config = loadConfig();
    // Must not depend on a resolved org — this is what the app calls first.
    expect(config.getLookupHost()).toBe('http://api.earthscape.localdocker');
    config.setSubdomain('demo');
    expect(config.getLookupHost()).toBe('http://api.earthscape.localdocker');
  });

  it('normalizes the subdomain', () => {
    const config = loadConfig();
    config.setSubdomain('  DEMO  ');
    expect(config.getSubdomain()).toBe('demo');
    expect(config.getApiHost()).toBe('http://demo.earthscape.localdocker');
  });

  it('labels the base domain before an org and the full host after', () => {
    const config = loadConfig();
    expect(config.getHostLabel()).toBe('earthscape.localdocker');
    config.setSubdomain('churchill');
    expect(config.getHostLabel()).toBe('churchill.earthscape.localdocker');
  });
});

describe('resolveMediaUrl', () => {
  it('passes absolute CloudFront URLs through untouched', () => {
    const config = loadConfig();
    config.setSubdomain('demo');
    expect(config.resolveMediaUrl('https://d123.cloudfront.net/a.m3u8')).toBe(
      'https://d123.cloudfront.net/a.m3u8',
    );
    expect(config.resolveMediaUrl('http://example.com/a.mp4')).toBe('http://example.com/a.mp4');
  });

  it('joins server-relative URLs onto the org host', () => {
    const config = loadConfig();
    config.setSubdomain('demo');
    expect(config.resolveMediaUrl('/live/5/playlist.m3u8')).toBe(
      'http://demo.earthscape.localdocker/live/5/playlist.m3u8',
    );
    // Missing leading slash still produces one separator, not zero or two.
    expect(config.resolveMediaUrl('live/5/playlist.m3u8')).toBe(
      'http://demo.earthscape.localdocker/live/5/playlist.m3u8',
    );
  });

  it('returns null for empty input', () => {
    const config = loadConfig();
    expect(config.resolveMediaUrl(null)).toBeNull();
    expect(config.resolveMediaUrl(undefined)).toBeNull();
    expect(config.resolveMediaUrl('')).toBeNull();
  });
});

describe('composeLookupHost', () => {
  // The env value itself is babel-inlined (see header), so the rule is tested
  // through the pure composition function getLookupHost() delegates to.
  it('defaults to the org-less api label under the base domain', () => {
    const { composeLookupHost } = loadConfig();
    expect(composeLookupHost('https', 'earthscape.com', null)).toBe('https://api.earthscape.com');
    expect(composeLookupHost('http', 'earthscape.localdocker', undefined)).toBe(
      'http://api.earthscape.localdocker',
    );
    expect(composeLookupHost('https', 'earthscape.com', '   ')).toBe('https://api.earthscape.com');
  });

  it('uses the override verbatim (stage has no api-stage host; api. is production)', () => {
    const { composeLookupHost } = loadConfig();
    expect(composeLookupHost('https', 'earthscape.com', 'stage.earthscape.com')).toBe(
      'https://stage.earthscape.com',
    );
    expect(composeLookupHost('http', 'earthscape.localdocker', ' Demo.Earthscape.Localdocker:8080 ')).toBe(
      'http://demo.earthscape.localdocker:8080',
    );
  });

  it('shares the scheme with the org host rather than assuming https', () => {
    const { composeLookupHost } = loadConfig();
    expect(composeLookupHost('http', 'x.test', 'stage.x.test')).toBe('http://stage.x.test');
  });
});
