import { api } from '@/common/api/client';
import type { VideoListItem } from '@/features/library/librarySlice';

/** GET /api/v1/videos/filter_choices (videos_api.py) — populates the filter sheet. */
export interface FilterChoices {
  users: Array<{ id: number; first_name?: string | null; last_name?: string | null; username?: string; email?: string }>;
  tags: Array<{ slug: string; title: string; values: string[] }>;
  categories: Array<{ id: number; full_path?: string; name?: string }>;
  tail_numbers: string[];
}
export function getFilterChoices() {
  return api<FilterChoices>('/api/v1/videos/filter_choices');
}

/**
 * Filter params honoured by video_filters.apply_filters (traced 2026-08-25):
 * q (full-text on title+description), title (ilike), user (ids, repeatable),
 * tail (repeatable), category (ids), tag-<slug> (values, repeatable),
 * startTime/endTime ("HH:MM" in the org TZ), startDate/endDate (ms epoch on
 * date_posted). The web form's longerThan/shorterThan are NOT implemented server-side.
 */
export interface SearchFilters {
  q?: string;
  title?: string;
  user?: number[];
  tail?: string[];
  category?: number[];
  tags?: Record<string, string[]>; // slug -> values
  startTime?: string;
  endTime?: string;
  startDate?: number | null; // ms epoch
  endDate?: number | null;
}

export type SearchSort = 'recently-uploaded' | 'recently-recorded' | 'title-asc' | 'title-desc' | 'shortest' | 'longest';
export const SORT_OPTIONS: Array<{ value: SearchSort; label: string }> = [
  { value: 'recently-uploaded', label: 'Recently Uploaded' },
  { value: 'recently-recorded', label: 'Recently Recorded' },
  { value: 'title-asc', label: 'Title (A-Z)' },
  { value: 'title-desc', label: 'Title (Z-A)' },
  { value: 'shortest', label: 'Shortest' },
  { value: 'longest', label: 'Longest' },
];

export function buildSearchQuery(f: SearchFilters, sort: SearchSort, page: number, perPage = 24): string {
  const p: string[] = [];
  const add = (k: string, v: string | number) => p.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  if (f.q?.trim()) add('q', f.q.trim());
  if (f.title?.trim()) add('title', f.title.trim());
  f.user?.forEach((u) => add('user', u));
  f.tail?.forEach((t) => add('tail', t));
  f.category?.forEach((c) => add('category', c));
  Object.entries(f.tags ?? {}).forEach(([slug, values]) => values.forEach((v) => add(`tag-${slug}`, v)));
  if (f.startTime) add('startTime', f.startTime);
  if (f.endTime) add('endTime', f.endTime);
  if (f.startDate != null) add('startDate', f.startDate);
  if (f.endDate != null) add('endDate', f.endDate);
  add('sort', sort);
  add('page', page);
  add('per_page', perPage);
  return p.join('&');
}

export interface SearchPage {
  items: VideoListItem[];
  page: number;
  per_page: number;
  total: number;
  pages: number;
  has_next: boolean;
  has_prev: boolean;
  sort: string;
}
export function searchVideos(f: SearchFilters, sort: SearchSort, page: number) {
  return api<SearchPage>(`/api/v1/videos/list?${buildSearchQuery(f, sort, page)}`);
}

/** Number of active filter facets (for the Filters badge). */
export function countFilters(f: SearchFilters): number {
  let n = 0;
  if (f.title?.trim()) n++;
  if (f.user?.length) n++;
  if (f.tail?.length) n++;
  if (f.category?.length) n++;
  if (Object.values(f.tags ?? {}).some((v) => v.length)) n++;
  if (f.startTime || f.endTime) n++;
  if (f.startDate != null || f.endDate != null) n++;
  return n;
}
