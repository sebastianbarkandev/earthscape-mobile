import { gridColumns, scrollToIndexFallbackOffset } from '../layout';

describe('scrollToIndexFallbackOffset (RESP-017)', () => {
  it('estimates the row offset from the average measured row', () => {
    expect(scrollToIndexFallbackOffset({ index: 40, averageItemLength: 52 })).toBe(2080);
    expect(scrollToIndexFallbackOffset({ index: 0, averageItemLength: 52 })).toBe(0);
  });
  it('never returns a negative or NaN offset', () => {
    expect(scrollToIndexFallbackOffset({ index: 12, averageItemLength: 0 })).toBe(0);
    expect(scrollToIndexFallbackOffset({ index: 12, averageItemLength: NaN })).toBe(0);
    expect(scrollToIndexFallbackOffset({ index: -3, averageItemLength: 40 })).toBe(0);
  });
});

describe('gridColumns (RESP-011)', () => {
  it('phones and iPad Split View keep 2 columns', () => {
    expect(gridColumns(320)).toBe(2);
    expect(gridColumns(375)).toBe(2);
    expect(gridColumns(430)).toBe(2);
  });
  it('iPads get 3–4 columns so cards stay a sane width', () => {
    expect(gridColumns(768)).toBe(3);
    expect(gridColumns(1024)).toBe(4);
    expect(gridColumns(1366)).toBe(4);
  });
  it('degenerate widths fall back to 2', () => {
    expect(gridColumns(0)).toBe(2);
    expect(gridColumns(NaN)).toBe(2);
  });
});
