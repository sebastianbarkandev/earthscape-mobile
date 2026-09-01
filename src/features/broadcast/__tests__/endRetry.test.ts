import { ApiError } from '@/common/api/client';
import { endStreamWithRetry } from '../endRetry';

describe('endStreamWithRetry', () => {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };
  beforeEach(() => sleeps.splice(0));

  it('retries network failures with doubling backoff and succeeds', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ success: true });
    await expect(endStreamWithRetry(9, { send, sleep, baseMs: 1000 })).resolves.toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('stops on a definitive 4xx (already gone / not ours) and gives up after the attempt budget', async () => {
    const gone = jest.fn().mockRejectedValue(new ApiError(404, {}));
    await expect(endStreamWithRetry(9, { send: gone, sleep })).resolves.toBe(false);
    expect(gone).toHaveBeenCalledTimes(1);
    const down = jest.fn().mockRejectedValue(new ApiError(503, {}));
    await expect(endStreamWithRetry(9, { send: down, sleep, attempts: 3, baseMs: 100, maxMs: 150 })).resolves.toBe(false);
    expect(down).toHaveBeenCalledTimes(3);
    expect(sleeps).toEqual([100, 150]);
  });
});
