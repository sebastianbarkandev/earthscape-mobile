import type { Bootstrap } from '@/features/auth/bootstrap';
import type { EventVideo, VideoPermissions } from '@/features/player/api';

/**
 * Who may publish from the phone. The backend (live_mobile_api.py) currently only
 * requires LIVESTREAMS READ to create a stream and READ VIDEOS on the primary to
 * join a live event — SEC-005 asks for CREATE/UPDATE there. Until that lands the UI
 * must not advertise an action a read-only member shouldn't have, so the app gates
 * on what it already receives (nothing here is an invented backend field):
 *   - GET /api/v1/bootstrap → nav_permissions.can_read_livestreams, is_admin
 *   - GET /api/v1/videos/{id}/event_id → permissions.videos.update
 *       (= admin, or the uploader when USE_ACL is off, or an UPDATE VIDEOS grant)
 * Missing bootstrap/nav_permissions (older backend, fetch failed) keeps "Go live"
 * available — the server still decides; missing per-video permissions hides
 * "Add my camera", because attaching a camera to someone else's event is the
 * sensitive case.
 */
export function canCreateLiveStream(bootstrap: Pick<Bootstrap, 'nav_permissions' | 'is_admin'> | null | undefined): boolean {
  if (!bootstrap) return true;
  if (bootstrap.is_admin) return true;
  return bootstrap.nav_permissions?.can_read_livestreams !== false;
}

/** "Add my camera" on a live event: live now, publishing available, and the user may UPDATE the primary video. */
export function canAddCameraTo(
  video: Pick<EventVideo, 'live_stream_state'> | null | undefined,
  permissions: VideoPermissions | null | undefined,
  publishingAvailable: boolean,
): boolean {
  return !!video && video.live_stream_state === 'live' && publishingAvailable && permissions?.videos?.update === true;
}

/** Outcome of the join gate for `/golive?eventId=` — the same rule as "Add my camera", with a reason for the user (SEC-017). */
export type JoinGateResult = { ok: true } | { ok: false; reason: string };

/**
 * The deep-link join path must run the SAME gate as the PlayerScreen button: it is
 * evaluated against the event's PRIMARY video (the backend joins a phone only while
 * the primary is live) and the caller's permissions ON THAT PRIMARY. Missing data
 * denies — attaching a camera + GPS track to someone else's event is the sensitive case.
 */
export function joinGateFor(
  primary: Pick<EventVideo, 'live_stream_state'> | null | undefined,
  permissions: VideoPermissions | null | undefined,
  publishingAvailable: boolean,
): JoinGateResult {
  if (!publishingAvailable) return { ok: false, reason: 'Live publishing is not available on this device or is turned off for your organization.' };
  if (!primary) return { ok: false, reason: 'This event has no primary video to join.' };
  if (primary.live_stream_state !== 'live') return { ok: false, reason: 'This event is not live any more — a camera can only be added while the primary stream is live.' };
  if (!canAddCameraTo(primary, permissions, publishingAvailable)) return { ok: false, reason: "You don't have permission to add a camera to this event." };
  return { ok: true };
}
