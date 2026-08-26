import type { Clipmark } from '../../api';
import { canEditClipmark, clipmarkTitle, formatDurationLabel, getEventType, nextClipmark, prevClipmark, sortedByStart, timelineGlyph } from '../clipmarkUtils';

const cm = (p: Partial<Clipmark>): Clipmark => ({ id: 1, type: null, text: null, time_start: null, time_end: null, ...p });

describe('getEventType (web eventCardUtils port)', () => {
  it('classifies the_json markers first', () => {
    expect(getEventType(cm({ the_json: { data: { command: 'action', markerCat: 'Note' } } })).key).toBe('note');
    expect(getEventType(cm({ the_json: { data: { command: 'action', markerCat: 'Plate' } } })).key).toBe('plate');
    expect(getEventType(cm({ the_json: { stream: 'GEODBJSON', data: { command: 'x', layer: 'PlateReader' } } })).key).toBe('plate');
    expect(getEventType(cm({ the_json: { data: { command: 'action' } } })).key).toBe('marker');
  });
  it('falls back to type, then time shape', () => {
    expect(getEventType(cm({ type: 'clip' })).label).toBe('Clip');
    expect(getEventType(cm({ type: 'tak' })).label).toBe('TAK Drawing');
    expect(getEventType(cm({ type: 'coordinates' })).key).toBe('coordinates');
    expect(getEventType(cm({ type: 'weird', time_start: 5 })).key).toBe('timepoint');
    expect(getEventType(cm({ type: 'weird' })).key).toBe('event');
  });
});

describe('timelineGlyph', () => {
  it('bands clips, points timepoints, notches markers, hides chat', () => {
    expect(timelineGlyph(cm({ type: 'clip', time_start: 1, time_end: 5 }))).toBe('band');
    expect(timelineGlyph(cm({ type: 'timepoint', time_start: 1 }))).toBe('point');
    expect(timelineGlyph(cm({ time_start: 1, the_json: { data: { command: 'action', name: 'create_marker' } } }))).toBe('markerOpen');
    expect(timelineGlyph(cm({ time_start: 1, the_json: { data: { command: 'action', name: 'close_marker' } } }))).toBe('markerClose');
    expect(timelineGlyph(cm({ type: 'tak_chat', time_start: 1 }))).toBe('none');
    expect(timelineGlyph(cm({ type: 'coordinates' }))).toBe('none');
  });
});

describe('canEditClipmark', () => {
  const own = cm({ user: { id: 7 } });
  it('own or update permission; never system', () => {
    expect(canEditClipmark(own, 7, false)).toBe(true);
    expect(canEditClipmark(own, 8, false)).toBe(false);
    expect(canEditClipmark(own, 8, true)).toBe(true);
    expect(canEditClipmark(cm({ user: null }), 7, true)).toBe(false);
    expect(canEditClipmark(own, null, true)).toBe(false);
  });
});

describe('formatDurationLabel / clipmarkTitle', () => {
  it('formats compact durations', () => {
    expect(formatDurationLabel({ time_start: 0, time_end: 14 })).toBe('14s');
    expect(formatDurationLabel({ time_start: 0, time_end: 125 })).toBe('2m 5s');
    expect(formatDurationLabel({ time_start: 0, time_end: 3600 })).toBe('1h');
    expect(formatDurationLabel({ time_start: 0, time_end: null })).toBeNull();
  });
  it('title falls back through text -> label -> type', () => {
    expect(clipmarkTitle(cm({ text: 'hi' }))).toBe('hi');
    expect(clipmarkTitle(cm({ the_json: { data: { label: 'L' } } }))).toBe('L');
    expect(clipmarkTitle(cm({ type: 'clip' }))).toBe('Clip');
  });
});

describe('prev/next with wrap (web Lower.jsx)', () => {
  const list = sortedByStart([cm({ id: 3, time_start: 30 }), cm({ id: 1, time_start: 10 }), cm({ id: 2, time_start: 20 }), cm({ id: 9, type: 'tak_chat', time_start: 5 })]);
  it('sorts and skips chat', () => {
    expect(list.map((c) => c.id)).toEqual([1, 2, 3]);
  });
  it('wraps around', () => {
    expect(nextClipmark(list, 25)?.id).toBe(3);
    expect(nextClipmark(list, 35)?.id).toBe(1);
    expect(prevClipmark(list, 25)?.id).toBe(2);
    expect(prevClipmark(list, 5)?.id).toBe(3);
  });
});
