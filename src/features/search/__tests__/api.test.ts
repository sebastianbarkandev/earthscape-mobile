import { buildSearchQuery, countFilters } from '../api';

describe('buildSearchQuery (video_filters.apply_filters params)', () => {
  it('encodes every facet the backend honours, repeating multi-values', () => {
    const q = buildSearchQuery(
      { q: 'falls river', title: 'a b', user: [1, 2], tail: ['N1', 'N2'], category: [7], tags: { agency: ['x', 'y'] }, startTime: '08:00', endTime: '17:30', startDate: 1000, endDate: 2000 },
      'longest',
      3,
    );
    expect(q).toBe('q=falls%20river&title=a%20b&user=1&user=2&tail=N1&tail=N2&category=7&tag-agency=x&tag-agency=y&startTime=08%3A00&endTime=17%3A30&startDate=1000&endDate=2000&sort=longest&page=3&per_page=24');
  });
  it('omits empty facets', () => {
    expect(buildSearchQuery({ q: '  ', user: [], tags: { a: [] } }, 'recently-uploaded', 1)).toBe('sort=recently-uploaded&page=1&per_page=24');
  });
  it('counts active facets', () => {
    expect(countFilters({})).toBe(0);
    expect(countFilters({ title: 'x', user: [1], tags: { a: ['v'] }, startTime: '09:00', endDate: 5 })).toBe(5);
  });
});
