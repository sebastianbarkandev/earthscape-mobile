import { TelemetryQueue, fixFromLocation } from '../telemetry';

describe('TelemetryQueue', () => {
  it('dedupes fixes closer than minIntervalMs and bounds the queue', () => {
    const q = new TelemetryQueue({ maxQueued: 3, minIntervalMs: 500 });
    expect(q.push({ lat: 1, lon: 2, timestamp_ms: 1000 })).toBe(true);
    expect(q.push({ lat: 1, lon: 2, timestamp_ms: 1200 })).toBe(false); // too close
    expect(q.push({ lat: 1, lon: 2, timestamp_ms: 2000 })).toBe(true);
    expect(q.push({ lat: 1, lon: 2, timestamp_ms: 3000 })).toBe(true);
    expect(q.push({ lat: 1, lon: 2, timestamp_ms: 4000 })).toBe(true);
    expect(q.pending).toBe(3);
    expect(q.dropped).toBe(1);
    expect(q.push({ lat: NaN, lon: 2, timestamp_ms: 5000 })).toBe(false);
  });

  it('flushes in one batch and keeps the batch on failure', async () => {
    const q = new TelemetryQueue();
    q.push({ lat: 1, lon: 2, timestamp_ms: 1000 });
    q.push({ lat: 1, lon: 2, timestamp_ms: 2000 });
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error('offline');
    };
    expect(await q.flush(failing)).toBe(0);
    expect(q.pending).toBe(2);
    expect(q.failures).toBe(1);
    const sent: number[] = [];
    expect(await q.flush(async (b) => { sent.push(b.length); })).toBe(2);
    expect(sent).toEqual([2]);
    expect(q.pending).toBe(0);
    expect(q.sent).toBe(2);
    expect(calls).toBe(1);
  });

  it('maps expo-location objects, ignoring unknown headings (-1)', () => {
    const f = fixFromLocation({ coords: { latitude: 39.7, longitude: -104.9, altitude: 1600, heading: -1 }, timestamp: 1700000000123.7 });
    expect(f).toEqual({ lat: 39.7, lon: -104.9, alt: 1600, heading: null, timestamp_ms: 1700000000124 });
    expect(fixFromLocation({ coords: { latitude: 1, longitude: 2, heading: 90 }, timestamp: 1 }).heading).toBe(90);
  });
});
