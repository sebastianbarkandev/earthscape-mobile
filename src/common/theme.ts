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

  // Shape
  radiusSm: 6,
  radiusMd: 12,
  radiusLg: 16,
  radiusPill: 999,

  // Player chrome over video (web .pl-* overlay recipes)
  overlayBg: 'rgba(0,0,0,0.55)',
  overlayBgStrong: 'rgba(0,0,0,0.75)',
  overlayText: '#FFFFFF',
  overlayTextMuted: 'rgba(255,255,255,0.7)',

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

  // Map layer colors (from web mapStyles usage)
  flightPath: '#FB8333',
  targetPath: '#1565C0',
  footprintFill: 'rgba(251,131,51,0.18)',
} as const;
