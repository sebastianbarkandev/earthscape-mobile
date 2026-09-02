import { COMMAND_HELP, containsWakePhrase, normalizeUtterance, parseUtterance, VOICE_CONTEXTUAL_STRINGS, WAKE_PHRASES } from '../voice/grammar';

describe('voice grammar — normalization', () => {
  it.each([
    ['Mark.', 'mark'],
    ['  Clip   In!', 'clip in'],
    ['Time point', 'timepoint'],
    ['add a clip mark', 'add a clipmark'],
    ['Activate voice command', 'activate voice commands'],
    ['don’t', 'dont'],
  ])('%j → %j', (raw, expected) => {
    expect(normalizeUtterance(raw)).toBe(expected);
  });
});

describe('voice grammar — strict parse', () => {
  it.each([
    ['mark', [{ kind: 'mark' }]],
    ['Add mark', [{ kind: 'mark' }]],
    ['add a timepoint', [{ kind: 'mark' }]],
    ['Time point.', [{ kind: 'mark' }]],
    ['clip in', [{ kind: 'clip_in' }]],
    ['Start clip', [{ kind: 'clip_in' }]],
    ['clip out', [{ kind: 'clip_out' }]],
    ['End the clip', [{ kind: 'clip_out' }]],
    ['cancel clip', [{ kind: 'cancel_clip' }]],
    ['undo', [{ kind: 'undo' }]],
    ['delete last mark', [{ kind: 'undo' }]],
    ['deactivate voice commands', [{ kind: 'deactivate' }]],
    ['voice commands off', [{ kind: 'deactivate' }]],
    ['activate voice commands', [{ kind: 'activate' }]],
  ])('%j', (raw, expected) => {
    expect(parseUtterance(raw)).toEqual(expected);
  });

  it('takes several commands spoken in one breath, in order', () => {
    expect(parseUtterance('mark clip in')).toEqual([{ kind: 'mark' }, { kind: 'clip_in' }]);
    expect(parseUtterance('clip out mark')).toEqual([{ kind: 'clip_out' }, { kind: 'mark' }]);
  });

  it('label-style commands take the rest of the utterance as text', () => {
    expect(parseUtterance('label suspect vehicle heading north')).toEqual([{ kind: 'label', text: 'suspect vehicle heading north' }]);
    expect(parseUtterance('Call it bridge')).toEqual([{ kind: 'label', text: 'bridge' }]);
    expect(parseUtterance('mark label fire')).toEqual([{ kind: 'mark' }, { kind: 'label', text: 'fire' }]);
    expect(parseUtterance('label')).toEqual([]);
  });

  it('rejects anything that is not exactly the vocabulary', () => {
    expect(parseUtterance('please mark')).toEqual([]);
    expect(parseUtterance('mark the suspect')).toEqual([]);
    expect(parseUtterance('the clip is in')).toEqual([]);
    expect(parseUtterance('marker')).toEqual([]);
    expect(parseUtterance('')).toEqual([]);
    expect(parseUtterance('we should clip in soon')).toEqual([]);
  });
});

describe('voice grammar — wake phrase', () => {
  it('matches the wake phrase inside a longer sentence, but only whole', () => {
    expect(containsWakePhrase('activate voice commands')).toBe(true);
    expect(containsWakePhrase('okay activate voice commands')).toBe(true);
    expect(containsWakePhrase('Activate voice commands now')).toBe(true);
    expect(containsWakePhrase('voice commands on')).toBe(true);
    expect(containsWakePhrase('activate voice')).toBe(false);
    expect(containsWakePhrase('deactivate voice commands')).toBe(false);
    expect(containsWakePhrase('mark')).toBe(false);
  });

  it('every wake phrase parses as activate', () => {
    for (const p of WAKE_PHRASES) expect(parseUtterance(p)).toEqual([{ kind: 'activate' }]);
  });
});

describe('voice grammar — recognizer bias list', () => {
  it('is unique, short and under the contextualStrings cap', () => {
    expect(VOICE_CONTEXTUAL_STRINGS.length).toBeLessThanOrEqual(100);
    expect(new Set(VOICE_CONTEXTUAL_STRINGS).size).toBe(VOICE_CONTEXTUAL_STRINGS.length);
    for (const p of VOICE_CONTEXTUAL_STRINGS) {
      expect(p).toBe(normalizeUtterance(p));
      expect(p.split(' ').length).toBeLessThanOrEqual(4);
    }
  });

  it('every phrase in the bias list is accepted by the parser (alone or as a label prefix)', () => {
    for (const p of VOICE_CONTEXTUAL_STRINGS) {
      const alone = parseUtterance(p);
      const asLabel = parseUtterance(`${p} something`);
      expect(alone.length > 0 || (asLabel.length === 1 && asLabel[0].kind === 'label')).toBe(true);
    }
  });

  it('help lists the mark, clip, cancel, label, undo and deactivate commands', () => {
    expect(COMMAND_HELP.map((h) => h.say).join(' ')).toMatch(/Mark.*Clip in.*Cancel clip.*Label.*Undo.*Deactivate/s);
  });
});
