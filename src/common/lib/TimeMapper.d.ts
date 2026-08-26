/** Types for the verbatim TimeMapper.js port (the JS is never edited; this file only describes it). */
export interface TimeMapEntry {
  videoStart: number;
  videoEnd: number;
  utcStart: number;
  utcEnd: number;
}
export interface TimeMapper {
  startUtc: number;
  videoTimeUtcTimeMap: TimeMapEntry[] | null;
  videoToUtc(videoTime: number): number | null;
  utcToVideo(utcTime: number): number | null;
}
export function isVideoTimeInTimeMapEntry(entry: TimeMapEntry, videoTime: number): boolean;
export function isUtcTimeInTimeMapEntry(entry: TimeMapEntry, utcTime: number): boolean;
/** Returns false for empty/non-array input; THROWS on unsorted, overlapping, or unequal-duration entries. */
export function validateVideoTimeUtcTimeMap(map: unknown): boolean;
export function createTimeMapper(startUtc: number, videoTimeUtcTimeMap: TimeMapEntry[] | null | undefined): TimeMapper;
