import React from 'react';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';
import { theme } from '@/common/theme';

/**
 * UI-021: `@expo/vector-icons/FontAwesome6.d.ts` declares the icon set as `any`, so
 * `ComponentProps<typeof FontAwesome6>['name']` was `any` too — a typo (or a Pro-only /
 * brands-only glyph) compiled fine and rendered a blank square at runtime. `string` at
 * least rejects non-strings; the real check is `iconNames.test.ts`, which validates every
 * name literal in the app against the FontAwesome6Free **solid** glyphmap.
 */
type FA6Name = string;

interface Props {
  /** FontAwesome 6 free-solid glyph name — the same names the web uses (fa-solid fa-*). */
  name: FA6Name;
  size?: number;
  color?: string;
  style?: React.ComponentProps<typeof FontAwesome6>['style'];
}

/** Thin wrapper so screens don't import the icon set everywhere (web parity: fa-solid). */
export function Icon({ name, size = 16, color = theme.textPrimary, style }: Props) {
  return <FontAwesome6 name={name} size={size} color={color} style={style} iconStyle="solid" />;
}

export type IconName = FA6Name;
