import React from 'react';
import FontAwesome6 from '@expo/vector-icons/FontAwesome6';

type FA6Name = React.ComponentProps<typeof FontAwesome6>['name'];

interface Props {
  /** FontAwesome 6 free-solid glyph name — the same names the web uses (fa-solid fa-*). */
  name: FA6Name;
  size?: number;
  color?: string;
  style?: React.ComponentProps<typeof FontAwesome6>['style'];
}

/** Thin wrapper so screens don't import the icon set everywhere (web parity: fa-solid). */
export function Icon({ name, size = 16, color = '#0F0F0F', style }: Props) {
  return <FontAwesome6 name={name} size={size} color={color} style={style} iconStyle="solid" />;
}

export type IconName = FA6Name;
