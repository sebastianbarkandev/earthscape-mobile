import { formatTime, formatFileSize, initialsOf, parseTimestamp, formatDate } from '../formatTime';

describe('formatTime (web parity)', () => {
  it('always shows hours by default', () => {
    expect(formatTime(0)).toBe('0:00:00');
    expect(formatTime(65)).toBe('0:01:05');
    expect(formatTime(3661)).toBe('1:01:01');
  });
  it('short form below an hour when alwaysShowHours=false', () => {
    expect(formatTime(65, false)).toBe('1:05');
    expect(formatTime(3661, false)).toBe('1:01:01');
  });
  it('floors fractions and tolerates junk', () => {
    expect(formatTime(59.9, false)).toBe('0:59');
    expect(formatTime(null)).toBe('0:00:00');
  });
});

describe('formatFileSize', () => {
  it('matches the web helper', () => {
    expect(formatFileSize(0)).toBeNull();
    expect(formatFileSize(1024)).toBe('1 KB');
    expect(formatFileSize(38825539)).toBe('37.03 MB');
  });
});

describe('initialsOf', () => {
  it('handles one and many words', () => {
    expect(initialsOf('oscar-006')).toBe('O');
    expect(initialsOf('Sebastian Barkan')).toBe('SB');
    expect(initialsOf('')).toBe('?');
  });
});

describe('parseTimestamp', () => {
  it('parses s, m:ss, h:mm:ss', () => {
    expect(parseTimestamp('90')).toBe(90);
    expect(parseTimestamp('1:30')).toBe(90);
    expect(parseTimestamp('0:01:30')).toBe(90);
    expect(Number.isNaN(parseTimestamp('abc'))).toBe(true);
  });
});

describe('formatDate', () => {
  it('formats in the requested zone and survives an invalid zone', () => {
    const s = formatDate(1460571274.92, 'US/Mountain');
    expect(s).toContain('2016');
    expect(formatDate(1460571274.92, 'Not/AZone')).toContain('2016');
    expect(formatDate(null)).toBe('');
  });
});
