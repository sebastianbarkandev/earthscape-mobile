import type { EventVideo, VideoPermissions } from './api';

/**
 * The web's button-visibility gates (PlayerActionRow / Buttons/*) lifted into
 * one pure function so every screen agrees. Permissions come from
 * GET /videos/{id}/event_id; feature flags from GET /bootstrap.
 */
export interface VideoCapabilities {
  isLive: boolean; // live_stream_state === 'live'
  isLiveish: boolean; // any live_stream_state except recording_ready (web DownloadButton.isLive)
  canSeek: boolean;
  canEdit: boolean; // permissions.videos.update
  canDelete: boolean; // permissions.videos.delete -> "Suggest deletion" (web shell semantics)
  canDownload: boolean; // permissions.videos.download
  showDownload: boolean; // !isLive && download_url
  canShare: boolean; // permissions.videos.share
  canClip: boolean; // signed-in user (web ButtonBar no-ops when config.current_user is null)
  canCreateTags: boolean;
  canDeleteTags: boolean;
  hasAudio: boolean;
  showTranscript: boolean; // has_audio && audio_enabled !== false
}

export function videoCapabilities(
  video: EventVideo | null,
  permissions: VideoPermissions | null,
  features: Record<string, boolean> | null | undefined,
  signedIn: boolean,
): VideoCapabilities {
  const state = video?.live_stream_state ?? null;
  const isLive = state === 'live';
  const isLiveish = !!state && state !== 'recording_ready';
  const p = permissions?.videos;
  return {
    isLive,
    isLiveish,
    canSeek: !isLive,
    canEdit: !!p?.update,
    canDelete: !!p?.delete,
    canDownload: !!p?.download,
    showDownload: !isLive && !!video?.download_url,
    canShare: !!p?.share,
    canClip: signedIn,
    canCreateTags: !!permissions?.tags?.create && (features?.tags_enabled ?? true),
    canDeleteTags: !!permissions?.tags?.delete,
    hasAudio: !!video?.has_audio,
    showTranscript: !!video?.has_audio && video?.audio_enabled !== false,
  };
}

/** Web LayoutButtons.normalizeLayout + Dashboard.shouldLayoutBeLocked. */
export type DashboardLayout = 'video' | 'split' | 'map';
export function effectiveLayout(video: EventVideo | null, requested: DashboardLayout): DashboardLayout {
  if (!video) return requested;
  if (video.has_map === false) return 'video';
  if (!video.has_video) return 'map';
  return requested;
}
