/**
 * Scenario-level fake of the Earthscape API — the ONE network boundary these suites mock.
 *
 * Everything above it is real: `src/common/api/client.ts` is replaced by
 * `dispatchFakeApi` (see any *.test.tsx in this folder), so the real feature api
 * modules, thunks, reducers, hooks and components run against a scripted server.
 *
 * Every payload shape below was traced to the backend source on the
 * `earthscape-mobile` branch of ~/dev/earthscape (read-only, via `git show`):
 *   - `app/api/events_api.py:view`            → {events:[{id,tags,custom_field_values,videos}]}
 *   - `app/models/event.py`                   → Event.videos is `order_by="Video.id"`
 *   - `app/models/video.py:as_dict`           → the video dict, incl. the live/processing
 *                                               hls_stream_url + live_stream_id/live_start rules
 *   - `app/models/video.py:live_stream_state` → starting|started|live → 'live';
 *                                               ending|ended without hls_stream → 'processing';
 *                                               otherwise 'recording_ready'
 *   - `app/models/video.py:get_flight_points` → `?after=` is STRICT (`utc > after`) and an empty
 *                                               tail answers first/last_flight_point_utc = NULL
 *   - `app/utils/flight_point_cache.py`       → **no flight points at all → the response is `[]`**
 *   - `app/api/videos_api.py:flight_data`     → serves the PRIMARY's points for ANY video id of
 *                                               the event (LIVE-003) and checks LIVESTREAMS READ
 *                                               while the primary is live, VIDEOS READ otherwise
 *   - `app/api/videos_api.py:viewing_update`  → {liveStreamState, loggedIn}
 *   - `app/api/live_mobile_api.py`            → POST /streams (201, 409 "Event is not live"),
 *                                               GET /streams/{id}, POST /end, POST /telemetry
 *                                               (409 once the stream is ending/ended)
 *   - `app/utils/livestreams.py:_assign_ports`→ SRT ports step by 11 from LIVE_PORTS_LOWER_RANGE
 */
import { ApiError } from '@/common/api/client';
import type { EventPayload, EventVideo, VideoPermissions } from '@/features/player/api';
import type { MobileStream } from '@/features/broadcast/api';

export const EVENT_ID = 7;
/** Wall clock the whole scenario is scripted against (epoch seconds). */
export const T0 = 1_700_000_000;
export const PRIMARY_VIDEO_ID = 100;
export const PRIMARY_LIVE_STREAM_ID = 500;
const LIVE_PORT_BASE = 4096;

export interface FakeCall {
  method: string;
  path: string;
  /** Path with the query string stripped — handy for counting. */
  route: string;
  query: Record<string, string>;
  body: unknown;
}

type FlightSeries = Array<[number, [number, number]]>;

interface FakeStream {
  id: number;
  status: 'starting' | 'started' | 'ending' | 'ended';
  videoId: number;
  playlistReady: boolean;
  createdAt: number;
  endedAt: number | null;
  telemetry: Array<{ lat: number; lon: number; timestamp_ms: number }>;
  telemetryBatches: number[][];
}

export interface PermissionSpec {
  update?: boolean;
  download?: boolean;
  share?: boolean;
  /** 403 the whole per-video permissions read (ACL org, no VIDEOS READ). */
  forbidden?: boolean;
}

const perms = (spec: PermissionSpec = {}): VideoPermissions => ({
  videos: {
    update: spec.update ?? true,
    delete: false,
    download: spec.download ?? true,
    share: spec.share ?? true,
    suggest_deletion: true,
    draw: false,
  },
  tags: { create: false, delete: false },
});

/** The parts of `Video.as_dict()` the mobile client reads, with the live rules applied. */
function videoDict(over: Partial<EventVideo> & { id: number }): EventVideo {
  return {
    event_id: EVENT_ID,
    title: `Video ${over.id}`,
    description: '',
    duration: null,
    start: T0,
    end: null,
    date_posted: String(T0),
    is_primary: false,
    program_type: null,
    status: 'ready',
    live_stream_state: null,
    hls_stream_url: null,
    mp4_url: null,
    stream_url: null,
    thumbnail_url: `/static/thumbnails/${over.id}/thumb.jpg`,
    download_url: null,
    time_mapping: null,
    clipmarks: [],
    drawn_objects: [],
    tail: null,
    has_audio: true,
    has_video: true,
    has_map: true,
    user: { id: 1, first_name: 'Pat', last_name: 'Pilot' },
    platform: { type: 'helicopter', data: null },
    ...over,
  };
}

/**
 * A LIVE program: `duration`/`end` are NULL until the recording is transcoded and
 * `hls_stream_url` is the live playlist (`url_for('live_streams.playlist')`).
 */
export function liveProgram(args: { id: number; liveStreamId: number; programType?: string; isPrimary?: boolean; start?: number; title?: string }): EventVideo {
  return videoDict({
    id: args.id,
    title: args.title ?? `Flight 12${args.programType ? ` (${args.programType})` : ''}`,
    is_primary: args.isPrimary ?? false,
    program_type: args.programType ?? null,
    status: 'live',
    live_stream_state: 'live',
    live_stream_id: args.liveStreamId,
    live_start: args.start ?? T0,
    start: args.start ?? T0,
    end: null,
    duration: null,
    hls_stream_url: `/live/${args.liveStreamId}/playlist.m3u8`,
    // LIVE-023: for a live video the backend double-prefixes the live thumbnail path, so this
    // URL really does 404 in production (`Video.thumbnail_url` vs the live pipeline's value).
    thumbnail_url: `/static/thumbnails//static/live/${args.liveStreamId}/thumb.jpg`,
  });
}

export class FakeBackend {
  calls: FakeCall[] = [];
  videos: EventVideo[] = [];
  private permissions = new Map<number, PermissionSpec>();
  private points = new Map<number, FlightSeries>();
  private streams = new Map<number, FakeStream>();
  private failures = new Map<string, { times: number; status: number; body: unknown }>();
  private pending = new Map<string, Array<(v: unknown) => void>>();
  private nextVideoId = 201;
  private nextStreamId = PRIMARY_LIVE_STREAM_ID + 1;
  /** flight_data.json answers 403 (viewer lacks LIVESTREAMS READ while the primary is live). */
  flightForbidden = false;
  eventTags: EventPayload['events'][number]['tags'] = [];
  /** Points per flight_data response (`get_flight_points(5000, after)`); lowered to force ?after= paging. */
  pageSize = 5000;
  /**
   * false = today's backend (LIVE-003: the PRIMARY's points are served for every video id of the
   * event). true = one track per video, i.e. the behaviour the additive `?own=1` fix will bring —
   * the only way to make cross-program series contamination observable at all.
   */
  serveRequestedVideoPoints = false;
  /** The live server claims a new stream on its next poll: GET /streams/{id} flips starting → started. */
  autoStartStreams = true;

  constructor() {
    this.videos = [
      liveProgram({ id: PRIMARY_VIDEO_ID, liveStreamId: PRIMARY_LIVE_STREAM_ID, isPrimary: true, title: 'Flight 12' }),
    ];
    this.permissions.set(PRIMARY_VIDEO_ID, {});
    this.streams.set(PRIMARY_LIVE_STREAM_ID, {
      id: PRIMARY_LIVE_STREAM_ID,
      status: 'started',
      videoId: PRIMARY_VIDEO_ID,
      playlistReady: true,
      createdAt: T0,
      endedAt: null,
      telemetry: [],
      telemetryBatches: [],
    });
  }

  // ── scripting helpers ─────────────────────────────────────────────────────────
  video(id: number): EventVideo {
    const v = this.videos.find((x) => x.id === id);
    if (!v) throw new Error(`no video ${id} in the fake event`);
    return v;
  }

  /** A phone joins the live event (what `POST /streams {event_id}` does server-side). */
  joinProgram(label: string, opts: { start?: number; permissions?: PermissionSpec } = {}): EventVideo {
    const id = this.nextVideoId++;
    const streamId = this.nextStreamId++;
    const video = liveProgram({ id, liveStreamId: streamId, programType: label, start: opts.start ?? T0, title: `Flight 12 (${label})` });
    this.videos.push(video);
    this.videos.sort((a, b) => a.id - b.id); // Event.videos order_by="Video.id"
    this.permissions.set(id, opts.permissions ?? {});
    this.streams.set(streamId, {
      id: streamId,
      status: 'started',
      videoId: id,
      playlistReady: true,
      createdAt: opts.start ?? T0,
      endedAt: null,
      telemetry: [],
      telemetryBatches: [],
    });
    return video;
  }

  /** Stream over: LiveStream.status ending/ended and no hls_stream yet → 'processing'. */
  endProgram(videoId: number): void {
    const v = this.video(videoId);
    v.live_stream_state = 'processing';
    v.status = 'processing';
    v.live_start = null; // as_dict only sets live_start while the stream is not ending/ended
    const s = [...this.streams.values()].find((x) => x.videoId === videoId);
    if (s) {
      s.status = 'ended';
      s.endedAt = T0 + 1;
    }
  }

  /** Transcode finished: hls_stream exists → 'recording_ready', duration/end filled in. */
  finishProcessing(videoId: number, duration: number): void {
    const v = this.video(videoId);
    v.live_stream_state = 'recording_ready';
    v.status = 'ready';
    v.duration = duration;
    v.end = (v.start ?? T0) + duration;
    v.hls_stream_url = `https://cdn.example.com/${videoId}/index.m3u8`;
  }

  /** Remove a program from the event entirely (deleted / filtered out). */
  removeProgram(videoId: number): void {
    this.videos = this.videos.filter((v) => v.id !== videoId);
  }

  setPermissions(videoId: number, spec: PermissionSpec): void {
    this.permissions.set(videoId, spec);
  }

  /** 1 Hz flight points appended to a video's track (only the primary's are ever served). */
  pushPoints(videoId: number, count: number, fromUtc?: number): void {
    const series = this.points.get(videoId) ?? [];
    const start = fromUtc ?? (series.length ? series[series.length - 1][0] + 1 : T0);
    for (let i = 0; i < count; i++) series.push([start + i, [39.5 + (start + i - T0) * 0.001, -104.9 - (start + i - T0) * 0.001]]);
    this.points.set(videoId, series);
  }

  /** Make the next `times` calls of a route fail (route = "METHOD /path", no query). */
  failNext(route: string, times: number, status = 500, body: unknown = { error: 'boom' }): void {
    this.failures.set(route, { times, status, body });
  }

  /** Hold every response for a route until `release(route)` — for in-flight/cancellation scripts. */
  hold(route: string): void {
    if (!this.pending.has(route)) this.pending.set(route, []);
  }

  release(route: string): void {
    const waiters = this.pending.get(route) ?? [];
    this.pending.set(route, []);
    waiters.forEach((w) => w(undefined));
  }

  stream(id: number): FakeStream | undefined {
    return this.streams.get(id);
  }

  liveStreamIds(): number[] {
    return [...this.streams.keys()];
  }

  /** Streams the fake still considers open — an orphan check after a broadcast ends. */
  openStreamIds(): number[] {
    return [...this.streams.values()].filter((s) => s.status !== 'ending' && s.status !== 'ended').map((s) => s.id);
  }

  telemetryBatches(streamId: number): number[][] {
    return this.streams.get(streamId)?.telemetryBatches ?? [];
  }

  routes(method?: string): string[] {
    return this.calls.filter((c) => !method || c.method === method).map((c) => c.route);
  }

  countRoute(route: string): number {
    return this.calls.filter((c) => `${c.method} ${c.route}` === route).length;
  }

  clearCalls(): void {
    this.calls = [];
  }

  // ── the boundary ──────────────────────────────────────────────────────────────
  async handle(path: string, opts: { method?: string; body?: unknown } = {}): Promise<unknown> {
    const method = opts.method ?? 'GET';
    const [route, qs = ''] = path.split('?');
    const query: Record<string, string> = {};
    qs.split('&')
      .filter(Boolean)
      .forEach((pair) => {
        const [k, v = ''] = pair.split('=');
        query[decodeURIComponent(k)] = decodeURIComponent(v);
      });
    this.calls.push({ method, path, route, query, body: opts.body });
    const key = `${method} ${route}`;

    if (this.pending.has(key)) {
      await new Promise<void>((resolve) => {
        (this.pending.get(key) as Array<(v: unknown) => void>).push(() => resolve());
      });
    }
    const failure = this.failures.get(key);
    if (failure && failure.times > 0) {
      failure.times -= 1;
      throw new ApiError(failure.status, failure.body);
    }
    return this.route(method, route, query, opts.body);
  }

  private route(method: string, route: string, query: Record<string, string>, body: unknown): unknown {
    let m: RegExpMatchArray | null;

    if (method === 'GET' && (m = route.match(/^\/api\/v1\/events\/(\d+)\.json$/))) {
      if (Number(m[1]) !== EVENT_ID) throw new ApiError(404, { error: 'Not found' });
      return clone<EventPayload>({
        events: [{ id: EVENT_ID, tags: this.eventTags, custom_field_values: null, videos: [...this.videos].sort((a, b) => a.id - b.id) }],
      });
    }

    if (method === 'GET' && (m = route.match(/^\/api\/v1\/videos\/(\d+)\/event_id$/))) {
      const id = Number(m[1]);
      const spec = this.permissions.get(id);
      if (!spec) throw new ApiError(404, { error: 'Not found' });
      if (spec.forbidden) throw new ApiError(403, { error: 'Forbidden' });
      return { event_id: EVENT_ID, video_id: id, permissions: perms(spec) };
    }

    if (method === 'GET' && (m = route.match(/^\/api\/v1\/videos\/(\d+)\/flight_data\.json$/))) {
      const requested = Number(m[1]);
      if (!this.videos.some((v) => v.id === requested)) throw new ApiError(404, { description: 'Video not found' });
      if (this.flightForbidden) throw new ApiError(403, { error: 'Forbidden' });
      // LIVE-003: whatever id is asked for, the endpoint resolves the event's PRIMARY.
      const primary = this.videos.find((v) => v.is_primary);
      const owner = this.serveRequestedVideoPoints ? this.video(requested) : primary;
      const series = (owner && this.points.get(owner.id)) ?? [];
      if (series.length === 0) return []; // get_flight_points_cached returns [] with no points at all
      const after = query.after !== undefined ? Number(query.after) : (owner?.start ?? T0) - 1;
      const tail = series.filter(([utc]) => utc > after).slice(0, this.pageSize);
      return {
        flight_data: {
          loc: tail,
          target: [],
          footprint: [],
          acft_hdg: tail.map(([utc]) => [utc, 90] as [number, number]),
          graphs: { KLV: { Altitude: tail.map(([utc], i) => [utc, 1000 + i] as [number, number]) } },
          first_flight_point_utc: tail.length ? tail[0][0] : null,
          last_flight_point_utc: tail.length ? tail[tail.length - 1][0] : null,
        },
      };
    }

    if (method === 'POST' && (m = route.match(/^\/api\/v1\/videos\/(\d+)\/viewing$/))) {
      const id = Number(m[1]);
      const v = this.videos.find((x) => x.id === id);
      if (!v) throw new ApiError(404, { error: 'Not found' });
      return { liveStreamState: v.live_stream_state, loggedIn: true };
    }

    if (method === 'POST' && route === '/api/v1/live/streams') {
      return this.createStream(body as Record<string, unknown>);
    }
    if (method === 'GET' && (m = route.match(/^\/api\/v1\/live\/streams\/(\d+)$/))) {
      const s = this.streams.get(Number(m[1]));
      if (!s) throw new ApiError(404, { error: 'Not found' });
      if (this.autoStartStreams && s.status === 'starting') s.status = 'started';
      return this.serializeStream(s, query.latency_ms ? Number(query.latency_ms) : undefined);
    }
    if (method === 'POST' && (m = route.match(/^\/api\/v1\/live\/streams\/(\d+)\/end$/))) {
      const s = this.streams.get(Number(m[1]));
      if (!s) throw new ApiError(404, { error: 'Not found' });
      if (s.status !== 'ending' && s.status !== 'ended') {
        s.status = 'ending';
        this.endProgram(s.videoId);
        s.status = 'ending';
      }
      return { success: true, status: s.status };
    }
    if (method === 'POST' && (m = route.match(/^\/api\/v1\/live\/streams\/(\d+)\/telemetry$/))) {
      const s = this.streams.get(Number(m[1]));
      if (!s) throw new ApiError(404, { error: 'Not found' });
      if (s.status === 'ending' || s.status === 'ended') throw new ApiError(409, { accepted: 0, status: s.status });
      const fixes = ((body as { fixes?: Array<{ lat: number; lon: number; timestamp_ms: number }> })?.fixes ?? []).filter(
        (f) => typeof f?.lat === 'number' && typeof f?.lon === 'number' && typeof f?.timestamp_ms === 'number',
      );
      s.telemetry.push(...fixes);
      s.telemetryBatches.push(fixes.map((f) => f.timestamp_ms));
      return { accepted: fixes.length, status: s.status };
    }

    throw new ApiError(404, { error: `fake backend has no route for ${method} ${route}` });
  }

  private createStream(body: Record<string, unknown>): MobileStream {
    const eventId = body?.event_id as number | undefined;
    const programType = ((body?.program_type as string) || '').trim() || 'Mobile';
    const streamName = ((body?.stream_name as string) || '').trim() || null;
    let isPrimary = true;
    let video: EventVideo;
    if (eventId) {
      if (eventId !== EVENT_ID) throw new ApiError(404, { error: 'Not found' });
      const primary = this.videos.find((v) => v.is_primary);
      if (!primary) throw new ApiError(404, { error: 'Not found' });
      // live_mobile_api: 409 + {error} when the primary is not live any more.
      if (primary.live_stream_state !== 'live') throw new ApiError(409, { error: 'Event is not live' });
      if (this.permissions.get(primary.id)?.forbidden) throw new ApiError(403, { error: 'Forbidden' });
      isPrimary = false;
      video = this.joinProgram(streamName ?? programType);
    } else {
      const id = this.nextVideoId++;
      const streamId = this.nextStreamId++;
      video = liveProgram({ id, liveStreamId: streamId, isPrimary: true, title: streamName ?? 'Live' });
      this.permissions.set(id, {});
      this.streams.set(streamId, {
        id: streamId,
        status: 'starting',
        videoId: id,
        playlistReady: false,
        createdAt: T0,
        endedAt: null,
        telemetry: [],
        telemetryBatches: [],
      });
    }
    const streamId = video.live_stream_id as number;
    const s = this.streams.get(streamId) as FakeStream;
    // A brand-new stream is always `starting`: the live server claims it on its next poll.
    s.status = 'starting';
    s.playlistReady = false;
    return this.serializeStream(s, body?.latency_ms as number | undefined, { isPrimary, programType: eventId ? programType : null });
  }

  /** The live server claimed the stream and brought its SRT listener up. */
  startStream(streamId: number): void {
    const s = this.streams.get(streamId);
    if (s) s.status = 'started';
  }

  markPlaylistReady(streamId: number): void {
    const s = this.streams.get(streamId);
    if (s) s.playlistReady = true;
  }

  private serializeStream(s: FakeStream, latencyMs?: number, over: { isPrimary?: boolean; programType?: string | null } = {}): MobileStream {
    const video = this.videos.find((v) => v.id === s.videoId) ?? null;
    const port = LIVE_PORT_BASE + 11 * (s.id - PRIMARY_LIVE_STREAM_ID);
    const latency = latencyMs ?? 120;
    const passphrase = `pass${s.id}`;
    return {
      id: s.id,
      status: s.status,
      video_id: s.videoId,
      event_id: video?.event_id ?? EVENT_ID,
      is_primary: over.isPrimary ?? video?.is_primary ?? null,
      program_type: over.programType ?? video?.program_type ?? null,
      title: video?.title ?? null,
      created_at: new Date(s.createdAt * 1000).toISOString(),
      ended_at: s.endedAt ? new Date(s.endedAt * 1000).toISOString() : null,
      playlist_ready: s.playlistReady,
      playlist_url: `/live/${s.id}/playlist.m3u8`,
      server_latency_ms: 120,
      ingest: {
        protocol: 'srt',
        host: '203.0.113.10',
        port,
        passphrase,
        pbkeylen: 16,
        latency_ms: latency,
        url: `srt://203.0.113.10:${port}?mode=caller&passphrase=${passphrase}&pbkeylen=16&latency=${latency}`,
      },
      telemetry_url: `/api/v1/live/streams/${s.id}/telemetry`,
    };
  }
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

// ── installation (the jest.mock factory calls dispatchFakeApi) ──────────────────
let current: FakeBackend | null = null;

export function installFakeBackend(): FakeBackend {
  current = new FakeBackend();
  return current;
}

export function activeFakeBackend(): FakeBackend {
  if (!current) throw new Error('no FakeBackend installed — call installFakeBackend() in beforeEach');
  return current;
}

/**
 * The replacement for `api()` in `src/common/api/client.ts`. Mock it like this
 * (the factory may not close over test-file variables, hence the lazy require):
 *
 *   jest.mock('@/common/api/client', () => {
 *     const actual = jest.requireActual('@/common/api/client');
 *     return { ...actual, api: (path: string, opts?: unknown) => require('./fakeBackend').dispatchFakeApi(path, opts) };
 *   });
 */
export function dispatchFakeApi(path: string, opts?: { method?: string; body?: unknown }): Promise<unknown> {
  return activeFakeBackend().handle(path, opts ?? {});
}
