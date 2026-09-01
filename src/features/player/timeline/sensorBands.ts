import { theme } from '@/common/theme';

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
/** The bands themselves (web Timeline.jsx values, kept verbatim) — the ONE source of truth. */
export const SENSOR_COLORS: Record<number, string> = {
  1: theme.sensorBand1,
  2: theme.sensorBand2,
  3: theme.sensorBand3,
};
export function sensorColor(v: number): string | null {
  return SENSOR_COLORS[v] ?? null;
}

/** `rgba(r,g,b,a)` / `#rrggbb` -> the opaque colour it produces over `theme.surface` (white). */
export function compositeOverSurface(color: string): string {
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(color);
  const hex = /^#([0-9a-fA-F]{6})$/.exec(color);
  let r: number, g: number, b: number, a: number;
  if (rgba) {
    [r, g, b] = [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])];
    a = rgba[4] === undefined ? 1 : Number(rgba[4]);
  } else if (hex) {
    r = parseInt(hex[1].slice(0, 2), 16);
    g = parseInt(hex[1].slice(2, 4), 16);
    b = parseInt(hex[1].slice(4, 6), 16);
    a = 1;
  } else {
    return color; // unknown notation: show it as authored rather than guess
  }
  const over = (c: number) => Math.round(a * c + (1 - a) * 255);
  return `#${[over(r), over(g), over(b)].map((c) => c.toString(16).padStart(2, '0').toUpperCase()).join('')}`;
}

/**
 * Legend swatch for sensor `v` (UI-009). DERIVED from the band, so the toolbar can never
 * show a colour the timeline does not draw — the band is translucent, the swatch shows
 * exactly what it composites to over the card.
 */
export function sensorSwatchColor(v: number): string | null {
  const band = sensorColor(v);
  return band == null ? null : compositeOverSurface(band);
}
