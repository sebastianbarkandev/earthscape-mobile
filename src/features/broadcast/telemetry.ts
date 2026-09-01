import type { TelemetryFix } from './api';

/**
 * Telemetry batching: fixes are queued as they arrive (~1 Hz) and flushed in
 * one POST every `flushIntervalMs`; on failure the batch is kept (bounded) and
 * retried with the next flush, so a flaky link drops old points rather than
 * blocking the stream. Pure — the caller supplies the sender.
 */
export interface TelemetryQueueOptions {
  maxQueued?: number; // default 120 (~2 minutes at 1 Hz)
  minIntervalMs?: number; // dedupe: skip a fix closer than this to the previous one
}

export class TelemetryQueue {
  private queue: TelemetryFix[] = [];
  private lastTs = -Infinity;
  readonly maxQueued: number;
  readonly minIntervalMs: number;
  sent = 0;
  dropped = 0;
  failures = 0;

  constructor(opts: TelemetryQueueOptions = {}) {
    this.maxQueued = opts.maxQueued ?? 120;
    this.minIntervalMs = opts.minIntervalMs ?? 900;
  }

  push(fix: TelemetryFix): boolean {
    if (!Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.timestamp_ms)) return false;
    if (fix.timestamp_ms - this.lastTs < this.minIntervalMs) return false;
    this.lastTs = fix.timestamp_ms;
    this.queue.push(fix);
    while (this.queue.length > this.maxQueued) {
      this.queue.shift();
      this.dropped++;
    }
    return true;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Drop everything queued — the broadcast is over, so these fixes can never be delivered (SEC-022). */
  clear(): void {
    this.dropped += this.queue.length;
    this.queue = [];
  }

  /** Send everything queued; on failure keep the batch for the next flush. */
  async flush(send: (fixes: TelemetryFix[]) => Promise<unknown>): Promise<number> {
    if (this.queue.length === 0) return 0;
    const batch = this.queue;
    this.queue = [];
    try {
      await send(batch);
      this.sent += batch.length;
      return batch.length;
    } catch {
      this.failures++;
      this.queue = batch.concat(this.queue);
      while (this.queue.length > this.maxQueued) {
        this.queue.shift();
        this.dropped++;
      }
      return 0;
    }
  }
}

/** expo-location -> TelemetryFix (course is preferred over magnetic heading; both may be -1 when unknown). */
export function fixFromLocation(loc: {
  coords: { latitude: number; longitude: number; altitude?: number | null; heading?: number | null; speed?: number | null };
  timestamp: number;
}): TelemetryFix {
  const heading = loc.coords.heading != null && loc.coords.heading >= 0 ? loc.coords.heading : null;
  return {
    lat: loc.coords.latitude,
    lon: loc.coords.longitude,
    alt: loc.coords.altitude ?? null,
    heading,
    timestamp_ms: Math.round(loc.timestamp),
  };
}
