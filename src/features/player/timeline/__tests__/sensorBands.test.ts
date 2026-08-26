import { segmentsFromSeries, sensorColor } from '../sensorBands';

describe('segmentsFromSeries', () => {
  it('merges runs and leaves the last segment open', () => {
    const segs = segmentsFromSeries([[1, 1], [2, 1], [3, 2], [4, 3], [5, 3]]);
    expect(segs).toEqual([
      { startTime: 1, endTime: 3, value: 1 },
      { startTime: 3, endTime: 4, value: 2 },
      { startTime: 4, endTime: null, value: 3 },
    ]);
  });
  it('ignores junk', () => {
    expect(segmentsFromSeries([[1, 'x'], null as unknown as [number, unknown], [2, 2]])).toEqual([{ startTime: 2, endTime: null, value: 2 }]);
  });
  it('maps values to the web colours', () => {
    expect(sensorColor(1)).toBe('rgba(173,216,230,0.4)');
    expect(sensorColor(9)).toBeNull();
  });
});
