/**
 * The backend stores UTC datetimes and list endpoints emit bare ISO strings
 * WITHOUT a timezone suffix. Same normalization the web's LiveThumbnail does.
 */
export function normalizeIsoDate(s: string | null | undefined): string | null {
  if (!s) return null;
  return /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : s + 'Z';
}

export function isoToDate(s: string | null | undefined): Date | null {
  const n = normalizeIsoDate(s);
  return n ? new Date(n) : null;
}

export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds && seconds !== 0) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}
