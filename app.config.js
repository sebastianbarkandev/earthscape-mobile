/**
 * Dynamic layer over app.json (Expo evaluates app.config.js with the static config as
 * `config`). Everything stays exactly as in app.json except the iOS ATS block:
 *
 * The plaintext exceptions (`localhost`, `earthscape.localdocker`, the PUBLIC wildcard
 * DNS `nip.io`, `NSAllowsLocalNetworking`) exist only so dev builds can reach the docker
 * backend over http. `nip.io` resolves to ANY IPv4 an attacker encodes, so shipping that
 * exception in staging/production whitelists cleartext to the whole internet (SEC-003).
 * They are therefore emitted only when the build itself talks plain http — the same rule
 * src/common/config.ts applies at runtime (`insecure = INSECURE set ? INSECURE === '1' : __DEV__`):
 *   EXPO_PUBLIC_API_INSECURE=1        -> keep (explicit)
 *   EXPO_PUBLIC_API_INSECURE=<other>  -> drop
 *   unset + NOT a dev build            -> drop: the runtime is https there whatever the base domain (SEC-016)
 *   unset + dev + no EXPO_PUBLIC_API_BASE_DOMAIN -> keep (dev default: earthscape.localdocker over http)
 *   unset + dev + base domain is localhost / earthscape.localdocker / *.nip.io -> keep (device dev via wildcard DNS)
 *   unset + dev + any other base domain (earthscape.com) -> drop: ATS default, https only
 * "Dev build" is the config-time analog of the bundle's `__DEV__`: Expo CLI sets NODE_ENV=production
 * for `expo run:ios --configuration Release` (run/ios/runIosAsync.js) and for release `expo export`,
 * `development` for `expo start` and a bare `expo prebuild` (prebuild/prebuildAsync.js — it keeps an
 * already-exported NODE_ENV). EAS builds always prebuild with NODE_ENV=development, so the build
 * profile decides there (EAS_BUILD_PROFILE; only `development` is a dev build).
 * Changing the outcome needs `npx expo prebuild -p ios` + a rebuild (Info.plist is generated) —
 * for a Release archive of a prebuilt project run `NODE_ENV=production npx expo prebuild -p ios`.
 */
const PLAINTEXT_BASE_DOMAIN_RE = /(^|\.)(localhost|earthscape\.localdocker|nip\.io)(:\d+)?$/i;

/** Config-time `__DEV__`: see the header. Unset NODE_ENV counts as development, exactly like Expo CLI. */
function isDevBuild(env) {
  const profile = (env.EAS_BUILD_PROFILE || '').trim();
  if (profile) return profile === 'development';
  return (env.NODE_ENV || 'development').trim().toLowerCase() !== 'production';
}

function allowsPlaintext(env) {
  const insecure = (env.EXPO_PUBLIC_API_INSECURE || '').trim();
  if (insecure) return insecure === '1';
  if (!isDevBuild(env)) return false;
  const base = (env.EXPO_PUBLIC_API_BASE_DOMAIN || '').trim();
  if (!base) return true;
  return PLAINTEXT_BASE_DOMAIN_RE.test(base);
}

function applyAts(config, env) {
  if (allowsPlaintext(env)) return config;
  const ios = config.ios || {};
  const infoPlist = { ...(ios.infoPlist || {}) };
  delete infoPlist.NSAppTransportSecurity;
  return { ...config, ios: { ...ios, infoPlist } };
}

module.exports = ({ config }) => applyAts(config, process.env);
module.exports.allowsPlaintext = allowsPlaintext;
module.exports.applyAts = applyAts;
module.exports.isDevBuild = isDevBuild;
