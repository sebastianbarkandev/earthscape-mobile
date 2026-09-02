import { commandTimeUnix, DEFAULT_REACTION_OFFSET_SEC, REACTION_OFFSET_CHOICES, streamStartUnix, utteranceStartUnix } from '../voice/voiceTiming';

const T0 = 1_700_000_000;

describe('utteranceStartUnix', () => {
  it('prefers the recognizer’s own first-word offset', () => {
    const ev = {
      text: 'clip in',
      requestStartUnix: T0,
      segments: [
        { text: 'clip', startUnix: T0 + 3.2, durationSec: 0.3, confidence: 0.9 },
        { text: 'in', startUnix: T0 + 3.6, durationSec: 0.2, confidence: 0.9 },
      ],
    };
    expect(utteranceStartUnix(ev, (T0 + 10) * 1000)).toBe(T0 + 3.2);
  });

  it('ignores null / zero offsets (unset segment timestamps) and estimates from arrival instead', () => {
    const ev = { text: 'mark', requestStartUnix: T0, segments: [{ text: 'mark', startUnix: null, durationSec: 0, confidence: 0 }] };
    // arrival − 1.0 s utterance gap − max(0.4, 1 word × 0.35)
    expect(utteranceStartUnix(ev, (T0 + 10) * 1000)).toBeCloseTo(T0 + 10 - 1.0 - 0.4, 6);
    const zero = { ...ev, segments: [{ ...ev.segments[0], startUnix: 0 }] };
    expect(utteranceStartUnix(zero, (T0 + 10) * 1000)).toBeCloseTo(T0 + 10 - 1.4, 6);
  });

  it('longer utterances are estimated to have started earlier', () => {
    const ev = { text: 'label suspect vehicle heading north', requestStartUnix: T0, segments: [] };
    expect(utteranceStartUnix(ev, (T0 + 10) * 1000)).toBeCloseTo(T0 + 10 - 1.0 - 5 * 0.35, 6);
  });
});

describe('commandTimeUnix', () => {
  it('subtracts the reaction offset', () => {
    expect(commandTimeUnix(T0 + 20, 1.5, null)).toBe(T0 + 18.5);
    expect(commandTimeUnix(T0 + 20, 0, null)).toBe(T0 + 20);
  });

  it('never goes before the stream start, and ignores negative offsets', () => {
    expect(commandTimeUnix(T0 + 0.5, 1.5, T0)).toBe(T0);
    expect(commandTimeUnix(T0 + 20, -5, T0)).toBe(T0 + 20);
    expect(commandTimeUnix(T0 + 20, 1, NaN)).toBe(T0 + 19);
  });

  it('the default offset is one of the offered choices', () => {
    expect(REACTION_OFFSET_CHOICES).toContain(DEFAULT_REACTION_OFFSET_SEC);
    expect(REACTION_OFFSET_CHOICES).toContain(0);
  });
});

describe('streamStartUnix', () => {
  it('parses the API’s Z-less ISO created_at as UTC', () => {
    expect(streamStartUnix('2023-11-14T22:13:20')).toBe(T0);
    expect(streamStartUnix('2023-11-14T22:13:20Z')).toBe(T0);
  });
  it('null / garbage → null', () => {
    expect(streamStartUnix(null)).toBeNull();
    expect(streamStartUnix(undefined)).toBeNull();
    expect(streamStartUnix('not a date')).toBeNull();
  });
});
