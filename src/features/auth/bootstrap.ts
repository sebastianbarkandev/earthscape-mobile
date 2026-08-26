import type { FlightPointFieldMeta } from '@/common/lib/formatFlightPointValue';

/** GET /api/v1/bootstrap (bootstrap_api.py) — verified at runtime 2026-08-25. */
export interface BootstrapUser {
  id: number;
  email: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  profile_img_url: string | null;
}

export type FieldsStructure = Record<string, Record<string, FlightPointFieldMeta>>;

export interface Bootstrap {
  current_user: BootstrapUser | null;
  is_admin: boolean;
  is_superadmin: boolean;
  cross_org_admin: boolean;
  csrf_token: string;
  urls: { api: string; static: string; www: string; logout: string; login: string } & Record<string, string>;
  settings: {
    website_name?: string;
    tz?: string;
    date_format_js?: string;
    displayed_flight_point_fields_structure?: FieldsStructure;
  } & Record<string, unknown>;
  /** snake_case org feature flags: tags_enabled, live_enabled, tak_enabled, csv_export, video_waveforms, ... */
  features: Record<string, boolean>;
  nav_permissions: Record<string, boolean>;
}

export function userDisplayName(u: { first_name?: string | null; last_name?: string | null; username?: string | null; email?: string | null } | null | undefined): string {
  if (!u) return 'Unknown user';
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim();
  return full || u.username || u.email || 'Unknown user';
}
