import React from 'react';
import { Platform, StyleSheet, View, type ViewProps } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

export interface EarthscapeLivePreviewViewProps extends ViewProps {
  /** 'resizeAspect' (letterbox) | 'resizeAspectFill' (crop) | 'resize' */
  videoGravity?: 'resizeAspect' | 'resizeAspectFill' | 'resize';
}

let NativeView: React.ComponentType<EarthscapeLivePreviewViewProps> | null = null;
if (Platform.OS === 'ios') {
  try {
    NativeView = requireNativeViewManager<EarthscapeLivePreviewViewProps>('EarthscapeLive');
  } catch {
    NativeView = null;
  }
}

/** Camera preview surface (MTHKView underneath). Renders a black box where the module is unavailable. */
export function EarthscapeLivePreviewView(props: EarthscapeLivePreviewViewProps) {
  if (!NativeView) return <View {...props} style={[styles.fallback, props.style]} />;
  return <NativeView {...props} />;
}

// The ONE colour literal outside `src/common/theme.ts`, and deliberately so: this is a
// separate private package (its own package.json + podspec) that the app depends on, never
// the other way round — importing `@/common/theme` here would invert that and tie the native
// module to the app's path aliases. It is also not a themed surface: it stands in for the
// camera feed, which is pure black when there is no signal. Pinned by
// src/common/__tests__/themeTokens.test.ts case D3.
const styles = StyleSheet.create({ fallback: { backgroundColor: '#000' } });
