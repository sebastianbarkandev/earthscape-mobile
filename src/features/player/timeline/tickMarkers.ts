import { formatTime } from '@/common/lib/formatTime';
import { TICK_TARGET_PX } from './constants';

/** Web Markers.calculateMarkerLength — the tick-interval ladder (seconds). */
export function calculateMarkerLength(time: number, count: number): number {
  const deltaT = time / count;
  let d: number;
  if (deltaT <= 1) d = 1;
  else if (deltaT <= 2) d = 2;
  else if (deltaT <= 5) d = 5;
  else if (deltaT <= 15) d = 5;
  else if (deltaT <= 30) d = 15;
  else if (deltaT <= 60) d = 30;
  else if (deltaT <= 120) d = 60;
  else if (deltaT <= 300) d = 120;
  else if (deltaT <= 600) d = 300;
  else if (deltaT <= 1800) d = 600;
  else if (deltaT <= 3600) d = 1800;
  else d = 3600;
  return Math.ceil(d);
}

export interface Tick {
  x: number;
  seconds: number; // relative to start
  label: string;
}

/** Web Markers.jsx loop: ticks are relative to `start`, positioned in the zoom window. */
export function computeTicks(p: { start: number; end: number; left: number; right: number; width: number }): Tick[] {
  const { start, end, left, right, width } = p;
  if (!(end > start) || !(width > 0)) return [];
  const fullDuration = end - start;
  const visibleDuration = right - left;
  if (!(visibleDuration > 0)) return [];
  let count = width / TICK_TARGET_PX;
  const markerLength = calculateMarkerLength(visibleDuration, count);
  while (markerLength * count < fullDuration) count += 1;
  const xOffset = start - left;
  const ticks: Tick[] = [];
  for (let i = 0; i < count; i += 1) {
    const rel = i * markerLength;
    if (rel <= left - start) continue;
    const x = ((rel + xOffset) / visibleDuration) * width;
    if (x > width) break;
    ticks.push({ x, seconds: rel, label: formatTime(rel) });
  }
  return ticks;
}
