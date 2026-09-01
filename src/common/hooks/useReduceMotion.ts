import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * iOS "Reduce Motion" (RESP-008). Resolves asynchronously: `null` until the system has
 * answered, so callers that start continuous animation (LiveBadge pulse, camera easing)
 * wait for an explicit `false` instead of flashing motion at a user who opted out.
 */
export function useReduceMotion(): boolean | null {
  const [reduce, setReduce] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => { if (alive) setReduce(v); })
      .catch(() => { if (alive) setReduce(false); });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => setReduce(v));
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}

/** Camera / layout animation duration honouring Reduce Motion (null = not known yet → animate). */
export function motionDuration(reduce: boolean | null, normalMs: number): number {
  return reduce ? 0 : normalMs;
}
