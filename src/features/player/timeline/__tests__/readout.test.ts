import { formatReadoutValue } from '../readout';

describe('formatReadoutValue (web InfoBox port)', () => {
  it('N/A for null', () => {
    expect(formatReadoutValue('Altitude', { unit: 'm' }, null)).toBe('N/A');
  });
  it('enum labels for INS Status / Autofocus State', () => {
    expect(formatReadoutValue('INS Status', null, 3)).toBe('3 (SOLUTION_GOOD)');
    expect(formatReadoutValue('INS Status', null, 99)).toBe('99 (UNKNOWN)');
    expect(formatReadoutValue('Autofocus State', null, 2)).toBe('2 (Running)');
    expect(formatReadoutValue('Autofocus State', null, 7)).toBe('7');
  });
  it('falls through to formatFlightPointValue', () => {
    expect(formatReadoutValue('Speed', { unit: 'percent' }, 12.5)).toBe('12.5 %');
  });
});
