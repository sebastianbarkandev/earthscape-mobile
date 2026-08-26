import type { PayloadAction } from '@reduxjs/toolkit';
import type { PlayerState } from '../playerSlice';
import { clampZoom, isFullWindow, panWindow as panWin } from './geometry';

/**
 * Timeline case reducers spread into playerSlice (they need state.time for the
 * clamping rules). Nothing here is written during a gesture — the canvas keeps
 * transient state in refs and commits once on release.
 */
export type ClippingState =
  | { mode: 'idle' }
  | { mode: 'clipIn'; time_start: number } // end = live currentUtc, derived at render
  | { mode: 'drag'; clipmarkId: number | null };

export interface TimelineState {
  window: { left: number; right: number } | null; // null => follow [start, end]
  clipping: ClippingState;
  activeClipmarkId: number | null;
  clipmarksVisible: boolean;
  sensorVisibility: Record<1 | 2 | 3, boolean>;
  tool: 'scrub' | 'clip';
}

export const initialTimelineState: TimelineState = {
  window: null,
  clipping: { mode: 'idle' },
  activeClipmarkId: null,
  clipmarksVisible: true,
  sensorVisibility: { 1: true, 2: true, 3: true },
  tool: 'scrub',
};

function bounds(state: PlayerState) {
  const start = state.time.start ?? 0;
  const end = state.time.end ?? start + 1;
  return { start, end, duration: state.time.duration ?? Math.max(0, end - start) };
}

export const timelineReducers = {
  /** Web setOnZoom (clamped, refuses > 10x). Stores null when equal to the full extent. */
  setZoom(state: PlayerState, { payload }: PayloadAction<{ left: number; right: number }>) {
    const b = bounds(state);
    const next = clampZoom(payload, b);
    if (!next) return;
    state.timeline.window = isFullWindow(next, b) ? null : next;
  },
  /** Web setPan (whole delta rejected when it would leave the extent). */
  panWindow(state: PlayerState, { payload }: PayloadAction<number>) {
    const b = bounds(state);
    const cur = state.timeline.window ?? { left: b.start, right: b.end };
    const next = panWin(cur, payload, b);
    state.timeline.window = isFullWindow(next, b) ? null : next;
  },
  resetZoom(state: PlayerState) {
    state.timeline.window = null;
  },
  clipIn(state: PlayerState, { payload }: PayloadAction<number>) {
    if (state.timeline.clipping.mode !== 'idle') return;
    state.timeline.clipping = { mode: 'clipIn', time_start: payload };
  },
  cancelClipIn(state: PlayerState) {
    if (state.timeline.clipping.mode === 'clipIn') state.timeline.clipping = { mode: 'idle' };
  },
  beginClipDrag(state: PlayerState, { payload }: PayloadAction<number | null>) {
    state.timeline.clipping = { mode: 'drag', clipmarkId: payload };
  },
  endClipDrag(state: PlayerState) {
    if (state.timeline.clipping.mode === 'drag') state.timeline.clipping = { mode: 'idle' };
  },
  setActiveClipmark(state: PlayerState, { payload }: PayloadAction<number | null>) {
    state.timeline.activeClipmarkId = payload;
  },
  toggleClipmarksVisible(state: PlayerState) {
    state.timeline.clipmarksVisible = !state.timeline.clipmarksVisible;
  },
  toggleSensor(state: PlayerState, { payload }: PayloadAction<1 | 2 | 3>) {
    state.timeline.sensorVisibility[payload] = !state.timeline.sensorVisibility[payload];
  },
  setTimelineTool(state: PlayerState, { payload }: PayloadAction<'scrub' | 'clip'>) {
    state.timeline.tool = payload;
  },
};
