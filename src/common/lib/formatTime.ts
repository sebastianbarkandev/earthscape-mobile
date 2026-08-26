/**
 * Port of the web's common/formatTime.js (moment/lodash dropped, same output):
 * h:mm:ss when >= 1h or alwaysShowHours, else m:ss. Hours are total hours (web
 * used moment.duration().hours(), which wraps at 24 — irrelevant for flights).
 */
export function formatTime(seconds: number | null | undefined, alwaysShowHours = true): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (s >= 3600 || alwaysShowHours) return `${h}:${pad(m)}:${pad(sec)}`;
  return `${m}:${pad(sec)}`;
}

/** Web PlayerActionRow.formatFileSize — 1024-based, 2 decimals, null for 0/undefined. */
export function formatFileSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + ' ' + sizes[i];
}

/** Web PlayerActionRow.initialsOf. */
export function initialsOf(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Web hooks/formatDate.js, FIXED to honour the org timezone (the web hardcodes
 * America/Denver). `tz` is the bootstrap `settings.tz` (e.g. 'US/Mountain').
 */
export function formatDate(epochSeconds: number | null | undefined, tz?: string | null): string {
  if (epochSeconds == null || !Number.isFinite(epochSeconds)) return '';
  const date = new Date(epochSeconds * 1000);
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  };
  try {
    return date.toLocaleDateString('en-US', tz ? { ...options, timeZone: tz } : options);
  } catch {
    return date.toLocaleDateString('en-US', options); // unknown IANA name -> device zone
  }
}

/** Web EditTimelineEventModal.parseTimestamp: "90" | "1:30" | "0:01:30" -> seconds, NaN on junk. */
export function parseTimestamp(input: string): number {
  const parts = input.trim().split(':').map((p) => Number(p));
  if (parts.length === 0 || parts.some((p) => !Number.isFinite(p))) return NaN;
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
