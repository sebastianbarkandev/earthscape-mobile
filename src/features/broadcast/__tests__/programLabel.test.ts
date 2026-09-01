import { defaultProgramLabel, parseProgramLabels } from '../programLabel';

describe('defaultProgramLabel (LIVE-008)', () => {
  const ana = { first_name: 'Ana', username: 'ana.s' };
  it('names the camera after the user and numbers collisions across the phones already on the event', () => {
    expect(defaultProgramLabel(ana, [])).toBe('Mobile · Ana');
    expect(defaultProgramLabel(ana, ['Mobile · Ben', 'Mobile · Cy'])).toBe('Mobile · Ana');
    expect(defaultProgramLabel(ana, ['mobile · ana'])).toBe('Mobile · Ana 2');
    expect(defaultProgramLabel(ana, ['Mobile · Ana', 'Mobile · Ana 2'])).toBe('Mobile · Ana 3');
  });
  it('falls back to username, then a generic label', () => {
    expect(defaultProgramLabel({ first_name: '  ', username: 'ben' }, [])).toBe('Mobile · ben');
    expect(defaultProgramLabel(null, [])).toBe('Mobile · Phone');
  });
  it('three phones joining in turn end up with three distinct labels', () => {
    const taken: string[] = [];
    for (const u of [ana, ana, ana]) taken.push(defaultProgramLabel(u, taken));
    expect(new Set(taken).size).toBe(3);
  });
});

describe('parseProgramLabels', () => {
  it('accepts only a JSON array of strings, bounded', () => {
    expect(parseProgramLabels(JSON.stringify(['a', 'b']))).toEqual(['a', 'b']);
    expect(parseProgramLabels(JSON.stringify(['a', 1, null]))).toEqual(['a']);
    expect(parseProgramLabels('not json')).toEqual([]);
    expect(parseProgramLabels(undefined)).toEqual([]);
    expect(parseProgramLabels(JSON.stringify({ a: 1 }))).toEqual([]);
    expect(parseProgramLabels(JSON.stringify(Array.from({ length: 80 }, (_, i) => `p${i}`)))).toHaveLength(50);
  });
});
