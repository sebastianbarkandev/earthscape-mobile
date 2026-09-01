import { shouldClaimMove, shouldReleaseResponder, touchDownX } from '../gesture';
import { TAP_SLOP } from '../constants';

describe('timeline responder policy (RESP-003)', () => {
  it('a vertical swipe on the canvas is NOT claimed (the page ScrollView keeps it)', () => {
    expect(shouldClaimMove(4, 30, 1)).toBe(false);
    expect(shouldClaimMove(-6, 80, 1)).toBe(false);
    expect(shouldClaimMove(20, 25, 1)).toBe(false); // diagonal, not horizontal-dominant
  });

  it('a horizontal drag beyond the tap slop is claimed (scrub / clip / handle)', () => {
    expect(shouldClaimMove(30, 4, 1)).toBe(true);
    expect(shouldClaimMove(-30, 4, 1)).toBe(true);
    expect(shouldClaimMove(TAP_SLOP, 0, 1)).toBe(true);
    expect(shouldClaimMove(TAP_SLOP - 1, 0, 1)).toBe(false); // still a tap
  });

  it('two fingers are always claimed (pinch zoom), even before any movement', () => {
    expect(shouldClaimMove(0, 0, 2)).toBe(true);
    expect(shouldClaimMove(0, 40, 2)).toBe(true);
  });

  it('never claims on garbage gesture state', () => {
    expect(shouldClaimMove(NaN, 0, 1)).toBe(false);
    expect(shouldClaimMove(0, 0, 1)).toBe(false);
  });

  it('a committed gesture refuses termination; an idle canvas releases', () => {
    expect(shouldReleaseResponder(null)).toBe(true);
    expect(shouldReleaseResponder(undefined)).toBe(true);
    for (const k of ['scrub', 'clipCreate', 'handle', 'pinch'] as const) expect(shouldReleaseResponder(k)).toBe(false);
  });

  it('recovers the touch-down x from the claim-time location and cumulative dx', () => {
    expect(touchDownX(130, 30)).toBe(100);
    expect(touchDownX(70, -30)).toBe(100);
  });
});
