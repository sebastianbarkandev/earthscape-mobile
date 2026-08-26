/** Types for the verbatim calculateHeatMap.js port. Input = target series [[utc,[lat,lon]],...]. */
export function calculateHeatMap(
  data: Array<[number, [number, number]]>,
): Array<[string, string, number]>; // [lat.toFixed(5), lng.toFixed(5), totalSeconds]
