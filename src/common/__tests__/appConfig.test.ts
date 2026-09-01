/**
 * SEC-003: the ATS plaintext exceptions in app.json (incl. the public wildcard DNS
 * `nip.io`) must only reach Info.plist in builds that actually talk http.
 */
const { allowsPlaintext, applyAts, isDevBuild } = require('../../../app.config.js');
const appJson = require('../../../app.json');

describe('app.config.js ATS gating', () => {
  it('keeps the exceptions for dev / explicitly insecure builds', () => {
    expect(allowsPlaintext({})).toBe(true);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_INSECURE: '1', EXPO_PUBLIC_API_BASE_DOMAIN: 'earthscape.com' })).toBe(true);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_BASE_DOMAIN: '192-168-10-184.nip.io' })).toBe(true);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_BASE_DOMAIN: 'earthscape.localdocker:8000' })).toBe(true);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_BASE_DOMAIN: 'localhost' })).toBe(true);
  });
  it('drops them for https deployments (eas staging/production, stage device builds)', () => {
    expect(allowsPlaintext({ EXPO_PUBLIC_API_BASE_DOMAIN: 'earthscape.com' })).toBe(false);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_BASE_DOMAIN: 'earthscape.com', EXPO_PUBLIC_API_LOOKUP_HOST: 'stage.earthscape.com' })).toBe(false);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_INSECURE: '0' })).toBe(false);
    expect(allowsPlaintext({ EXPO_PUBLIC_API_BASE_DOMAIN: 'evil-nip.io.example.com' })).toBe(false);
  });
  it('SEC-016: a non-dev build never keeps them, even with no env at all (runtime is https there)', () => {
    // Same predicate as src/common/config.ts: `insecure = INSECURE set ? INSECURE === '1' : __DEV__`.
    expect(allowsPlaintext({ NODE_ENV: 'production' })).toBe(false); // expo run:ios --configuration Release / Xcode archive
    expect(allowsPlaintext({ NODE_ENV: 'production', EXPO_PUBLIC_API_BASE_DOMAIN: '192-168-10-184.nip.io' })).toBe(false);
    expect(allowsPlaintext({ EAS_BUILD_PROFILE: 'production' })).toBe(false);
    expect(allowsPlaintext({ EAS_BUILD_PROFILE: 'staging' })).toBe(false);
    expect(allowsPlaintext({ EAS_BUILD_PROFILE: 'preview', NODE_ENV: 'development' })).toBe(false);
    // Dev builds keep the dev default; an explicit INSECURE=1 wins everywhere, like at runtime.
    expect(allowsPlaintext({ NODE_ENV: 'development' })).toBe(true);
    expect(allowsPlaintext({ NODE_ENV: 'test' })).toBe(true);
    expect(allowsPlaintext({ EAS_BUILD_PROFILE: 'development' })).toBe(true);
    expect(allowsPlaintext({ NODE_ENV: 'production', EXPO_PUBLIC_API_INSECURE: '1' })).toBe(true);
    expect(isDevBuild({})).toBe(true);
    expect(isDevBuild({ NODE_ENV: 'Production' })).toBe(false);
    expect(isDevBuild({ EAS_BUILD_PROFILE: 'development', NODE_ENV: 'production' })).toBe(true);
  });
  it('returns app.json untouched in dev and removes exactly NSAppTransportSecurity otherwise', () => {
    const cfg = appJson.expo;
    expect(applyAts(cfg, {})).toBe(cfg);
    const prod = applyAts(cfg, { EXPO_PUBLIC_API_BASE_DOMAIN: 'earthscape.com' });
    expect(applyAts(cfg, { NODE_ENV: 'production' })).toEqual(prod);
    expect(prod.ios.infoPlist.NSAppTransportSecurity).toBeUndefined();
    const { NSAppTransportSecurity: _dropped, ...rest } = cfg.ios.infoPlist;
    expect(prod.ios.infoPlist).toEqual(rest);
    expect({ ...prod, ios: { ...prod.ios, infoPlist: cfg.ios.infoPlist } }).toEqual(cfg);
    // The static file still carries them, so `earthscape.com` is never listed as an exception anywhere.
    expect(JSON.stringify(cfg.ios.infoPlist.NSAppTransportSecurity)).not.toContain('earthscape.com');
  });
});
