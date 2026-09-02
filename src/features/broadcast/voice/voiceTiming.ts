import type { VoiceTranscriptEvent } from '../../../../modules/earthscape-live';
import { isoToDate } from '@/common/lib/normalizeDate';

/**
 * Seconds subtracted from the moment the user STARTED speaking: what was worth marking
 * happened before they reacted to it. Same offset for marks and for clip in/out.
 */
export const DEFAULT_REACTION_OFFSET_SEC = 1.5;
export const REACTION_OFFSET_CHOICES = [0, 1, 1.5, 2, 3];

/** Same floor as the timeline card's clip-out. */
export const MIN_VOICE_CLIP_SEC = 1;

/** `active` falls back to `standby` after this much silence (ms). */
export const VOICE_IDLE_MS = 90_000;

/** The recognizer finalizes an utterance ~this long after the partial text stops changing (VoiceCommandRecognizer.utteranceGap). */
const UTTERANCE_GAP_SEC = 1.0;
/** Fallback speaking-rate estimate when the recognizer gave no word offsets. */
const SEC_PER_WORD = 0.35;

/**
 * Wall clock (unix seconds) at which the utterance began. Prefers the recognizer's own word
 * offset (request start + first segment timestamp); a final without offsets is estimated
 * backwards from its arrival: the utterance gap plus roughly how long the words took to say.
 */
export function utteranceStartUnix(ev: Pick<VoiceTranscriptEvent, 'text' | 'segments' | 'requestStartUnix'>, receivedAtMs: number): number {
  const first = ev.segments.find((s) => s.startUnix != null && s.startUnix > 0);
  if (first && first.startUnix != null) return first.startUnix;
  const words = ev.text.trim().split(/\s+/).filter(Boolean).length;
  return receivedAtMs / 1000 - UTTERANCE_GAP_SEC - Math.max(0.4, words * SEC_PER_WORD);
}

/** The instant a command refers to, never before the stream began. */
export function commandTimeUnix(startUnix: number, reactionOffsetSec: number, floorUnix: number | null): number {
  const t = startUnix - Math.max(0, reactionOffsetSec);
  return floorUnix != null && Number.isFinite(floorUnix) ? Math.max(floorUnix, t) : t;
}

/** `MobileStream.created_at` (ISO, may lack 'Z') → unix seconds, or null. */
export function streamStartUnix(createdAt: string | null | undefined): number | null {
  const d = isoToDate(createdAt);
  const ms = d?.getTime();
  return ms != null && Number.isFinite(ms) ? ms / 1000 : null;
}
