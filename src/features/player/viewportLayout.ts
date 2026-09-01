import type { DashboardLayout } from './videoCapabilities';

export interface ViewportInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface ViewportInput {
  /** useWindowDimensions() — includes the status bar area on iOS. */
  width: number;
  height: number;
  /** useSafeAreaInsets() — status bar / home indicator / notch. */
  insets: ViewportInsets;
  layout: DashboardLayout;
  isPad?: boolean;
}

export interface ViewportSize {
  landscape: boolean;
  /** Landscape + video + map: panes side by side in one row. */
  sideBySide: boolean;
  /** Height of the video pane (0 when the layout hides it). */
  videoH: number;
  /** Height of the map pane (0 when the layout hides it). */
  mapH: number;
  /** Pin the viewport at the top of the page while the rest scrolls underneath. */
  sticky: boolean;
  /** Height left for page content under the chrome (nav bar + insets). */
  avail: number;
  /** ScrollView contentContainer bottom padding (home indicator aware). */
  contentPaddingBottom: number;
}

/** Native-stack header bar height (excluding the status bar inset). */
export const NAV_BAR_H = { phonePortrait: 44, phoneLandscape: 32, pad: 50 } as const;
/** Portrait: never pin more than this share of the available height. */
export const STICKY_MAX_SHARE = 0.55;
/** Portrait video pane share cap (16:9 of the width still wins on phones). */
export const VIDEO_MAX_SHARE = 0.35;
/** A 16:9 video wider than this is capped so iPad portrait does not get a 576pt pane. */
export const VIDEO_MAX_W = 720;
const MIN_AVAIL = 200;

/** ProgramStrip tile width cap (pt); tiles are 16:9, so this is a 90pt-tall tile at most. */
export const PROGRAM_TILE_MAX_W = 160;
/** ProgramStrip tile share of the window width on narrow phones. */
export const PROGRAM_TILE_SHARE = 0.38;

/**
 * Fixed width for a secondary-program tile (RESP-010): the strip scrolls horizontally, so
 * tiles never shrink with the program count (4 tiles on an SE used to be 86×48pt, smaller
 * than their LIVE badge + label).
 */
export function programTileWidth(windowWidth: number): number {
  const w = Number.isFinite(windowWidth) && windowWidth > 0 ? windowWidth : 375;
  return Math.min(PROGRAM_TILE_MAX_W, Math.round(w * PROGRAM_TILE_SHARE));
}

/**
 * Player viewport sizing from BOTH window axes (web: --pl-viewport-h card).
 * Portrait: video 16:9 then map below, pinned (sticky) but capped so the
 * controls bar, action row and timeline stay reachable on every phone.
 * Landscape: the viewport fills the visible area (video | map side by side)
 * and is NOT pinned, so the rest of the page scrolls into view.
 */
export function computeViewportSize(o: ViewportInput): ViewportSize {
  const landscape = o.width > o.height;
  const showVideo = o.layout !== 'map';
  const showMap = o.layout !== 'video';
  const navH = o.isPad ? NAV_BAR_H.pad : landscape ? NAV_BAR_H.phoneLandscape : NAV_BAR_H.phonePortrait;
  const avail = Math.max(MIN_AVAIL, Math.round(o.height - o.insets.top - o.insets.bottom - navH));
  const contentPaddingBottom = o.insets.bottom + 16;

  if (landscape) {
    return {
      landscape,
      sideBySide: showVideo && showMap,
      videoH: showVideo ? avail : 0,
      mapH: showMap ? avail : 0,
      sticky: false,
      avail,
      contentPaddingBottom,
    };
  }

  const cap = Math.round(avail * STICKY_MAX_SHARE);
  const natural16x9 = Math.round(Math.min(o.width, VIDEO_MAX_W) * 9 / 16);
  let videoH = 0;
  let mapH = 0;
  if (showVideo && showMap) {
    videoH = Math.min(natural16x9, Math.round(avail * VIDEO_MAX_SHARE));
    mapH = Math.max(0, Math.min(Math.round(o.width * 0.75), cap - videoH));
  } else if (showVideo) {
    videoH = Math.min(natural16x9, cap);
  } else {
    mapH = Math.min(Math.round(o.width * 0.75), cap);
  }
  return { landscape, sideBySide: false, videoH, mapH, sticky: true, avail, contentPaddingBottom };
}
