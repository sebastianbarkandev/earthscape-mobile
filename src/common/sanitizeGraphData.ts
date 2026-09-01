import type { GraphData } from './lib/mergeGraphData';

/**
 * Wrapper for the VERBATIM web port `lib/mergeGraphData.js` (never edit that file).
 * The lib does `result[category][name] = ...` on server-defined keys, and
 * `JSON.parse` makes `"__proto__"` an own property — so a hostile payload
 * `{"__proto__": {"x": [...]}}` would write onto Object.prototype (SEC-008).
 * Drop the dangerous keys at both levels BEFORE the merge; everything else is
 * passed through untouched.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function sanitizeGraphData(data: GraphData | null | undefined): GraphData {
  const out: GraphData = {};
  if (!data || typeof data !== 'object') return out;
  for (const category of Object.keys(data)) {
    if (UNSAFE_KEYS.has(category)) continue;
    const series = data[category];
    if (!series || typeof series !== 'object') continue;
    const cleanSeries: GraphData[string] = {};
    for (const name of Object.keys(series)) {
      if (UNSAFE_KEYS.has(name)) continue;
      cleanSeries[name] = series[name];
    }
    out[category] = cleanSeries;
  }
  return out;
}
