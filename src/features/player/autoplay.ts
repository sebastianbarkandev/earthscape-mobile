import { isCaptureAudioFocusHeld } from '@/features/broadcast/audioFocus';

/**
 * LIVE-026 / LIVE-029 — the ONE rule for "may this expo-video player start playing right now?".
 *
 * `useVideoPlayer(source, setup)` is `useReleasingSharedObject()` keyed on the source string
 * (node_modules/expo-video/build/VideoPlayer.js), so `setup` — and any `play()` inside it — runs
 * again for every newly mounted player AND every time an existing one's source changes. Both
 * happen repeatedly on a live event: the 20s `refreshEvent` adds/removes program tiles as phones
 * join and end, and swaps `hls_stream_url` from `/live/{id}/playlist.m3u8` to the recorded HLS as
 * soon as a recording is ready. An unconditional `play()` there
 *  (a) steals the process-wide AVAudioSession from the phone publisher — expo-video re-asserts
 *      `.playback` on every playingChange (see broadcast/audioFocus.ts), killing the microphone
 *      mid-broadcast (LIVE-024/LIVE-026), and
 *  (b) resurrects playback the viewer (or "Add my camera") had deliberately paused (LIVE-029).
 *
 * Both player owners — ProgramStrip's tiles and PlayerVideo's main viewport — ask this instead of
 * calling `play()` blind. `pausedIntent` is the OWNER's intent, never a `playingChange` mirror:
 * expo-video reports `isPlaying: false` for buffering too, and treating that as intent would leave
 * a stalling player paused for real (the same trap the store-driven pause loop had).
 */
export function shouldAutoplay(pausedIntent: boolean): boolean {
  return !pausedIntent && !isCaptureAudioFocusHeld();
}
