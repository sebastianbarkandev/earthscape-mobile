import { ApiError } from '@/common/api/client';
import { endMobileStream } from './api';

/**
 * `POST /live/streams/{id}/end` with bounded exponential backoff. Used where no
 * component is left to drive a retry: the Go Live screen unmounting with a stream
 * still open (back gesture, deep link) and an orphaned stream found before creating
 * a new one. A definitive 4xx (404 gone / 403 not ours) stops immediately; network
 * errors and 5xx retry. Never throws.
 */
export const END_RETRY = { attempts: 5, baseMs: 1000, maxMs: 15000 };

export interface EndRetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  send?: (id: number) => Promise<unknown>;
  sleep?: (ms: number) => Promise<void>;
}

export async function endStreamWithRetry(id: number, opts: EndRetryOptions = {}): Promise<boolean> {
  const attempts = opts.attempts ?? END_RETRY.attempts;
  const baseMs = opts.baseMs ?? END_RETRY.baseMs;
  const maxMs = opts.maxMs ?? END_RETRY.maxMs;
  const send = opts.send ?? endMobileStream;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < attempts; i++) {
    try {
      await send(id);
      return true;
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0;
      if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
      if (i < attempts - 1) await sleep(Math.min(baseMs * 2 ** i, maxMs));
    }
  }
  return false;
}
