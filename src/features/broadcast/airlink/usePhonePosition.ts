import { useEffect, useState } from 'react';
import * as Location from 'expo-location';
import type { LatLon } from '@/common/geo';

export interface PhoneFix {
  loc: LatLon;
  accuracyM: number | null;
  /** Unix ms. */
  at: number;
}

/**
 * Where this phone is, for the ground↔air overlay. Never prompts: it only watches once location
 * is already granted (the telemetry checkbox / GPS hint own the permission dance), and re-checks
 * whenever `recheckKey` changes — the screen passes the telemetry state so a fresh grant is
 * picked up at once. Coarser than the telemetry watch on purpose; the two coexist.
 */
export function usePhonePosition(enabled: boolean, recheckKey: unknown): PhoneFix | null {
  const [fix, setFix] = useState<PhoneFix | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled || !perm.granted) return;
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 2000, distanceInterval: 2 },
          (loc) => {
            if (cancelled) return;
            const { latitude, longitude, accuracy } = loc.coords;
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
            setFix({ loc: [latitude, longitude], accuracyM: accuracy ?? null, at: loc.timestamp ?? Date.now() });
          },
        );
        if (cancelled) s.remove();
        else sub = s;
      } catch {
        /* no location: the overlay shows the aircraft without "me" */
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
      sub = null;
    };
  }, [enabled, recheckKey]);

  return enabled ? fix : null;
}
