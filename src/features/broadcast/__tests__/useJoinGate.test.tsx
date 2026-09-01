/** SEC-017: the deep-link join path evaluates the PRIMARY video's liveness + permissions before any camera starts. */
import React, { useEffect } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { useJoinGate, type JoinGate } from '../useJoinGate';
import { getEvent, getVideoPermissions, type EventVideo, type VideoPermissions } from '@/features/player/api';
import { ApiError } from '@/common/api/client';

jest.mock('@/features/player/api', () => ({
  getEvent: jest.fn(),
  getVideoPermissions: jest.fn(),
}));

const mockedEvent = getEvent as jest.MockedFunction<typeof getEvent>;
const mockedPerms = getVideoPermissions as jest.MockedFunction<typeof getVideoPermissions>;

const video = (id: number, is_primary: boolean, live_stream_state: EventVideo['live_stream_state']): EventVideo =>
  ({ id, event_id: 42, title: `v${id}`, description: '', duration: null, start: 1, end: 2, is_primary, program_type: null, status: 'ok',
    live_stream_state, hls_stream_url: null, mp4_url: null, stream_url: null, thumbnail_url: null, time_mapping: null, clipmarks: [], tail: null,
    has_audio: true, has_video: true }) as EventVideo;
const perms = (update: boolean): VideoPermissions => ({
  videos: { update, delete: false, download: false, share: false, suggest_deletion: true, draw: true },
  tags: { create: update, delete: update },
});
const eventWith = (...videos: EventVideo[]) => ({ events: [{ id: 42, tags: [], custom_field_values: null, videos }] });

function Probe({ eventId, available, onGate }: { eventId?: number; available: boolean; onGate: (g: JoinGate) => void }) {
  const gate = useJoinGate(eventId, available);
  useEffect(() => onGate(gate), [gate, onGate]);
  return null;
}

const flush = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });

describe('useJoinGate', () => {
  let renderer: ReactTestRenderer | null = null;
  let gate!: JoinGate;
  const mount = (eventId: number | undefined, available = true) => {
    act(() => {
      renderer = create(<Probe eventId={eventId} available={available} onGate={(g) => { gate = g; }} />);
    });
  };
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
  });

  it('is "none" without an eventId and calls nothing', async () => {
    mount(undefined);
    await flush();
    expect(gate).toEqual({ status: 'none' });
    expect(mockedEvent).not.toHaveBeenCalled();
  });

  it('starts "checking" and denies a read-only member — permissions are fetched for the PRIMARY, not the first video', async () => {
    mockedEvent.mockResolvedValue(eventWith(video(70, false, 'live'), video(7, true, 'live')));
    mockedPerms.mockResolvedValue({ event_id: 42, video_id: 7, permissions: perms(false) });
    mount(42);
    expect(gate).toEqual({ status: 'checking' });
    await flush();
    expect(mockedPerms).toHaveBeenCalledWith(7);
    expect(gate).toMatchObject({ status: 'denied', reason: expect.stringMatching(/permission/i) });
  });

  it('allows an UPDATE-holder on a live primary', async () => {
    mockedEvent.mockResolvedValue(eventWith(video(7, true, 'live')));
    mockedPerms.mockResolvedValue({ event_id: 42, video_id: 7, permissions: perms(true) });
    mount(42);
    await flush();
    expect(gate).toEqual({ status: 'allowed', primaryTitle: 'v7' });
  });

  it('denies when the primary is no longer live, or publishing is unavailable, even with UPDATE', async () => {
    mockedEvent.mockResolvedValue(eventWith(video(7, true, 'recording_ready')));
    mockedPerms.mockResolvedValue({ event_id: 42, video_id: 7, permissions: perms(true) });
    mount(42);
    await flush();
    expect(gate).toMatchObject({ status: 'denied', reason: expect.stringMatching(/not live/i) });
    act(() => renderer?.unmount());

    mockedEvent.mockResolvedValue(eventWith(video(7, true, 'live')));
    mount(42, false);
    await flush();
    expect(gate).toMatchObject({ status: 'denied', reason: expect.stringMatching(/not available/i) });
  });

  it("surfaces the server's own refusal (403 on the event) and denies", async () => {
    mockedEvent.mockRejectedValue(new ApiError(403, { meta: { code: 403 }, response: { errors: ['You do not have permission to view this event.'] } }));
    mount(42);
    await flush();
    expect(gate).toEqual({ status: 'denied', reason: 'You do not have permission to view this event.' });
    expect(mockedPerms).not.toHaveBeenCalled();
  });
});
