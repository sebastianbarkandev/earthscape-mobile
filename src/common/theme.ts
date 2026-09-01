/**
 * Design tokens extracted from the web repo's player.scss (--pl-* variables).
 * The mobile app inherits Earthscape's visual identity — do not invent colors.
 */
export const theme = {
  // Brand accent ladder
  accent: '#FB8333',
  accentHover: '#FF9B58',
  accentActive: '#E9741F',
  accentTint: '#FFF3EA',
  accentSoft: 'rgba(251,131,51,0.10)',

  // Surfaces
  bg: '#F9F9F9',
  surface: '#FFFFFF',
  bgSubtle: '#F2F2F2',
  bgHover: '#E9E9E9',
  bgActive: '#DCDCDC',
  videoBg: '#0F0F0F',

  // Text
  textPrimary: '#0F0F0F',
  textSecondary: '#606060',
  textTertiary: '#909090',
  textOnAccent: '#FFFFFF',

  // Lines
  border: '#E5E5E5',
  borderStrong: '#D3D3D3',

  // Status
  danger: '#C62828',
  success: '#2E7D32',
  liveRed: '#CC0000',
  /** Degraded-but-working (SRT reconnecting) — amber, not red. */
  warning: '#B26A00',
  /** Warning text/value ON a dark overlay (the amber above is unreadable there). */
  warningText: '#FFB74D',
  /** Success text ON a dark overlay. */
  successText: '#81C784',
  successTint: '#EAF4EA',
  successBorder: '#CFE6CF',
  /** Border for an accentTint-filled notice card. */
  accentBorder: '#FFD9BF',

  // Shape — the ladder. `radiusPill` is also THE way to draw a circle (a square box with
  // a huge radius), so no component re-derives `size / 2` off-ladder (UI-014).
  /** Swatches / checkboxes under ~20pt, where 6 already reads as a circle. */
  radiusXs: 3,
  radiusSm: 6,
  radiusMd: 12,
  radiusLg: 16,
  radiusPill: 999,

  // Player chrome over video (web .pl-* overlay recipes)
  overlayBg: 'rgba(0,0,0,0.55)',
  overlayBgStrong: 'rgba(0,0,0,0.75)',
  overlayText: '#FFFFFF',
  overlayTextMuted: 'rgba(255,255,255,0.7)',
  /** Modal backdrop / "Connecting…" tile veil. */
  scrim: 'rgba(0,0,0,0.45)',
  /** Text shadow that keeps a white label legible over any video frame or map tile. */
  overlayShadow: 'rgba(0,0,0,0.80)',
  /** Glass control fill over video (speed pill, round buttons). */
  overlayControl: 'rgba(255,255,255,0.15)',
  /** Scrubber track over video. */
  overlayTrack: 'rgba(255,255,255,0.35)',
  /** Text input over video (Go Live stream name). */
  overlayField: 'rgba(255,255,255,0.12)',
  /** Outline of an unselected chip over video. */
  overlayBorder: 'rgba(255,255,255,0.30)',
  /** 1px border / divider over video (tile edges). */
  overlayHairline: 'rgba(255,255,255,0.15)',

  // Timeline (web _timeline_redesign.scss / Timeline.jsx)
  tlClipFill: 'rgba(251,131,51,0.32)',
  tlClipFillActive: 'rgba(251,131,51,0.45)',
  tlClipFillSystem: 'rgba(96,96,96,0.18)',
  tlClipFillSystemActive: 'rgba(96,96,96,0.28)',
  tlClipEdge: '#FB8333',
  tlClipEdgeSystem: '#606060',
  tlMarkPoint: '#FBC02D',
  tlMarkEvent: '#1976D2',
  tlPlayhead: '#CC0000',
  tlSkimmer: '#666666',
  tlGhost: 'rgba(251,131,51,0.22)',
  /** Metadata line when bootstrap sends no colour for the field (web timeline default). */
  graphDefault: '#CC0000',
  /**
   * Sensor-in-command bands (web Timeline.jsx). The toolbar swatches are DERIVED from
   * these (sensorBands.ts sensorSwatchColor) so a legend can never disagree with its band.
   */
  sensorBand1: 'rgba(173,216,230,0.4)',
  sensorBand2: '#FFEAEA',
  sensorBand3: 'rgba(255,255,0,0.4)',

  // Map layer colors (from web mapStyles usage)
  flightPath: '#FB8333',
  targetPath: '#1565C0',
  footprintFill: 'rgba(251,131,51,0.18)',
} as const;
