import { api } from '@/common/api/client';

/**
 * `GET /api/v1/dashboard` (app/views/public.py `dashboard_api` → `build_homepage_data`),
 * the payload the web DashboardPage renders. Shapes traced to backend source 2026-09-01.
 *
 * Which widgets carry data is decided SERVER-SIDE by the user's saved `HomepageLayout`
 * (or `get_default_layout()`): a widget absent from `user_layout` arrives empty. The
 * default layout has no `coverage_map`, so `coverage_tracks` is `[]` until the user adds
 * the widget on the web dashboard (or the additive `?widgets=` param lands on the backend —
 * sent here already; today's backend ignores unknown query params).
 */
export type DashboardWidgetType =
  | 'stats'
  | 'live_streams'
  | 'recent_videos'
  | 'categories'
  | 'user_uploads'
  | 'recent_images'
  | 'coverage_map';

export interface DashboardLayoutEntry {
  type: DashboardWidgetType | string;
  order: number;
  categoryId?: number | null;
}

/** `serialize_video` in public.py — a subset of the /videos/list item, WITHOUT `event_id`. */
export interface DashboardVideo {
  id: number;
  title: string;
  status: string;
  duration: number | null;
  uploaded_filesize: number | null;
  start: string | null; // ISO, may lack 'Z'
  date_posted: string | null; // ISO, may lack 'Z'
  thumbnail_url: string | null;
  user: { id: number; username: string; full_name: string; profile_img_url: string | null } | null;
  tail: string | null;
}

export interface DashboardStats {
  vidtotal: number;
  vid7days: number;
  vid1month: number;
  /** Metres. */
  dist7days: number;
  /** Metres. */
  dist30days: number;
}

export interface DashboardCategoryRow {
  value: string;
  slug: string;
  category_id: number;
  videos: DashboardVideo[];
}

export interface DashboardImage {
  id: number;
  title: string | null;
  thumbnail_url: string | null;
  date_posted: string | null;
}

/** `Organization.recent_flight_tracks` — simplified [lat, lng] pairs per video, 14-day window. */
export interface CoverageTrack {
  id: number;
  coords: Array<[number, number]>;
  last_flown: string | null;
}

export interface DashboardPayload {
  org_name: string;
  current_username: string;
  stats: DashboardStats | null;
  live_streams: DashboardVideo[];
  show_all_live_streams_link: boolean;
  public_videos: DashboardVideo[];
  rows: DashboardCategoryRow[];
  user_videos: DashboardVideo[];
  recent_images: DashboardImage[];
  coverage_tracks: CoverageTrack[];
  current_user_video_ids: number[];
  user_layout: DashboardLayoutEntry[];
}

/** Widgets the phone always wants computed, whatever the saved web layout says (additive backend param). */
export const DASHBOARD_PATH = '/api/v1/dashboard?widgets=coverage_map';

export function getDashboard(): Promise<DashboardPayload> {
  // REG-001: a captive portal would otherwise hold the landing screen on its spinner forever.
  return api<DashboardPayload>(DASHBOARD_PATH, { timeoutMs: 20_000 });
}
