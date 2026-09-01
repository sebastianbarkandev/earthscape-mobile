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

// ── multi-phone robustness (LIVE-005 / LIVE-009 / LIVE-015) ──
import { ApiError } from '@/common/api/client';
import { beginEnding, END_MAX_ATTEMPTS, msg } from '../broadcastSlice';

describe('stop sequence and /end retries', () => {
  const live = () => {
    let s = reducer(init(), createBroadcast.fulfilled(stream, 'r', { event_id: 7 }));
    s = reducer(s, publisherStateChanged({ state: 'publishing', reason: 'connected' }));
    return s;
  };

  it("beginEnding holds 'ending' while the native publisher winds down (preview must not re-enable Go live)", () => {
    let s = reducer(live(), beginEnding());
    expect(s.phase).toBe('ending');
    s = reducer(s, publisherStateChanged({ state: 'preview', reason: 'user' }));
    expect(s.phase).toBe('ending');
    s = reducer(s, publisherStateChanged({ state: 'idle', reason: 'preview stopped' }));
    expect(s.phase).toBe('ending');
  });

  it("endBroadcast.rejected keeps 'ending' with the stream id so the hook can retry, and gives up after END_MAX_ATTEMPTS", () => {
    let s = reducer(live(), endBroadcast.pending('r', undefined));
    for (let i = 1; i < END_MAX_ATTEMPTS; i++) {
      s = reducer(s, endBroadcast.rejected(null, 'r', undefined, 'Network request failed'));
      expect(s.phase).toBe('ending');
      expect(s.endAttempts).toBe(i);
      expect(s.error).toBe('Network request failed');
      expect(s.stream?.id).toBe(9);
    }
    s = reducer(s, endBroadcast.rejected(null, 'r', undefined, 'Network request failed'));
    expect(s.phase).toBe('ended');
    expect(s.endAttempts).toBe(END_MAX_ATTEMPTS);
  });

  it('a later successful /end (or the server already ending) clears the retry state', () => {
    let s = reducer(live(), endBroadcast.rejected(null, 'r', undefined, 'boom'));
    s = reducer(s, endBroadcast.pending('r2', undefined));
    expect(s.error).toBeNull();
    s = reducer(s, endBroadcast.fulfilled('ending', 'r2', undefined));
    expect(s.phase).toBe('ended');
    expect(s.endAttempts).toBe(0);
    let t = reducer(live(), endBroadcast.rejected(null, 'r', undefined, 'boom'));
    t = reducer(t, refreshBroadcast.fulfilled({ ...stream, status: 'ending' }, 'r', undefined));
    expect(t.phase).toBe('ended');
  });

  it('createBroadcast.pending resets the end counter for the next stream', () => {
    let s = reducer(live(), endBroadcast.rejected(null, 'r', undefined, 'boom'));
    s = reducer(s, createBroadcast.pending('r3', {}));
    expect(s.endAttempts).toBe(0);
  });
});

describe('msg(): server reasons instead of "HTTP 409"', () => {
  it('prefers {error} / {msg} / Flask-Security errors, falls back to a readable status', () => {
    expect(msg(new ApiError(409, { error: 'Event is not live' }))).toBe('Event is not live');
    expect(msg(new ApiError(401, { msg: 'Bad credentials' }))).toBe('Bad credentials');
    expect(msg(new ApiError(400, { response: { errors: ['You can only access this endpoint when not logged in.'] } }))).toBe(
      'You can only access this endpoint when not logged in.',
    );
    expect(msg(new ApiError(502, '<html>bad gateway</html>'))).toBe('Request failed (HTTP 502)');
    expect(msg(new Error('Network request failed'))).toBe('Network request failed');
    expect(msg('x')).toBe('Request failed');
  });

  it('the join 409 reaches the Go Live error card verbatim', () => {
    const s = reducer(reducer(init(), createBroadcast.pending('r', { event_id: 7 })), createBroadcast.rejected(null, 'r', { event_id: 7 }, 'Event is not live'));
    expect(s.phase).toBe('error');
    expect(s.error).toBe('Event is not live');
  });
});

// ── LIVE-031: the cause of a fatal failure outlives the automatic /end that follows it ──
import { resetBroadcast } from '../broadcastSlice';

describe('fatalReason survives the end sequence', () => {
  const fatal = (message: string) =>
    reducer(reducer(init(), createBroadcast.fulfilled(stream, 'r', { event_id: 7 })), publisherError({ code: 'server_not_started', message, fatal: true }));

  it('endBroadcast.pending/fulfilled clear `error` but keep `fatalReason`', () => {
    let s = fatal('The live server did not start the stream in time.');
    expect(s.fatalReason).toBe('The live server did not start the stream in time.');
    s = reducer(s, endBroadcast.pending('r2', undefined));
    expect(s.error).toBeNull();
    expect(s.fatalReason).toBe('The live server did not start the stream in time.');
    s = reducer(s, endBroadcast.fulfilled('ended', 'r2', undefined));
    expect(s.phase).toBe('ended');
    expect(s.fatalReason).toBe('The live server did not start the stream in time.');
  });

  it('a failing /end reports itself in `error` without overwriting the real cause', () => {
    let s = reducer(fatal('startPublish failed: camera busy'), endBroadcast.pending('r2', undefined));
    s = reducer(s, endBroadcast.rejected(null, 'r2', undefined, 'Network request failed'));
    expect(s.error).toBe('Network request failed');
    expect(s.fatalReason).toBe('startPublish failed: camera busy');
  });

  it('non-fatal publisher errors never set it, and a new broadcast / reset clears it', () => {
    let s = reducer(reducer(init(), createBroadcast.fulfilled(stream, 'r', {})), publisherError({ code: 'connect_failed', message: 'timeout', fatal: false }));
    expect(s.fatalReason).toBeNull();
    s = fatal('gave up');
    expect(reducer(s, createBroadcast.pending('r3', {})).fatalReason).toBeNull();
    expect(reducer(s, resetBroadcast()).fatalReason).toBeNull();
    // Publishing again (a later start on the same screen) drops the stale cause too.
    expect(reducer(s, publisherStateChanged({ state: 'publishing', reason: 'connected' })).fatalReason).toBeNull();
  });

  it('the SRT passphrase never reaches fatalReason (SEC-010)', () => {
    const s = fatal(`connect failed for ${stream.ingest.url}`);
    expect(s.fatalReason).not.toContain('passphrase=p&');
    expect(s.fatalReason).toContain('<redacted>');
    expect(s.error).toBe(s.fatalReason);
  });
});
