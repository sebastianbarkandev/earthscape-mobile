import { createSelector } from '@reduxjs/toolkit';
import type { FlightPointFieldMeta } from '@/common/lib/formatFlightPointValue';
import type { FieldsStructure } from '@/features/auth/bootstrap';
import type { Bootstrap } from '@/features/auth/bootstrap';
import type { GraphState } from '../graphSlice';
import type { PlayerState } from '../playerSlice';
import { segmentsFromSeries } from './sensorBands';
import { sortedByStart } from './clipmarkUtils';

type S = { player: PlayerState; graph: GraphState; auth: { bootstrap: Bootstrap | null } };

/** Zoom window; `null` in state means "follow the full extent" (grows while live). */
export const selectTimeWindow = createSelector(
  (s: S) => s.player.timeline.window,
  (s: S) => s.player.time.start,
  (s: S) => s.player.time.end,
  (win, start, end) => {
    if (win) return win;
    const l = start ?? 0;
    const r = end != null && end > l ? end : l + 1;
    return { left: l, right: r };
  },
);

export const selectBounds = createSelector(
  (s: S) => s.player.time.start,
  (s: S) => s.player.time.end,
  (s: S) => s.player.time.duration,
  (start, end, duration) => ({ start: start ?? 0, end: end ?? (start ?? 0) + 1, duration: duration ?? Math.max(0, (end ?? 0) - (start ?? 0)) }),
);

export const selectFieldsStructure = (s: S): FieldsStructure =>
  s.auth.bootstrap?.settings?.displayed_flight_point_fields_structure ?? {};

export interface GraphField {
  category: string;
  name: string;
  meta: FlightPointFieldMeta | null;
  on: boolean;
}

/** Every series present in the loaded graphs, with its bootstrap meta (web MetadataControls flatten). */
export const selectGraphFields = createSelector(
  (s: S) => s.graph.data,
  (s: S) => s.graph.active,
  selectFieldsStructure,
  (data, active, structure): GraphField[] => {
    const out: GraphField[] = [];
    for (const category of Object.keys(data)) {
      for (const name of Object.keys(data[category] ?? {})) {
        out.push({ category, name, meta: structure[category]?.[name] ?? null, on: (active[category] ?? []).includes(name) });
      }
    }
    return out;
  },
);

export interface ActiveSeries {
  key: string;
  category: string;
  name: string;
  series: Array<[number, unknown]>;
  meta: FlightPointFieldMeta;
}

/** Active series with a colour (web DataLine returns null without fieldMeta.color). */
export const selectActiveSeries = createSelector(
  (s: S) => s.graph.data,
  (s: S) => s.graph.active,
  selectFieldsStructure,
  (data, active, structure): ActiveSeries[] => {
    const out: ActiveSeries[] = [];
    for (const category of Object.keys(active)) {
      for (const name of active[category]) {
        const series = data[category]?.[name];
        if (!series) continue;
        const meta = structure[category]?.[name] ?? { color: '#cc0000' };
        out.push({ key: `${category}/${name}`, category, name, series, meta: { ...meta, color: meta.color ?? '#cc0000' } });
      }
    }
    return out;
  },
);

export const selectSensorSegments = createSelector(
  (s: S) => s.graph.data,
  (data) => segmentsFromSeries(data.Telemetry?.['Sensor In Command']),
);

export const selectSortedClipmarks = createSelector(
  (s: S) => s.player.clipmarks,
  (clipmarks) => sortedByStart(clipmarks),
);

export const selectCurrentUserId = (s: S): number | null => s.auth.bootstrap?.current_user?.id ?? null;
