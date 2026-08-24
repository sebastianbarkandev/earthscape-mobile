// VERBATIM PORT from earthscape web repo (frontend .../common/timeSeries.js).
// Do not edit — see CLAUDE.md rule 5. Series = arrays of [utc, value] pairs.

/**
 * `(utc_timestamp, value)` pair
 * @typedef {(number, any)} TimeSeriesPoint
 */
/**
 *
 * List of `(utc_timestamp, value)` pairs.
 * @typedef {Array<(number, any)>} TimeSeries
 */
/**
 *
 * @param {TimeSeries} data
 * @param {number} x Timestamp
 * @returns {(number, number)} high and low index such that data[low][0] <= x <= data[high][0]
 */
const bisect = (data, x) => {
    if (!Array.isArray(data) || data.length === 0) {
        return [0, 0];
    }
    let lo = 0;
    let hi = data.length;
    while (hi - lo > 1) {
        const mid = Math.round((lo + hi) / 2);
        // Skip invalid elements to avoid accessing [0] on undefined/non-array
        if (!Array.isArray(data[mid]) || data[mid].length < 1 || typeof data[mid][0] !== 'number') {
            continue;
        }
        if (data[mid][0] <= x) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    // Ensure lo is valid before checking equality
    if (lo < data.length && Array.isArray(data[lo]) && data[lo].length >= 1 && data[lo][0] === x) {
        hi = lo;
    }
    return [hi, lo];
};
/**
 *
 * @param {TimeSeries} a
 * @param {number} x Timestamp
 * @returns {TimeSeriesPoint|null}
 */
export const getClosestPointOrNull = (a, x) => {
    if (!a || !Array.isArray(a) || a.length === 0) {
        return null;
    }
    const [hi, lo] = bisect(a, x);
    // Validate a[lo] before returning to avoid accessing [1] later on invalid data
    if (lo >= a.length || !Array.isArray(a[lo]) || a[lo].length < 2) {
        return null;
    }
    return a[lo];
};
export const getClosestTimelinePointOrNull = (a, x) => {
    if (!a || !Array.isArray(a) || a.length === 0) {
        return null;
    }
    // Check if x is before/after the first/last timestamp in the series  || x.toFixed(0) > a[a.length - 1][a[a.length - 1].length - 1]
    if (x.toFixed(0) < a[0][0].toFixed(0)) {
        return [x, "No Data"]; // Return a point with x as the timestamp and No Data as the value
    }
    const [hi, lo] = bisect(a, x);
    // Validate a[lo] before returning
    if (lo >= a.length || !Array.isArray(a[lo]) || a[lo].length < 2) {
        return null;
    }
    return a[lo];
};
/**
 *
 * @param {TimeSeries} a
 * @param {number} x Timestamp
 * @returns {any|null}
 */
export const getClosestPointValueOrNull = (a, x) => {
    if (!a || !Array.isArray(a) || a.length === 0) {
        return null;
    }
    // Handle out-of-range: return closest edge value
    if (x < a[0][0]) {
        return a[0][1];
    }
    if (x > a[a.length - 1][0]) {
        return a[a.length - 1][1];
    }
    const closestPoint = getClosestPointOrNull(a, x);
    if (!closestPoint || !Array.isArray(closestPoint) || closestPoint.length < 2) {
        return null;
    }
    return closestPoint[1];
};
/**
 *
 * @param {TimeSeries} a
 * @returns {any|null}
 */
export const getLastValueOrNull = a => {
    if (!a || !Array.isArray(a) || a.length === 0) {
        return null;
    }
    const last = a[a.length - 1];
    if (!Array.isArray(last) || last.length < 2) {
        return null;
    }
    return last[1];
};
//Usage for timeline info only
export const getClosestTimelinePointValueOrNull = (a, x) => {
    const closestPoint = getClosestTimelinePointOrNull(a, x);
    if (!closestPoint || !Array.isArray(closestPoint) || closestPoint.length < 2) {
        return null;
    }
    return closestPoint[1];
};
