import { theme } from '@/common/theme';
import {
  chunk,
  coverageBounds,
  DEFAULT_WIDGET_ORDER,
  formatMiles,
  layoutHas,
  metersToMiles,
  normalizeDashboard,
  recencyColor,
  toListItem,
  trackCoordinates,
  trackRecency,
  widgetOrder,
} from '../dashboardModel';
import { DASHBOARD_PATH } from '../api';

const NOW = Date.UTC(2026, 8, 1, 12, 0, 0); // 2026-09-01T12:00Z
const iso = (daysAgo: number) => new Date(NOW - daysAgo * 86_400_000).toISOString().replace('Z', ''); // backend ISO lacks 'Z'

describe('distance', () => {
  it('converts metres to statute miles like the web StatsSection', () => {
    expect(metersToMiles(1609.34)).toBeCloseTo(1, 6);
    expect(metersToMiles(null)).toBe(0);
    expect(metersToMiles(NaN)).toBe(0);
  });
  it('formats one decimal below 100 mi and whole miles above', () => {
    expect(formatMiles(0)).toBe('0');
    expect(formatMiles(1609.34 * 12.34)).toBe('12.3');
    expect(formatMiles(1609.34 * 1234.6)).toBe((1235).toLocaleString());
  });
});

describe('coverage recency (web MapCard RECENCY buckets)', () => {
  it('buckets by days since last_flown, tolerating the Z-less ISO the backend sends', () => {
    expect(trackRecency(iso(0.5), NOW)).toBe('today');
    expect(trackRecency(iso(3), NOW)).toBe('thisWeek');
    expect(trackRecency(iso(10), NOW)).toBe('lastWeek');
    expect(trackRecency(iso(40), NOW)).toBe('older');
    expect(trackRecency(null, NOW)).toBe('older');
    expect(trackRecency('garbage', NOW)).toBe('older');
  });
  it('colours come from theme tokens that mirror the web legend', () => {
    expect(recencyColor('today')).toBe(theme.coverageToday);
    expect(recencyColor('thisWeek')).toBe(theme.coverageThisWeek);
    expect(recencyColor('lastWeek')).toBe(theme.coverageLastWeek);
    expect(recencyColor('older')).toBe(theme.coverageOlder);
    expect(new Set([theme.coverageToday, theme.coverageThisWeek, theme.coverageLastWeek, theme.coverageOlder]).size).toBe(4);
  });
});

describe('track coordinates', () => {
  it('maps [lat, lng] pairs and drops points that cannot be drawn', () => {
    const cs = trackCoordinates({ id: 1, last_flown: null, coords: [[45.1, -122.2], [NaN, 1], [91, 0], [1, 181], ['a' as never, 2], [45.2, -122.3]] });
    expect(cs).toEqual([
      { latitude: 45.1, longitude: -122.2 },
      { latitude: 45.2, longitude: -122.3 },
    ]);
    expect(trackCoordinates({ id: 2, last_flown: null, coords: undefined as never })).toEqual([]);
  });
  it('bounds = every drawable point of every track', () => {
    const pts = coverageBounds([
      { id: 1, last_flown: null, coords: [[1, 2]] },
      { id: 2, last_flown: null, coords: [[3, 4], [5, 6]] },
    ]);
    expect(pts).toHaveLength(3);
  });
});

describe('widget order', () => {
  it('follows the saved layout by `order`, dropping unknown and duplicate types', () => {
    const order = widgetOrder([
      { type: 'recent_videos', order: 2 },
      { type: 'stats', order: 0 },
      { type: 'weather' as never, order: 1 },
      { type: 'stats', order: 5 },
      { type: 'coverage_map', order: 3 },
    ]);
    expect(order).toEqual(['stats', 'recent_videos', 'coverage_map']);
  });
  it('always includes the coverage map, placed after the live strip / stats when the layout lacks it', () => {
    expect(widgetOrder([{ type: 'stats', order: 0 }, { type: 'live_streams', order: 1 }, { type: 'recent_videos', order: 2 }])).toEqual([
      'stats',
      'live_streams',
      'coverage_map',
      'recent_videos',
    ]);
    expect(widgetOrder([{ type: 'stats', order: 0 }, { type: 'recent_videos', order: 1 }])).toEqual(['stats', 'coverage_map', 'recent_videos']);
    expect(widgetOrder([{ type: 'recent_videos', order: 0 }])).toEqual(['coverage_map', 'recent_videos']);
  });
  it('falls back to the default order without a layout', () => {
    expect(widgetOrder(undefined)).toEqual([...DEFAULT_WIDGET_ORDER]);
    expect(widgetOrder([])).toEqual([...DEFAULT_WIDGET_ORDER]);
    expect(DEFAULT_WIDGET_ORDER).toContain('coverage_map');
  });
  it('layoutHas reports what the SERVER computed', () => {
    expect(layoutHas([{ type: 'stats', order: 0 }], 'coverage_map')).toBe(false);
    expect(layoutHas([{ type: 'coverage_map', order: 0 }], 'coverage_map')).toBe(true);
    expect(layoutHas(null, 'stats')).toBe(false);
  });
  it('the request asks the backend for the map widget regardless of the saved layout (additive param)', () => {
    expect(DASHBOARD_PATH).toBe('/api/v1/dashboard?widgets=coverage_map');
  });
});

describe('adapters', () => {
  it('toListItem yields the VideoCard/useOpenVideo shape with no event_id (one lookup on tap)', () => {
    const item = toListItem({ id: 9, title: 'T', status: 'ready', duration: 12, uploaded_filesize: null, start: null, date_posted: '2026-09-01T10:00:00', thumbnail_url: '/static/t.jpg', user: null, tail: 'N1' });
    expect(item).toEqual({ id: 9, title: 'T', status: 'ready', duration: 12, uploaded_filesize: null, date_posted: '2026-09-01T10:00:00', start: null, thumbnail_url: '/static/t.jpg', deleted_at: null, tail: 'N1', user: null });
    expect('event_id' in item).toBe(false);
  });
  it('chunk splits into rows of the grid column count', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
    expect(chunk([1, 2], 0)).toEqual([[1], [2]]);
  });
  it('normalizeDashboard fills every array an older backend may omit', () => {
    const d = normalizeDashboard({ org_name: 'Demo' } as never);
    expect(d.org_name).toBe('Demo');
    expect(d.stats).toBeNull();
    expect(d.coverage_tracks).toEqual([]);
    expect(d.user_layout).toEqual([]);
    expect(d.show_all_live_streams_link).toBe(false);
    expect(normalizeDashboard(null).rows).toEqual([]);
  });
});
