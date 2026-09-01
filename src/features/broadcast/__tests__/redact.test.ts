/** SEC-010: the SRT passphrase must never reach Redux display strings. */
import { redactSecrets } from '../redact';
import reducer, { publisherError } from '../broadcastSlice';

const url = 'srt://10.0.0.5:4096?mode=caller&passphrase=s3cr3tPASS&pbkeylen=16&latency=400';

describe('redactSecrets', () => {
  it('drops the query of srt:// URLs and masks stray passphrase values', () => {
    const out = redactSecrets(`Unsupported SRT URL: ${url}`);
    expect(out).toBe('Unsupported SRT URL: srt://10.0.0.5:4096?<redacted>');
    expect(redactSecrets('connect failed (passphrase=abc123 rejected)')).toBe('connect failed (passphrase=<redacted> rejected)');
    expect(redactSecrets('passphrase: abc123')).toBe('passphrase: <redacted>');
    expect(redactSecrets('SRT connect failed: timeout (ECONNREFUSED)')).toBe('SRT connect failed: timeout (ECONNREFUSED)');
    expect(redactSecrets(null)).toBe('');
  });
});

describe('broadcastSlice.publisherError', () => {
  it('never stores the passphrase in lastEvent or error', () => {
    let s = reducer(undefined, { type: 'init' });
    s = reducer(s, publisherError({ code: 'connect_failed', message: `Unsupported SRT URL: ${url}`, fatal: false }));
    expect(s.lastEvent).not.toContain('s3cr3tPASS');
    s = reducer(s, publisherError({ code: 'link_lost', message: `bad ${url}`, fatal: true }));
    expect(s.error).not.toContain('s3cr3tPASS');
    expect(s.lastEvent).not.toContain('s3cr3tPASS');
    expect(s.error).toBe('bad srt://10.0.0.5:4096?<redacted>');
  });
});
