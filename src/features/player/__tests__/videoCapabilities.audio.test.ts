/**
 * LIVE audio reachability — `hasAudio` must not depend on the recording's ffprobe.
 *
 * `Video.has_audio` (backend models/video.py) is computed from `video.info`, the ffprobe of the
 * FINISHED recording, so it is false for the whole live window even when every HLS segment
 * carries AAC. Gating the volume control on it alone hid the control for the entire broadcast.
 * The web player special-cases `status === 'live'` in PlaybackControls.jsx / ControlPanel.jsx /
 * PlaybackControlProgressBar.jsx; this is the mobile half of that parity.
 */
import { videoCapabilities } from '../videoCapabilities';
import type { EventVideo } from '../api';
import { permissions, primaryVideo } from './fixtures';

const caps = (over: Partial<EventVideo>) =>
  videoCapabilities({ ...primaryVideo, ...over }, permissions, null, true);

describe('videoCapabilities.hasAudio', () => {
  it('is true for a live program that has no has_audio yet (no recording to ffprobe)', () => {
    expect(caps({ live_stream_state: 'live', status: 'live', has_audio: false, duration: null }).hasAudio).toBe(true);
  });

  it('is false when the uploader explicitly disabled audio, live or not', () => {
    expect(caps({ has_audio: true, audio_enabled: false }).hasAudio).toBe(false);
    expect(
      caps({ live_stream_state: 'live', status: 'live', has_audio: false, audio_enabled: false }).hasAudio,
    ).toBe(false);
  });

  it('still follows has_audio for VOD', () => {
    expect(caps({ has_audio: true }).hasAudio).toBe(true);
    expect(caps({ has_audio: false }).hasAudio).toBe(false);
  });

  it('does not reopen for the processing window, where has_audio is still unset', () => {
    expect(caps({ live_stream_state: 'processing', has_audio: false }).hasAudio).toBe(false);
  });

  it('leaves showTranscript on the recording (needs the finished audio track)', () => {
    expect(caps({ live_stream_state: 'live', has_audio: false }).showTranscript).toBe(false);
  });
});
