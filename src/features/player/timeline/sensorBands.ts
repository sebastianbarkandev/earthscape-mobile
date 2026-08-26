/** Web Timeline.jsx sensor bands: Telemetry['Sensor In Command'] step series -> coloured segments. */
export interface SensorSegment {
  startTime: number;
  endTime: number | null; // null = open-ended (until the end of the window)
  value: number;
}

export function segmentsFromSeries(series: Array<[number, unknown]> | null | undefined): SensorSegment[] {
  if (!series || series.length === 0) return [];
  const out: SensorSegment[] = [];
  for (const p of series) {
    if (!Array.isArray(p) || !Number.isFinite(p[0])) continue;
    const v = Number(p[1]);
    if (!Number.isFinite(v)) continue;
    const last = out[out.length - 1];
    if (last && last.value === v) continue; // merge runs of equal values
    if (last) last.endTime = p[0];
    out.push({ startTime: p[0], endTime: null, value: v });
  }
  return out;
}

export type SensorValue = 1 | 2 | 3;
export const SENSOR_COLORS: Record<number, string> = {
  1: 'rgba(173,216,230,0.4)',
  2: '#FFEAEA',
  3: 'rgba(255,255,0,0.4)',
};
export function sensorColor(v: number): string | null {
  return SENSOR_COLORS[v] ?? null;
}
