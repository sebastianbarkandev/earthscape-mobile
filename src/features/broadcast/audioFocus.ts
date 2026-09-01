import { useEffect, useSyncExternalStore } from 'react';

/**
 * LIVE-024 — process-wide "the camera owns the audio session" flag.
 *
 * The phone publisher needs an `AVAudioSession` in `.playAndRecord` / `.videoRecording`
 * (LivePublisher.configureAudioSession, entered by `startPreview`). expo-video shares that
 * ONE session and re-asserts `.playback` / `.moviePlayback` on every player state change
 * (`VideoManager.setAudioSession()` from `VideoPlayer.onIsPlayingChanged`,
 * node_modules/expo-video/ios/VideoPlayer.swift:322) — it sets the CATEGORY unconditionally,
 * so a muted player or an `audioMixingMode` override does NOT make it harmless. Any expo-video
 * player that stalls, resumes or reloads while the phone is publishing therefore knocks out
 * microphone capture mid-broadcast.
 *
 * Deliberately NOT Redux: this is a native-resource lock, not domain state, it must be readable
 * synchronously by whoever holds a player, and it is owned by a screen's lifetime rather than by
 * a slice's actions. Reference-counted so overlapping mounts (React strict-mode double effects)
 * cannot release a hold somebody else still needs.
 *
 * Producers: `useHoldCaptureAudioFocus()` (GoLiveScreen — held for the whole screen lifetime,
 * i.e. from before `startPreview` until after the preview is torn down).
 * Consumers: `useCaptureAudioFocusHeld()` (ProgramStrip tiles freeze while it is true).
 */
let holders = 0;
const listeners = new Set<() => void>();

/** True while some screen owns the audio session for capture (camera preview / publishing). */
export const isCaptureAudioFocusHeld = () => holders > 0;

/** Take the hold; call the returned function exactly once to release it (idempotent). */
export function acquireCaptureAudioFocus(): () => void {
  holders += 1;
  if (holders === 1) listeners.forEach((l) => l());
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders -= 1;
    if (holders === 0) listeners.forEach((l) => l());
  };
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Hold the capture audio focus for the lifetime of the calling component. */
export function useHoldCaptureAudioFocus(): void {
  useEffect(() => acquireCaptureAudioFocus(), []);
}

/** Re-renders the caller when the hold is taken / released. */
export function useCaptureAudioFocusHeld(): boolean {
  return useSyncExternalStore(subscribe, isCaptureAudioFocusHeld, isCaptureAudioFocusHeld);
}
