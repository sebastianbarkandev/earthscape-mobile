import { theme } from '@/common/theme';
import { isoToDate } from '@/common/lib/normalizeDate';
import type { VideoListItem } from '@/features/library/librarySlice';
import type { CoverageTrack, DashboardLayoutEntry, DashboardPayload, DashboardVideo, DashboardWidgetType } from './api';

/** Pure helpers behind DashboardScreen (web dashboard/components/{StatsSection,MapCard}.jsx). */

export const METERS_PER_MILE = 1609.34;
const DAY_MS = 86_400_000;

export function metersToMiles(m: number | null | undefined): number {
  return Number.isFinite(m) ? (m as number) / METERS_PER_MILE : 0;
}

/** Web StatsSection: whole miles once the number is large, one decimal below 100. */
export function formatMiles(m: number | null | undefined): string {
  const mi = metersToMiles(m);
  if (mi >= 100) return Math.round(mi).toLocaleString();
  return (Math.round(mi * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export type Recency = 'today' | 'thisWeek' | 'lastWeek' | 'older';

export const RECENCY_LEGEND: ReadonlyArray<{ key: Recency; label: string; color: string; maxDays: number }> = [
  { key: 'today', label: 'Today', color: theme.coverageToday, maxDays: 1 },
  { key: 'thisWeek', label: 'This week', color: theme.coverageThisWeek, maxDays: 7 },
  { key: 'lastWeek', label: 'Last week', color: theme.coverageLastWeek, maxDays: 14 },
  { key: 'older', label: 'Older', color: theme.coverageOlder, maxDays: Infinity },
];

/** Web MapCard `colorFor`: bucket by days since `last_flown`; an unparseable date is "older". */
export function trackRecency(lastFlown: string | null | undefined, nowMs = Date.now()): Recency {
  const d = isoToDate(lastFlown);
  if (!d) return 'older';
  const days = (nowMs - d.getTime()) / DAY_MS;
  return RECENCY_LEGEND.find((r) => days <= r.maxDays)?.key ?? 'older';
}

export function recencyColor(r: Recency): string {
  return RECENCY_LEGEND.find((x) => x.key === r)?.color ?? theme.coverageOlder;
}

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** `[lat, lng]` pairs → react-native-maps coordinates; drops non-finite points so a bad row cannot break the Polyline. */
export function trackCoordinates(track: CoverageTrack): LatLng[] {
  const out: LatLng[] = [];
  for (const c of track.coords ?? []) {
    if (!Array.isArray(c) || c.length < 2) continue;
    const [latitude, longitude] = c;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
    out.push({ latitude, longitude });
  }
  return out;
}

/** Every drawable point across the tracks (for `fitToCoordinates`). */
export function coverageBounds(tracks: CoverageTrack[]): LatLng[] {
  return tracks.flatMap(trackCoordinates);
}

/**
 * Widget order = the user's saved layout (or the server default) sorted by `order`,
 * de-duplicated by type, unknown types dropped — the same rule DashboardPage.jsx applies.
 * `coverage_map` is appended when absent: the phone always shows the map card (empty state
 * explains how to fill it), because the small screen has no layout editor of its own.
 */
export const WIDGET_TYPES: ReadonlyArray<DashboardWidgetType> = [
  'stats',
  'live_streams',
  'recent_videos',
  'categories',
  'user_uploads',
  'recent_images',
  'coverage_map',
];

export const DEFAULT_WIDGET_ORDER: ReadonlyArray<DashboardWidgetType> = [
  'stats',
  'live_streams',
  'coverage_map',
  'recent_videos',
  'categories',
  'user_uploads',
  'recent_images',
];

export function widgetOrder(layout: DashboardLayoutEntry[] | null | undefined): DashboardWidgetType[] {
  if (!Array.isArray(layout) || layout.length === 0) return [...DEFAULT_WIDGET_ORDER];
  const seen = new Set<DashboardWidgetType>();
  const out: DashboardWidgetType[] = [];
  for (const entry of [...layout].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    const t = entry.type as DashboardWidgetType;
    if (!WIDGET_TYPES.includes(t) || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  if (!seen.has('coverage_map')) {
    // Right after the stats/live strip, where the web puts it once enabled.
    const at = out.indexOf('live_streams') >= 0 ? out.indexOf('live_streams') + 1 : out.indexOf('stats') >= 0 ? 1 : 0;
    out.splice(at, 0, 'coverage_map');
  }
  return out;
}

/** Does the SERVER consider the widget part of this user's layout (i.e. did it compute its data)? */
export function layoutHas(layout: DashboardLayoutEntry[] | null | undefined, type: DashboardWidgetType): boolean {
  return Array.isArray(layout) && layout.some((e) => e.type === type);
}

/** Dashboard `serialize_video` → the list-item shape `VideoCard`/`useOpenVideo` take (no event_id → one tap-time lookup). */
export function toListItem(v: DashboardVideo): VideoListItem {
  return {
    id: v.id,
    title: v.title,
    status: v.status,
    duration: v.duration ?? null,
    uploaded_filesize: v.uploaded_filesize ?? null,
    date_posted: v.date_posted ?? null,
    start: v.start ?? null,
    thumbnail_url: v.thumbnail_url ?? null,
    deleted_at: null,
    tail: v.tail ?? null,
    user: v.user ?? null,
  };
}

/** Split a flat list into rows of `cols` (a ScrollView cannot host a numColumns FlatList). */
export function chunk<T>(items: T[], cols: number): T[][] {
  const n = Math.max(1, Math.floor(cols));
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += n) rows.push(items.slice(i, i + n));
  return rows;
}

/** The web header line: "Org · Monday, 1 September 2026". */
export function dashboardSubtitle(orgName: string | null | undefined, now = new Date()): string {
  const date = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  return orgName ? `${orgName} · ${date}` : date;
}

/** Guards a payload from an older backend (missing arrays) so every section can `.map` safely. */
export function normalizeDashboard(raw: Partial<DashboardPayload> | null | undefined): DashboardPayload {
  const arr = <T>(x: T[] | null | undefined): T[] => (Array.isArray(x) ? x : []);
  return {
    org_name: raw?.org_name ?? '',
    current_username: raw?.current_username ?? '',
    stats: raw?.stats ?? null,
    live_streams: arr(raw?.live_streams),
    show_all_live_streams_link: !!raw?.show_all_live_streams_link,
    public_videos: arr(raw?.public_videos),
    rows: arr(raw?.rows),
    user_videos: arr(raw?.user_videos),
    recent_images: arr(raw?.recent_images),
    coverage_tracks: arr(raw?.coverage_tracks),
    current_user_video_ids: arr(raw?.current_user_video_ids),
    user_layout: arr(raw?.user_layout),
  };
}
