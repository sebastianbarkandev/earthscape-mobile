import type { Clipmark } from '../api';

/**
 * Port of the web eventCardUtils.jsx (globals injected instead of read).
 * Icons are FontAwesome6 names standing in for the web's image assets.
 */
export interface EventType {
  key: 'note' | 'plate' | 'marker' | 'clip' | 'tak' | 'coordinates' | 'timepoint' | 'event';
  label: string;
  icon: 'note-sticky' | 'id-card' | 'location-dot' | 'film' | 'draw-polygon' | 'location-crosshairs' | 'thumbtack' | 'circle-dot';
}

export function getEventType(c: Clipmark): EventType {
  const tj = c.the_json;
  if (tj && tj.data && tj.data.command) {
    if (tj.data.command === 'action' && tj.data.markerCat === 'Note') return { key: 'note', label: 'Note', icon: 'note-sticky' };
    if (tj.data.markerCat === 'Plate') return { key: 'plate', label: 'Plate', icon: 'id-card' };
    if (tj.stream === 'GEODBJSON' && tj.data.layer === 'PlateReader') return { key: 'plate', label: 'Plate', icon: 'id-card' };
    return { key: 'marker', label: 'Marker', icon: 'location-dot' };
  }
  switch (c.type) {
    case 'plate':
      return { key: 'plate', label: 'Plate', icon: 'id-card' };
    case 'clip':
      return { key: 'clip', label: 'Clip', icon: 'film' };
    case 'tak':
      return { key: 'tak', label: 'TAK Drawing', icon: 'draw-polygon' };
    case 'coordinates':
      return { key: 'coordinates', label: 'Coordinates', icon: 'location-crosshairs' };
    case 'timepoint':
      return { key: 'timepoint', label: 'Timepoint', icon: 'thumbtack' };
    default:
      if (c.time_start && !c.time_end) return { key: 'timepoint', label: 'Timepoint', icon: 'thumbtack' };
      return { key: 'event', label: 'Event', icon: 'circle-dot' };
  }
}

/** How the mark is drawn on the timeline canvas. */
export type TimelineGlyph = 'band' | 'point' | 'markerOpen' | 'markerClose' | 'plate' | 'none';
export function timelineGlyph(c: Clipmark): TimelineGlyph {
  if (c.type === 'tak_chat' || c.time_start == null) return 'none';
  if (c.time_end != null && c.time_end > c.time_start) return 'band';
  const d = c.the_json?.data;
  if (d?.command === 'action') return d.name === 'close_marker' || d.name === 'delete_marker' ? 'markerClose' : 'markerOpen';
  if (getEventType(c).key === 'plate') return 'plate';
  return 'point';
}

export function getAuthor(c: Clipmark): { fullname: string; initials: string; src: string | null; username: string | null } | null {
  const u = c.user;
  if (!u || !u.first_name || !u.last_name) return null;
  return {
    fullname: `${u.first_name} ${u.last_name}`,
    initials: `${u.first_name[0] ?? ''}${u.last_name[0] ?? ''}`.toUpperCase(),
    src: u.profile_img_url ?? null,
    username: u.username ?? null,
  };
}

/** Web canEditClipmark: own clipmark or videos.update; system clipmarks (no user) never. */
export function canEditClipmark(c: Clipmark | null | undefined, currentUserId: number | null, canUpdateVideos: boolean): boolean {
  if (!c || !c.user || currentUserId == null) return false;
  return c.user.id === currentUserId || canUpdateVideos;
}

export const isSystemGenerated = (c: Clipmark) => !c.user;

/** Web formatDurationLabel: "14s", "2m 5s", "1h 5m". */
export function formatDurationLabel(c: { time_start: number | null; time_end: number | null }): string | null {
  if (c.time_end == null || c.time_start == null) return null;
  let s = c.time_end - c.time_start;
  if (!Number.isFinite(s) || s <= 0) return null;
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return rs ? `${m}m ${rs}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm ? `${h}h ${rm}m` : `${h}h`;
}

/** Card title rule (web TimelineEventsRow). */
export function clipmarkTitle(c: Clipmark): string {
  return c.text || (c.the_json?.data?.label as string | undefined) || getEventType(c).label;
}

/** Web Lower.jsx prev/next with wrap-around over time_start-sorted clipmarks. */
export function sortedByStart(clipmarks: Clipmark[]): Clipmark[] {
  return clipmarks.filter((c) => c.time_start != null && c.type !== 'tak_chat').slice().sort((a, b) => (a.time_start as number) - (b.time_start as number));
}
export function prevClipmark(sorted: Clipmark[], currentUtc: number): Clipmark | null {
  if (!sorted.length) return null;
  const prev = [...sorted].reverse().find((c) => (c.time_start as number) < currentUtc);
  return prev ?? sorted[sorted.length - 1];
}
export function nextClipmark(sorted: Clipmark[], currentUtc: number): Clipmark | null {
  if (!sorted.length) return null;
  const next = sorted.find((c) => (c.time_start as number) > currentUtc);
  return next ?? sorted[0];
}
