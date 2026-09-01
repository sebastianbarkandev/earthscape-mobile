/**
 * Wait for the live server to bring the per-stream SRT listener up before the
 * phone dials it.
 *
 * `POST /api/v1/live/streams` returns immediately with status `starting`; the
 * live server claims the stream on its next poll (≈3 s on stage) and flips it to
 * `started` once the listener process is running. Dialing before that races the
 * listener startup — on 2026-08-27 the first stream after a 12 h idle sat in
 * "Connecting…" for good because the caller handshake never got an answer and
 * never errored. Gating on `started` removes the race; the timeout turns a
 * server that never starts the stream into a visible error instead of a hang.
 */
export type StreamStatusSnapshot = { status: string } | null;

export type WaitOutcome = 'started' | 'ended' | 'timeout';

export interface WaitForStartedOptions {
  /** Give up after this long (ms). Default 20 s — the live server usually needs ~3 s. */
  timeoutMs?: number;
  /** Poll interval (ms). Default 1 s. */
  intervalMs?: number;
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock (ms) for tests; wall-clock by default. */
  now?: () => number;
}

export const LISTENER_WAIT_MS = 20_000;
export const LISTENER_POLL_MS = 1_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** True for backend statuses that mean the stream is gone and will never start. */
export function isTerminalStatus(status: string | undefined | null): boolean {
  return status === 'ending' || status === 'ended';
}

/**
 * Polls `poll()` until it reports `started` (→ 'started'), a terminal status
 * (→ 'ended'), or the timeout elapses (→ 'timeout'). Poll errors are treated as
 * "not yet" so a transient network blip during the wait doesn't abort the start.
 * The first poll happens immediately; the wait never sleeps past the timeout.
 *
 * The budget is WALL-CLOCK (REG-008): counting only the sleeps meant a poll that
 * stalls (client.ts has no timeout of its own, so iOS waits ~60 s) did not spend
 * any budget at all — 30 s polls turned a 20 s deadline into ~10 minutes of
 * "Ready" with no error, i.e. exactly the hang this gate exists to prevent. The
 * accounted sleep time is still the floor, so an injected instant `sleep` keeps
 * behaving as virtual time in tests.
 */
export async function waitForStreamStarted(
  poll: () => Promise<StreamStatusSnapshot>,
  opts: WaitForStartedOptions = {},
): Promise<WaitOutcome> {
  const timeoutMs = opts.timeoutMs ?? LISTENER_WAIT_MS;
  const intervalMs = Math.max(50, opts.intervalMs ?? LISTENER_POLL_MS);
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;
  const startedAt = now();
  let slept = 0;
  for (;;) {
    let snapshot: StreamStatusSnapshot = null;
    try {
      snapshot = await poll();
    } catch {
      snapshot = null;
    }
    if (snapshot?.status === 'started') return 'started';
    if (isTerminalStatus(snapshot?.status)) return 'ended';
    const elapsed = Math.max(slept, now() - startedAt);
    if (elapsed + intervalMs > timeoutMs) return 'timeout';
    await sleep(intervalMs);
    slept += intervalMs;
  }
}
