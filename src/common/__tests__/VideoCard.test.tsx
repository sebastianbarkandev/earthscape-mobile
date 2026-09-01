/**
 * UI-003: a grid card is `flex: 1`, and flex only shares a row between the children that
 * are PRESENT — a last row holding a single card (an odd-length library page, or exactly
 * one live stream) stretched that card across the full row width and with it the 16:9
 * thumbnail. The card must cap itself at one column.
 */
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import { StyleSheet } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { VideoCard } from '../components/VideoCard';
import { gridColumns, gridItemMaxWidth } from '../layout';
import type { VideoListItem } from '@/features/library/librarySlice';

jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => undefined), deleteItemAsync: jest.fn(async () => undefined) }));
jest.mock('@/common/components/LiveBadge', () => ({ LiveBadge: () => null }));

const item: VideoListItem = {
  id: 7, title: 'falls_1.ts', status: 'ready', duration: 61, uploaded_filesize: 1024,
  date_posted: '2026-08-25T10:00:00', start: '2026-08-25T09:00:00', thumbnail_url: null,
  deleted_at: null, user: null,
};

function cardStyle(columns?: number) {
  let r!: ReactTestRenderer;
  act(() => { r = create(<VideoCard item={item} columns={columns} onPress={() => undefined} />); });
  const pressable = r.root.find((n) => typeof n.type === 'string' && n.props.onStartShouldSetResponder !== undefined);
  const style = StyleSheet.flatten(pressable.props.style) as { flex?: number; maxWidth?: string };
  // The card renders a LiveBadge, whose `Animated.loop` keeps a JS-driver frame callback
  // pending for the whole file otherwise ("worker process failed to exit gracefully").
  act(() => { r.unmount(); });
  return style;
}

describe('gridItemMaxWidth', () => {
  it('is one column of the grid it is told about', () => {
    expect(gridItemMaxWidth(2)).toBe('50%');
    expect(gridItemMaxWidth(3)).toBe(`${100 / 3}%`);
    expect(gridItemMaxWidth(4)).toBe('25%');
  });
  it('falls back to the phone default for a missing or nonsense column count', () => {
    expect(gridItemMaxWidth()).toBe('50%');
    expect(gridItemMaxWidth(0)).toBe('50%');
    expect(gridItemMaxWidth(NaN)).toBe('50%');
  });
  it('matches the column policy the lists use', () => {
    expect(gridItemMaxWidth(gridColumns(393))).toBe('50%');
    expect(gridItemMaxWidth(gridColumns(1024))).toBe('25%');
  });
});

describe('VideoCard', () => {
  it('keeps flex:1 (even rows) but never grows past one column (lone last-row card)', () => {
    const two = cardStyle(2);
    expect(two.flex).toBe(1);
    expect(two.maxWidth).toBe('50%');
    expect(cardStyle(4).maxWidth).toBe('25%');
  });
  it('an unwired caller still gets the phone default, not a full-width card', () => {
    expect(cardStyle().maxWidth).toBe('50%');
  });
  it('every grid caller passes its own column count', () => {
    const ROOT = path.resolve(__dirname, '../../..');
    const callers = ['src/features/library/LibraryScreen.tsx', 'src/features/library/LiveListScreen.tsx', 'src/features/search/SearchScreen.tsx'];
    for (const f of callers) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const m of src.matchAll(/<VideoCard\b([^>]*)\/>/g)) expect({ f, attrs: /columns=\{cols\}/.test(m[1]) }).toEqual({ f, attrs: true });
    }
  });
});
