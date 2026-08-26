/** Types for the verbatim formatFlightPointValue.js port. */
export interface NumberFormatSpec {
  useGrouping?: boolean;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  minimumSignificantDigits?: number;
  maximumSignificantDigits?: number;
}
/** One entry of bootstrap `settings.displayed_flight_point_fields_structure[category][name]`. */
export interface FlightPointFieldMeta {
  sources?: string[][];
  unit?: string | null;
  y_scale?: 'linear' | 'log' | string | null;
  number_max_significant_digits?: number | null;
  number_format?: NumberFormatSpec | null;
  formatting_function?: 'format_bytes' | 'format_mbps' | string | null;
  color?: string;
  valid_range?: { min: number; max: number } | null;
  valid_only_if_ts_program_matches?: boolean;
}
export function formatFlightPointValue(field: FlightPointFieldMeta | null | undefined, value: unknown): string;
