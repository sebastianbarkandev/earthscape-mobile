/** Types for the verbatim timeSeries.js port (the JS is never edited; this file only describes it). */
export type TimeSeriesPoint<V = unknown> = [number, V];
export type TimeSeries<V = unknown> = TimeSeriesPoint<V>[];

export function getClosestPointOrNull<V>(a: TimeSeries<V> | null | undefined, x: number): TimeSeriesPoint<V> | null;
export function getClosestTimelinePointOrNull<V>(a: TimeSeries<V> | null | undefined, x: number): TimeSeriesPoint<V> | null;
export function getClosestPointValueOrNull<V>(a: TimeSeries<V> | null | undefined, x: number): V | null;
export function getLastValueOrNull<V>(a: TimeSeries<V> | null | undefined): V | null;
export function getClosestTimelinePointValueOrNull<V>(a: TimeSeries<V> | null | undefined, x: number): V | null;
