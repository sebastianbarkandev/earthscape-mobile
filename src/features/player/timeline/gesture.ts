import { TAP_SLOP } from './constants';

/**
 * Responder policy for the timeline canvas, which lives inside the page ScrollView
 * (RESP-003). The canvas never claims a touch on START — a vertical swipe that begins on
 * the 110pt canvas must scroll the page, and taps are handled by a Pressable overlay — and
 * claims on MOVE only once the gesture is clearly horizontal (scrub / clip / handle drag)
 * or has two fingers (pinch zoom).
 */
export const HORIZONTAL_DOMINANCE = 1.2;

export function shouldClaimMove(dx: number, dy: number, touches: number, slop: number = TAP_SLOP): boolean {
  if (touches >= 2) return true;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) return false;
  if (ax < slop) return false;
  return ax > ay * HORIZONTAL_DOMINANCE;
}

export type CommittedGesture = 'scrub' | 'clipCreate' | 'handle' | 'pinch';

/**
 * Once a gesture is committed nothing may steal it (a scrub or clip drag that wanders
 * a little vertically must not hand the touch to the ScrollView mid-drag); with no
 * session there is nothing to protect.
 */
export function shouldReleaseResponder(kind: CommittedGesture | null | undefined): boolean {
  return kind == null;
}

/** Where the finger went down, recovered at claim time: gestureState.dx is cumulative since touch-down. */
export function touchDownX(locationX: number, dx: number): number {
  return locationX - dx;
}
