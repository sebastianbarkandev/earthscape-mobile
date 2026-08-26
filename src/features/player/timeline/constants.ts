/** Touch-tuned constants for the timeline (web values noted where they differ). */
export const TAP_SLOP = 8; // px of movement that still counts as a tap
export const TAP_MAX_MS = 300;
export const HANDLE_HIT_W = 24; // web TimelineClipmarkHandle HIT_WIDTH 12
export const MARK_HIT_W = 20; // web TimelineClipmarkInstantaneous HIT_W 10
export const MIN_CLIP_SEC = 1; // web: time_end nulled below 1.0s
export const MIN_ZOOM_FRACTION = 0.1; // web setOnZoom: refuse if span <= 10% of duration
export const TICK_TARGET_PX = 150; // web Markers: count = width / 150
export const TIMELINE_HEIGHT = 110;
export const DATALINE_PAD_TOP = 20; // web DataLine padTop
export const DATALINE_PAD_BOTTOM = 8; // web DataLine padBottom
export const BAND_TOP_RATIO = 0.3; // web TimelineClipmark
export const BAND_HEIGHT_RATIO = 0.275;
export const BAND_MIN_H = 18;
export const BAND_MAX_H = 28;
export const EDGE_WIDTH = 2;
