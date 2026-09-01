/**
 * REG-001: `client.ts` had no AbortController, signal or timeout anywhere, so every request ran
 * to iOS URLSession's ~60 s default. Callers the user waits behind (the cold-start sign-out
 * debt) need a bound, and it must both reject AND abort so the socket is freed.
 */
import { api } from '../api/client';
import * as config from '../config';

const realFetch = global.fetch;
const jsonResponse = (body: unknown) =>
  ({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => JSON.stringify(body) }) as unknown as Response;

beforeEach(() => {
  config.setSubdomain('demo');
});
afterEach(() => {
  global.fetch = realFetch;
  config.clearSubdomain();
  jest.useRealTimers();
});

describe('api() request timeout', () => {
  it('rejects and aborts when the server accepts the connect and never answers', async () => {
    jest.useFakeTimers();
    let signal: AbortSignal | undefined;
    global.fetch = jest.fn((_url: unknown, init: any) => {
      signal = init?.signal;
      return new Promise<Response>(() => undefined); // never settles, like a captive portal
    }) as unknown as typeof fetch;

    const call = api('/signout', { timeoutMs: 5000 });
    const settled = jest.fn();
    void call.then(settled, settled);
    await jest.advanceTimersByTimeAsync(4999);
    expect(settled).not.toHaveBeenCalled(); // not a busy-wait: it really waits the budget
    await jest.advanceTimersByTimeAsync(2);
    await expect(call).rejects.toThrow(/timed out after 5000 ms/);
    expect(signal?.aborted).toBe(true);
  });

  it('leaves a prompt response alone and clears its timer', async () => {
    global.fetch = jest.fn(async () => jsonResponse({ ok: 1 })) as unknown as typeof fetch;
    await expect(api('/signout', { timeoutMs: 5000 })).resolves.toEqual({ ok: 1 });
  });

  it('sends no signal when no timeout is asked for (the default stays unchanged)', async () => {
    let init: any;
    global.fetch = jest.fn(async (_url: unknown, i: any) => {
      init = i;
      return jsonResponse({ ok: 2 });
    }) as unknown as typeof fetch;
    await expect(api('/signout')).resolves.toEqual({ ok: 2 });
    expect(init.signal).toBeUndefined();
  });
});
