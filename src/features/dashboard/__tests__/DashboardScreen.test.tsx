/**
 * DashboardScreen against a canned /api/v1/dashboard payload (shape from public.py
 * `build_homepage_data`): widgets render in the saved layout's order, the coverage map's
 * empty state explains the layout gap, a failed refresh keeps the page and shows a banner,
 * and the first failure is a retryable error, not a blank screen (UI-005).
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { Provider } from 'react-redux';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { DashboardScreen } from '../DashboardScreen';
import type { DashboardPayload } from '../api';
import { makeStore, flush } from '@/features/player/__tests__/fixtures';

const mockApi = jest.fn();
const mockPush = jest.fn();
const mockOpen = jest.fn();

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/media', () => ({}));
jest.mock('@/common/components/Icon', () => ({ Icon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: (cb: () => void) => cb() }));
jest.mock('@/features/library/useOpenVideo', () => ({ useOpenVideo: () => mockOpen }));
jest.mock('@/common/api/client', () => ({ api: (...args: unknown[]) => mockApi(...args) }));
jest.mock('react-native-maps', () => {
  const React = require('react');
  const { View } = require('react-native');
  const MapView = React.forwardRef((p: { children?: React.ReactNode }, ref: unknown) => {
    React.useImperativeHandle(ref, () => ({ fitToCoordinates: jest.fn() }));
    return React.createElement(View, { testID: 'MapView' }, p.children);
  });
  const stub = (name: string) => (p: Record<string, unknown>) => React.createElement(View, { testID: name, ...p });
  return { __esModule: true, default: MapView, Polyline: stub('Polyline') };
});

const video = (id: number, title = `Video ${id}`): DashboardPayload['public_videos'][number] => ({
  id,
  title,
  status: 'ready',
  duration: 120,
  uploaded_filesize: null,
  start: '2026-09-01T09:00:00',
  date_posted: '2026-09-01T10:00:00',
  thumbnail_url: `/static/thumbs/${id}.jpg`,
  user: { id: 1, username: 'pat', full_name: 'Pat Pilot', profile_img_url: null },
  tail: 'N123AB',
});

const payload = (over: Partial<DashboardPayload> = {}): DashboardPayload => ({
  org_name: 'Demo Org',
  current_username: 'pat',
  stats: { vidtotal: 300, vid7days: 4, vid1month: 12, dist7days: 16093.4, dist30days: 160934 },
  live_streams: [],
  show_all_live_streams_link: false,
  public_videos: [video(1), video(2), video(3)],
  rows: [{ value: 'Patrol', slug: 'patrol', category_id: 7, videos: [video(4)] }],
  user_videos: [video(5)],
  recent_images: [],
  coverage_tracks: [],
  current_user_video_ids: [5],
  user_layout: [
    { type: 'stats', order: 0 },
    { type: 'live_streams', order: 1 },
    { type: 'recent_videos', order: 2 },
    { type: 'categories', order: 3 },
    { type: 'user_uploads', order: 4 },
  ],
  ...over,
});

/** Host nodes only — react-test-renderer also reports the composite element that owns the same props. */
const host = (n: ReactTestInstance) => typeof n.type === 'string';
/** The Pressable composite (its host View only has onClick) with this VoiceOver label. */
const button = (r: ReactTestRenderer, label: string) => r.root.findAllByType(Pressable).filter((n) => n.props.accessibilityLabel === label);
const texts = (r: ReactTestRenderer) =>
  r.root
    .findAllByType(Text)
    .map((t: ReactTestInstance) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .filter(Boolean);

async function render() {
  const store = makeStore();
  let r!: ReactTestRenderer;
  await act(async () => {
    r = create(
      <Provider store={store}>
        <DashboardScreen />
      </Provider>,
    );
  });
  await act(async () => {
    await flush();
  });
  return r;
}

beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockOpen.mockReset();
});

describe('DashboardScreen', () => {
  it('requests the dashboard once with the map widget asked for, and renders widgets in layout order', async () => {
    mockApi.mockResolvedValue(payload());
    const r = await render();
    expect(mockApi).toHaveBeenCalledTimes(1);
    expect(mockApi.mock.calls[0][0]).toBe('/api/v1/dashboard?widgets=coverage_map');
    const all = texts(r);
    const idx = (s: string) => all.findIndex((t) => t.includes(s));
    expect(idx('Dashboard')).toBeGreaterThanOrEqual(0);
    expect(all.find((t) => t.startsWith('Demo Org · '))).toBeDefined();
    // stats → (live: empty, skipped) → coverage map (inserted) → recent uploads → category → your uploads
    expect(idx('Flight stats')).toBeLessThan(idx('Flight coverage'));
    expect(idx('Flight coverage')).toBeLessThan(idx('Recent uploads'));
    expect(idx('Recent uploads')).toBeLessThan(idx('Patrol'));
    expect(idx('Patrol')).toBeLessThan(idx('Your uploads'));
    expect(idx('Live now')).toBe(-1);
    // 7-day window by default: 16093.4 m = 10 mi, 4 uploads, 300 total.
    expect(all).toContain('10');
    expect(all).toContain('4');
    expect(all).toContain('300');
    await act(async () => r.unmount());
  });

  it('coverage map: no tracks and not in the saved layout → explains how to enable it; no MapView is mounted', async () => {
    mockApi.mockResolvedValue(payload());
    const r = await render();
    expect(texts(r).some((t) => t.includes('not in your dashboard layout'))).toBe(true);
    expect(r.root.findAll((n) => host(n) && n.props?.testID === 'MapView')).toHaveLength(0);
    await act(async () => r.unmount());
  });

  it('coverage map: tracks present → one Polyline per drawable track, coloured by recency', async () => {
    const today = new Date().toISOString().replace('Z', '');
    mockApi.mockResolvedValue(
      payload({
        user_layout: [{ type: 'stats', order: 0 }, { type: 'coverage_map', order: 1 }],
        coverage_tracks: [
          { id: 11, coords: [[45.1, -122.1], [45.2, -122.2]], last_flown: today },
          { id: 12, coords: [[45.3, -122.3]], last_flown: today }, // a single point cannot be a line
          { id: 13, coords: [[45.4, -122.4], [45.5, -122.5]], last_flown: '2026-01-01T00:00:00' },
        ],
      }),
    );
    const r = await render();
    const lines = r.root.findAll((n) => host(n) && n.props?.testID === 'Polyline');
    expect(lines).toHaveLength(2);
    const { theme } = require('@/common/theme');
    expect(lines[0].props.strokeColor).toBe(theme.coverageToday);
    expect(lines[1].props.strokeColor).toBe(theme.coverageOlder);
    // Tapping a track opens its video through the shared opener (event id resolved on tap).
    await act(async () => lines[0].props.onPress());
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ id: 11 }));
    await act(async () => r.unmount());
  });

  it('live streams: hero for the first stream, "See all" only when the server says so', async () => {
    mockApi.mockResolvedValue(payload({ live_streams: [video(21, 'Pursuit'), video(22)], show_all_live_streams_link: true }));
    const r = await render();
    const hero = button(r, 'Watch live: Pursuit');
    expect(hero).toHaveLength(1);
    const seeAll = button(r, 'See all');
    expect(seeAll.length).toBeGreaterThanOrEqual(2); // live + recent uploads
    await act(async () => seeAll[0].props.onPress());
    expect(mockPush).toHaveBeenCalledWith('/(tabs)/live');
    await act(async () => r.unmount());
  });

  it('first load failure → retryable error state, and Retry re-requests', async () => {
    mockApi.mockRejectedValueOnce(new Error('offline'));
    mockApi.mockResolvedValueOnce(payload());
    const r = await render();
    expect(texts(r)).toContain('Could not load the dashboard');
    const retry = button(r, 'Retry')[0];
    await act(async () => retry.props.onPress());
    await act(async () => {
      await flush();
    });
    expect(mockApi).toHaveBeenCalledTimes(2);
    expect(texts(r)).toContain('Dashboard');
    await act(async () => r.unmount());
  });

  it('a failed refresh keeps the page and shows an alert banner instead of wiping it', async () => {
    mockApi.mockResolvedValueOnce(payload());
    mockApi.mockRejectedValueOnce(new Error('timeout'));
    const r = await render();
    const scroll = r.root.findAll((n) => host(n) && n.props?.refreshControl)[0];
    await act(async () => scroll.props.refreshControl.props.onRefresh());
    await act(async () => {
      await flush();
    });
    expect(r.root.findAll((n) => host(n) && n.props?.accessibilityRole === 'alert')).toHaveLength(1);
    expect(texts(r).some((t) => t.includes('Recent uploads'))).toBe(true);
    await act(async () => r.unmount());
  });
});
