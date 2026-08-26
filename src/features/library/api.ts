import { api } from '@/common/api/client';

/**
 * GET /api/v1/videos/{id}/event_id (video_shell_config_api) — the ONE call the
 * app makes on tap when a list item lacks `event_id`. The earthscape-mobile
 * backend branch adds `event_id` to both list serializers, so against that
 * backend this is never called; against an older backend it is called once per
 * tap, never per list item (CLAUDE.md: no N-per-list requests).
 */
export function getEventId(videoId: number) {
  return api<{ event_id: number; video_id: number }>(`/api/v1/videos/${videoId}/event_id`);
}
