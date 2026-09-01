/** SEC-005 (mobile half): the UI must not advertise publishing to members the server should refuse. */
import { canAddCameraTo, canCreateLiveStream, joinGateFor } from '../liveGates';
import type { VideoPermissions } from '@/features/player/api';

const perms = (update: boolean): VideoPermissions => ({
  videos: { update, delete: false, download: false, share: false, suggest_deletion: true, draw: true },
  tags: { create: update, delete: update },
});
const live = { live_stream_state: 'live' as const };

describe('canAddCameraTo', () => {
  it('requires a live primary, publishing support and UPDATE on the video', () => {
    expect(canAddCameraTo(live, perms(true), true)).toBe(true);
    expect(canAddCameraTo(live, perms(false), true)).toBe(false);
    expect(canAddCameraTo(live, null, true)).toBe(false);
    expect(canAddCameraTo(live, perms(true), false)).toBe(false);
    expect(canAddCameraTo({ live_stream_state: 'recording_ready' }, perms(true), true)).toBe(false);
    expect(canAddCameraTo(null, perms(true), true)).toBe(false);
  });
});

describe('joinGateFor (SEC-017: the /golive?eventId= deep link runs the same gate as the button)', () => {
  it('allows only a live primary the caller may UPDATE, on a device that can publish', () => {
    expect(joinGateFor(live, perms(true), true)).toEqual({ ok: true });
    expect(joinGateFor(live, perms(false), true)).toMatchObject({ ok: false, reason: expect.stringMatching(/permission/i) });
    expect(joinGateFor(live, null, true)).toMatchObject({ ok: false, reason: expect.stringMatching(/permission/i) });
    expect(joinGateFor({ live_stream_state: 'recording_ready' }, perms(true), true)).toMatchObject({ ok: false, reason: expect.stringMatching(/not live/i) });
    expect(joinGateFor(null, perms(true), true)).toMatchObject({ ok: false, reason: expect.stringMatching(/no primary/i) });
    expect(joinGateFor(live, perms(true), false)).toMatchObject({ ok: false, reason: expect.stringMatching(/not available/i) });
  });
  it('never disagrees with canAddCameraTo', () => {
    for (const v of [live, { live_stream_state: 'processing' as const }, null]) {
      for (const p of [perms(true), perms(false), null]) {
        for (const avail of [true, false]) {
          expect(joinGateFor(v, p, avail).ok).toBe(canAddCameraTo(v, p, avail));
        }
      }
    }
  });
});

describe('canCreateLiveStream', () => {
  const base = { is_admin: false, nav_permissions: { can_read_videos: true, can_read_livestreams: true, can_read_uploader: true } };
  it('follows bootstrap nav_permissions.can_read_livestreams (what POST /live/streams checks)', () => {
    expect(canCreateLiveStream(base)).toBe(true);
    expect(canCreateLiveStream({ ...base, nav_permissions: { ...base.nav_permissions, can_read_livestreams: false } })).toBe(false);
  });
  it('admins always may; missing bootstrap leaves the decision to the server', () => {
    expect(canCreateLiveStream({ is_admin: true, nav_permissions: { can_read_livestreams: false } })).toBe(true);
    expect(canCreateLiveStream(null)).toBe(true);
    expect(canCreateLiveStream({ is_admin: false, nav_permissions: {} })).toBe(true);
  });
});
