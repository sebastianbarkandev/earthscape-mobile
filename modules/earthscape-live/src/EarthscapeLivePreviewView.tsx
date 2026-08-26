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

const styles = StyleSheet.create({ fallback: { backgroundColor: '#000' } });
