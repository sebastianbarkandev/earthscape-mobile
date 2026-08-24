// ⚠ PLACEHOLDER — replace with the VERBATIM copy from the web repo
// (frontend .../timeline/mergeGraphData.js) before building any graph feature.
// Mobile v1 does not render graphs, so this is only referenced defensively
// by the flight-data merge path; the naive implementation below concatenates
// series per graph key, which matches the observed usage in eventSlice.
export function mergeGraphData(oldGraphs, newGraphs) {
  if (!oldGraphs) return newGraphs ?? null;
  if (!newGraphs) return oldGraphs;
  const merged = { ...oldGraphs };
  for (const key of Object.keys(newGraphs)) {
    const oldSeries = merged[key];
    const newSeries = newGraphs[key];
    if (Array.isArray(oldSeries) && Array.isArray(newSeries)) {
      merged[key] = oldSeries.concat(newSeries);
    } else {
      merged[key] = newSeries;
    }
  }
  return merged;
}
