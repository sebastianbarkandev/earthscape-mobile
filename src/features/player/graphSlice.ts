import { createSlice, current, PayloadAction } from '@reduxjs/toolkit';
import { mergeGraphData, type GraphData } from '@/common/lib/mergeGraphData';
import { sanitizeGraphData } from '@/common/sanitizeGraphData';
import { loadEvent, resetPlayer, setActiveVideo } from './playerSlice';

/**
 * Slim port of the web graphSlice: `data` = merged {category:{name:series}} from
 * flight_data.json (mergeGraphData on every append), `active` = the user's
 * selected series per category (web graphs[].dropdown.active). Field metadata
 * is NOT duplicated here — selectors read it from bootstrap settings.
 * secondaryGraphs / searchableGraphs (multiprogram) are out of scope.
 */
export interface GraphState {
  data: GraphData;
  active: Record<string, string[]>;
}

const initialState: GraphState = { data: {}, active: {} };

const graphSlice = createSlice({
  name: 'graph',
  initialState,
  reducers: {
    appendGraphs(state, { payload }: PayloadAction<GraphData | null | undefined>) {
      if (!payload) return;
      // mergeGraphData concats series; run it on plain objects, not immer drafts.
      // Strip __proto__/constructor/prototype keys first — the verbatim lib writes server keys as-is (SEC-008).
      state.data = mergeGraphData(current(state).data, sanitizeGraphData(payload));
    },
    toggleGraph(state, { payload }: PayloadAction<{ category: string; name: string }>) {
      const list = state.active[payload.category] ?? [];
      const i = list.indexOf(payload.name);
      if (i >= 0) list.splice(i, 1);
      else list.push(payload.name);
      if (list.length) state.active[payload.category] = list;
      else delete state.active[payload.category];
    },
    clearActiveGraphs(state) {
      state.active = {};
    },
  },
  extraReducers: (b) => {
    // New event: drop the series but keep the user's selection (live<->VOD reloads happen mid-view).
    b.addCase(loadEvent.pending, (s) => {
      s.data = {};
    });
    // Program swap: the series belong to the previous video (playerSlice drops mapData the same way).
    b.addCase(setActiveVideo, (s) => {
      s.data = {};
    });
    b.addCase(resetPlayer, () => initialState);
  },
});

export const { appendGraphs, toggleGraph, clearActiveGraphs } = graphSlice.actions;
export default graphSlice.reducer;
