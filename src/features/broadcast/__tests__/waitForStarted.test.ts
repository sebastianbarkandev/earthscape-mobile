import { isTerminalStatus, waitForStreamStarted } from '../waitForStarted';

const noSleep = async () => undefined;

describe('waitForStreamStarted (dial only once the SRT listener is up)', () => {
  it('returns immediately when the stream is already started', async () => {
    const poll = jest.fn(async () => ({ status: 'started' }));
    const sleep = jest.fn(noSleep);
    await expect(waitForStreamStarted(poll, { sleep })).resolves.toBe('started');
    expect(poll).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('polls through starting → started, sleeping between polls', async () => {
    const statuses = ['starting', 'starting', 'started'];
    const poll = jest.fn(async () => ({ status: statuses.shift() ?? 'started' }));
    const sleep = jest.fn(noSleep);
    await expect(waitForStreamStarted(poll, { intervalMs: 1000, timeoutMs: 20000, sleep })).resolves.toBe('started');
    expect(poll).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('gives up with "timeout" without sleeping past the deadline', async () => {
    const poll = jest.fn(async () => ({ status: 'starting' }));
    const sleep = jest.fn(noSleep);
    await expect(waitForStreamStarted(poll, { intervalMs: 1000, timeoutMs: 3000, sleep })).resolves.toBe('timeout');
    // polls at t=0,1,2,3 → 4 polls, 3 sleeps; a 4th sleep would overshoot 3000 ms.
    expect(poll).toHaveBeenCalledTimes(4);
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('reports "ended" when the server tears the stream down before it starts', async () => {
    const statuses = ['starting', 'ending'];
    const poll = jest.fn(async () => ({ status: statuses.shift() ?? 'ended' }));
    await expect(waitForStreamStarted(poll, { sleep: noSleep })).resolves.toBe('ended');
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it('treats poll errors and null snapshots as "not yet"', async () => {
    let n = 0;
    const poll = jest.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('network blip');
      if (n === 2) return null;
      return { status: 'started' };
    });
    await expect(waitForStreamStarted(poll, { sleep: noSleep })).resolves.toBe('started');
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it('clamps absurd intervals so a misconfiguration cannot spin', async () => {
    const poll = jest.fn(async () => ({ status: 'starting' }));
    const sleep = jest.fn(noSleep);
    await waitForStreamStarted(poll, { intervalMs: 0, timeoutMs: 100, sleep });
    expect(sleep).toHaveBeenCalledWith(50);
  });

  /**
   * REG-008: the budget used to count only its own sleeps, so time spent INSIDE a poll was free.
   * `client.ts` has no request timeout of its own (iOS waits ~60 s), which is the documented
   * 2026-08-27 stage symptom: 30 s polls turned the 20 s deadline into ~10 minutes of
   * "Ready" with no error — the very hang this gate was written to convert into a message.
   */
  it('counts the time spent inside a slow poll against the budget', async () => {
    let clock = 0;
    const poll = jest.fn(async () => {
      clock += 30_000; // one stalled GET /live/streams/{id}
      return { status: 'starting' };
    });
    const sleep = jest.fn(noSleep);
    await expect(
      waitForStreamStarted(poll, { intervalMs: 1000, timeoutMs: 20_000, sleep, now: () => clock }),
    ).resolves.toBe('timeout');
    expect(poll).toHaveBeenCalledTimes(1); // not 21
    expect(sleep).not.toHaveBeenCalled();
  });

  it('a poll slower than the interval still gets its remaining budget, then gives up', async () => {
    let clock = 0;
    const poll = jest.fn(async () => {
      clock += 4000;
      return { status: 'starting' };
    });
    await expect(
      waitForStreamStarted(poll, { intervalMs: 1000, timeoutMs: 20_000, sleep: noSleep, now: () => clock }),
    ).resolves.toBe('timeout');
    // 4 s per poll -> the 5th poll returns at t=20 s and the next interval would overshoot.
    expect(poll).toHaveBeenCalledTimes(5);
  });

  it('defaults to the wall clock, so a real stall cannot outlive the deadline', async () => {
    const poll = jest.fn(async () => ({ status: 'starting' }));
    const t0 = Date.now();
    await expect(waitForStreamStarted(poll, { intervalMs: 50, timeoutMs: 120 })).resolves.toBe('timeout');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('knows which backend statuses are terminal', () => {
    expect(isTerminalStatus('ending')).toBe(true);
    expect(isTerminalStatus('ended')).toBe(true);
    expect(isTerminalStatus('starting')).toBe(false);
    expect(isTerminalStatus('started')).toBe(false);
    expect(isTerminalStatus(undefined)).toBe(false);
  });
});
