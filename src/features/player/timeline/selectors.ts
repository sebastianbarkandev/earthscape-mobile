import { createSelector } from '@reduxjs/toolkit';
import { theme } from '@/common/theme';
import type { FlightPointFieldMeta } from '@/common/lib/formatFlightPointValue';
import type { FieldsStructure } from '@/features/auth/bootstrap';
import type { Bootstrap } from '@/features/auth/bootstrap';
import type { GraphState } from '../graphSlice';
import type { PlayerState } from '../playerSlice';
import { segmentsFromSeries } from './sensorBands';
import { sortedByStart } from './clipmarkUtils';
import { extentFrom, liveEdgeOf } from './liveExtent';

type S = { player: PlayerState; graph: GraphState; auth: { bootstrap: Bootstrap | null } };

/**
 * LIVE-022: while live the extent follows the live edge (timeline/liveExtent.ts). The edge is
 * quantized, so the 2 Hz playhead does not hand these selectors a new value on every tick.
 */
const selectExtent = createSelector(
  (s: S) => s.player.time.start,
  (s: S) => s.player.time.end,
  (s: S) => s.player.time.duration,
  (s: S) => liveEdgeOf(s.player),
  extentFrom,
);

/** Zoom window; `null` in state means "follow the full extent" (grows while live). */
export const selectTimeWindow = createSelector(
  (s: S) => s.player.timeline.window,
  selectExtent,
  (win, extent) => (win ? win : { left: extent.start, right: Math.max(extent.end, extent.start + 1) }),
);

export const selectBounds = selectExtent;

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
        const meta = structure[category]?.[name] ?? { color: theme.graphDefault };
        out.push({ key: `${category}/${name}`, category, name, series, meta: { ...meta, color: meta.color ?? theme.graphDefault } });
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
