/**
 * The strict voice vocabulary for the Go Live screen. Everything the timeline card can do
 * to a live video (mark, clip in/out, cancel, label, undo) plus the wake/sleep phrases.
 *
 * Matching is whole-utterance: after normalization the text must decompose into a sequence
 * of known phrases (so "mark clip in" spoken in one breath yields two commands) — any
 * leftover word rejects the whole utterance. `label`-style commands consume the rest of the
 * utterance as free text. The recognizer is biased towards these phrases via
 * `VOICE_CONTEXTUAL_STRINGS` (SFSpeechRecognitionRequest.contextualStrings).
 */
export type VoiceCommand =
  | { kind: 'activate' }
  | { kind: 'deactivate' }
  | { kind: 'mark' }
  | { kind: 'clip_in' }
  | { kind: 'clip_out' }
  | { kind: 'cancel_clip' }
  | { kind: 'undo' }
  | { kind: 'label'; text: string };

type SimpleKind = Exclude<VoiceCommand['kind'], 'label'>;

/** Phrase → command. Longest phrases are tried first, so "add mark" wins over "mark". */
const SIMPLE: Record<SimpleKind, string[]> = {
  activate: ['activate voice commands', 'voice commands on', 'start voice commands', 'enable voice commands'],
  deactivate: ['deactivate voice commands', 'voice commands off', 'stop voice commands', 'disable voice commands'],
  mark: ['mark', 'add mark', 'add a mark', 'mark it', 'mark this', 'mark that', 'timepoint', 'add timepoint', 'add a timepoint', 'clipmark', 'add clipmark', 'add a clipmark'],
  clip_in: ['clip in', 'start clip', 'start a clip', 'begin clip', 'clip start'],
  clip_out: ['clip out', 'end clip', 'end the clip', 'stop clip', 'stop the clip', 'clip end', 'finish clip'],
  cancel_clip: ['cancel clip', 'cancel the clip', 'discard clip', 'discard the clip'],
  undo: ['undo', 'undo that', 'undo last', 'delete last mark', 'delete mark', 'delete that', 'remove last mark', 'remove mark'],
};

/** Prefixes that take the rest of the utterance as the mark's text. */
const LABEL_PREFIXES = ['label it', 'label', 'call it', 'name it', 'note', 'title'];

/** Spoken forms the recognizer tends to produce for our compound words. */
const ALIASES: [RegExp, string][] = [
  [/\btime point\b/g, 'timepoint'],
  [/\btime points\b/g, 'timepoint'],
  [/\bclip mark\b/g, 'clipmark'],
  [/\bclip marks\b/g, 'clipmark'],
  [/\bvoice command\b/g, 'voice commands'],
];

export const WAKE_PHRASES = SIMPLE.activate;

/** Every phrase the recognizer should favour (contextualStrings caps at 100). */
export const VOICE_CONTEXTUAL_STRINGS: string[] = [
  ...Object.values(SIMPLE).flat(),
  ...LABEL_PREFIXES,
].filter((p, i, all) => all.indexOf(p) === i);

/** Lower-case, no punctuation, single spaces, aliases folded. */
export function normalizeUtterance(text: string): string {
  let t = text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [re, to] of ALIASES) t = t.replace(re, to);
  return t;
}

const SIMPLE_PHRASES: { phrase: string; kind: SimpleKind }[] = (Object.keys(SIMPLE) as SimpleKind[])
  .flatMap((kind) => SIMPLE[kind].map((phrase) => ({ phrase, kind })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

const LABEL_SORTED = [...LABEL_PREFIXES].sort((a, b) => b.length - a.length);

const startsWithPhrase = (text: string, phrase: string) => text === phrase || text.startsWith(`${phrase} `);

/**
 * Strict parse of one utterance. Returns [] when any part of it is not a known phrase —
 * a voice command must never be inferred from a sentence that merely contains one.
 */
export function parseUtterance(raw: string): VoiceCommand[] {
  let text = normalizeUtterance(raw);
  const out: VoiceCommand[] = [];
  while (text.length) {
    const simple = SIMPLE_PHRASES.find((p) => startsWithPhrase(text, p.phrase));
    if (simple) {
      out.push({ kind: simple.kind });
      text = text.slice(simple.phrase.length).trim();
      continue;
    }
    const label = LABEL_SORTED.find((p) => text.startsWith(`${p} `));
    if (label) {
      const rest = text.slice(label.length).trim();
      if (!rest) return [];
      out.push({ kind: 'label', text: rest });
      text = '';
      continue;
    }
    return [];
  }
  return out;
}

/** Standby mode: the wake phrase may sit inside a longer sentence ("okay activate voice commands"). */
export function containsWakePhrase(raw: string): boolean {
  const text = normalizeUtterance(raw);
  return WAKE_PHRASES.some((p) => text === p || text.endsWith(` ${p}`) || text.startsWith(`${p} `) || text.includes(` ${p} `));
}

export const COMMAND_HELP: { say: string; does: string }[] = [
  { say: '“Mark”', does: 'adds a timepoint' },
  { say: '“Clip in” … “Clip out”', does: 'saves a clip between the two' },
  { say: '“Cancel clip”', does: 'drops an open clip' },
  { say: '“Label …”', does: 'names the last mark' },
  { say: '“Undo”', does: 'deletes the last mark' },
  { say: '“Deactivate voice commands”', does: 'back to listening for the wake phrase' },
];
