import { formatFlightPointValue, type FlightPointFieldMeta } from '@/common/lib/formatFlightPointValue';

const INS_STATUS: Record<number, string> = {
  0: 'INACTIVE', 1: 'ALIGNING', 2: 'HIGH_VARIANCE', 3: 'SOLUTION_GOOD', 4: 'SOLUTION_FREE',
  5: 'ALIGNMENT_COMPLETE', 6: 'DETERMINING_ORIENTATION', 7: 'WAITING_INITIAL_POSITION',
  8: 'WAITING_AZIMUTH', 9: 'INITIALIZING_BIASES', 10: 'MOTION_DETECT', 11: 'NO_COMMUNICATION', 12: 'INVALID',
};
const AUTOFOCUS: Record<number, string> = { 0: 'Unknown', 1: 'Not running', 2: 'Running' };

/**
 * Web InfoBox value text: N/A for null, enum labels for INS Status / Autofocus
 * State, otherwise formatFlightPointValue (unit, number_format, formatting fn).
 * The web's `window[formatting_function]` lookup is dropped (it never resolved).
 */
export function formatReadoutValue(name: string, meta: FlightPointFieldMeta | null | undefined, value: unknown): string {
  if (value == null) return 'N/A';
  if (name === 'INS Status') {
    const f = parseFloat(String(value));
    return `${value} (${INS_STATUS[f] ?? 'UNKNOWN'})`;
  }
  if (name === 'Autofocus State') {
    const f = parseFloat(String(value));
    const label = AUTOFOCUS[f];
    return label ? `${value} (${label})` : String(value);
  }
  return formatFlightPointValue(meta ?? {}, value);
}
