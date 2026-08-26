// Contract tests for src/common/lib/normalizeDate.ts.
// List endpoints emit bare ISO strings with no timezone suffix; these are UTC.

import { formatDuration, isoToDate, normalizeIsoDate } from '../normalizeDate';

describe('normalizeIsoDate', () => {
  it('appends Z to a bare ISO string', () => {
    expect(normalizeIsoDate('2026-08-24T13:45:00')).toBe('2026-08-24T13:45:00Z');
    expect(normalizeIsoDate('2026-08-24T13:45:00.123456')).toBe('2026-08-24T13:45:00.123456Z');
    expect(normalizeIsoDate('2026-08-24 13:45:00')).toBe('2026-08-24 13:45:00Z');
  });

  it('leaves an already-zoned string untouched', () => {
    expect(normalizeIsoDate('2026-08-24T13:45:00Z')).toBe('2026-08-24T13:45:00Z');
    expect(normalizeIsoDate('2026-08-24T13:45:00+00:00')).toBe('2026-08-24T13:45:00+00:00');
    expect(normalizeIsoDate('2026-08-24T13:45:00-05:00')).toBe('2026-08-24T13:45:00-05:00');
    expect(normalizeIsoDate('2026-08-24T13:45:00-0500')).toBe('2026-08-24T13:45:00-0500');
  });

  it('returns null for empty input', () => {
    expect(normalizeIsoDate(null)).toBeNull();
    expect(normalizeIsoDate(undefined)).toBeNull();
    expect(normalizeIsoDate('')).toBeNull();
  });
});

describe('isoToDate', () => {
  it('parses a bare backend timestamp as UTC, not local time', () => {
    const d = isoToDate('2026-08-24T13:45:00') as Date;
    expect(d.toISOString()).toBe('2026-08-24T13:45:00.000Z');
    expect(d.getTime()).toBe(Date.UTC(2026, 7, 24, 13, 45, 0));
  });

  it('honours an explicit offset', () => {
    expect((isoToDate('2026-08-24T13:45:00-05:00') as Date).toISOString()).toBe(
      '2026-08-24T18:45:00.000Z',
    );
  });

  it('returns null for empty input', () => {
    expect(isoToDate(null)).toBeNull();
    expect(isoToDate('')).toBeNull();
  });
});

describe('formatDuration', () => {
  it('formats sub-hour durations as m:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(59)).toBe('0:59');
    expect(formatDuration(60)).toBe('1:00');
    expect(formatDuration(61)).toBe('1:01');
    expect(formatDuration(600)).toBe('10:00');
    expect(formatDuration(3599)).toBe('59:59');
  });

  it('rolls over to h:mm:ss at one hour', () => {
    expect(formatDuration(3600)).toBe('1:00:00');
    expect(formatDuration(3661)).toBe('1:01:01');
    expect(formatDuration(7325)).toBe('2:02:05');
    expect(formatDuration(36000)).toBe('10:00:00');
  });

  it('truncates fractional seconds rather than rounding', () => {
    expect(formatDuration(59.9)).toBe('0:59');
    expect(formatDuration(3599.99)).toBe('59:59');
  });

  it('returns an empty string for a missing duration, but formats a real zero', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(undefined)).toBe('');
    expect(formatDuration(NaN)).toBe('');
    expect(formatDuration(0)).toBe('0:00');
  });

  it('produces garbage for negative input (documented, not endorsed)', () => {
    // Durations from the API are never negative; pinned so a future change here
    // is a deliberate one rather than a silent shift in VideoCard's label.
    expect(formatDuration(-5)).toBe('-1:-5');
  });
});
