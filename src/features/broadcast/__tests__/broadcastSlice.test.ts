import reducer, { createBroadcast, endBroadcast, publisherError, publisherStateChanged, refreshBroadcast, type BroadcastState } from '../broadcastSlice';
import type { MobileStream } from '../api';

const stream: MobileStream = {
  id: 9, status: 'starting', video_id: 70, event_id: 7, is_primary: true, program_type: null, title: 't', created_at: null, ended_at: null,
  playlist_ready: false, playlist_url: '/live/9/playlist.m3u8', server_latency_ms: 120,
  ingest: { protocol: 'srt', host: 'h', port: 4096, passphrase: 'p', pbkeylen: 16, latency_ms: 400, url: 'srt://h:4096?mode=caller&passphrase=p&pbkeylen=16&latency=400' },
  telemetry_url: '/api/v1/live/streams/9/telemetry',
};
const init = (): BroadcastState => reducer(undefined, { type: 'x' });

describe('broadcastSlice lifecycle', () => {
  it('creating → ready → live → ended', () => {
    let s = reducer(init(), createBroadcast.pending('r', { event_id: 7 }));
    expect(s.phase).toBe('creating');
    expect(s.mode).toBe('join');
    s = reducer(s, createBroadcast.fulfilled(stream, 'r', { event_id: 7 }));
    expect(s.phase).toBe('ready');
    s = reducer(s, publisherStateChanged({ state: 'connecting', reason: 'connect' }));
    expect(s.phase).toBe('live');
    s = reducer(s, publisherStateChanged({ state: 'publishing', reason: 'connected' }));
    expect(s.startedAt).not.toBeNull();
    s = reducer(s, publisherStateChanged({ state: 'reconnecting', reason: 'connection lost', attempt: 2, nextRetryMs: 1500 }));
    expect(s.phase).toBe('live');
    expect(s.reconnectAttempt).toBe(2);
    expect(s.nextRetryMs).toBe(1500);
    s = reducer(s, endBroadcast.pending('r2', undefined));
    expect(s.phase).toBe('ending');
    s = reducer(s, endBroadcast.fulfilled('ending', 'r2', undefined));
    expect(s.phase).toBe('ended');
    expect(s.stream?.status).toBe('ending');
  });

  it('fatal publisher errors move to error; non-fatal only log', () => {
    let s = reducer(init(), createBroadcast.fulfilled(stream, 'r', {}));
    s = reducer(s, publisherError({ code: 'connect_failed', message: 'timeout', fatal: false }));
    expect(s.phase).toBe('ready');
    expect(s.lastEvent).toContain('connect_failed');
    s = reducer(s, publisherError({ code: 'reconnect_exhausted', message: 'gave up', fatal: true }));
    expect(s.phase).toBe('error');
    expect(s.error).toBe('gave up');
  });

  it('refresh keeps the original ingest but tracks server status', () => {
    let s = reducer(init(), createBroadcast.fulfilled(stream, 'r', {}));
    s = reducer(s, refreshBroadcast.fulfilled({ ...stream, status: 'started', playlist_ready: true, ingest: { ...stream.ingest, latency_ms: 120 } }, 'r', undefined));
    expect(s.stream?.playlist_ready).toBe(true);
    expect(s.stream?.ingest.latency_ms).toBe(400);
    s = reducer(s, refreshBroadcast.fulfilled({ ...stream, status: 'ended' }, 'r', undefined));
    expect(s.phase).toBe('ended');
  });
});
