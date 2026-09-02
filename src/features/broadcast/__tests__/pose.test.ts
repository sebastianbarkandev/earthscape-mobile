import type { PoseSample } from '../../../../modules/earthscape-pose';
import type { TelemetryFix } from '../api';

const nativeState: {
  supported: boolean;
  started: Array<Record<string, unknown>>;
  stopped: number;
  camera: string[];
  listeners: Array<(e: unknown) => void>;
} = { supported: true, started: [], stopped: 0, camera: [], listeners: [] };

jest.mock('../../../../modules/earthscape-pose', () => ({
  EarthscapePose: {
    get isSupported() {
      return nativeState.supported;
    },
    setCamera: (p: string) => nativeState.camera.push(p),
    start: async (o: Record<string, unknown>) => {
      nativeState.started.push(o);
    },
    stop: async () => {
      nativeState.stopped += 1;
    },
  },
  addPoseListener: (l: (e: unknown) => void) => {
    nativeState.listeners.push(l);
    return {
      remove: () => {
        nativeState.listeners = nativeState.listeners.filter((x) => x !== l);
      },
    };
  },
  isPoseError: (e: { error?: unknown }) => typeof e.error === 'string',
}));

const headingWatchers: Array<(h: { trueHeading: number; magHeading: number; accuracy: number }) => void> = [];
jest.mock('expo-location', () => ({
  watchHeadingAsync: async (cb: (h: { trueHeading: number; magHeading: number; accuracy: number }) => void) => {
    headingWatchers.push(cb);
    return { remove: () => headingWatchers.splice(headingWatchers.indexOf(cb), 1) };
  },
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { poseSource, withPose, POSE_MAX_AGE_MS, CAMERA_HEIGHT_M, FALLBACK_HFOV_DEG } = require('../pose/poseSource') as typeof import('../pose/poseSource');

const fix: TelemetryFix = { lat: 39.5, lon: -104.9, alt: 1600, heading: 12, timestamp_ms: 1_700_000_000_000 };
const sample = (over: Partial<PoseSample> = {}): PoseSample => ({
  heading: 271.26,
  pitch: -18.04,
  roll: 2.51,
  landscape: false,
  camera: 'back',
  magneticAccuracy: 2,
  hfov: 42.3,
  vfov: 69.4,
  zoom: 1,
  timestamp: 1000,
  ...over,
});

beforeEach(() => {
  poseSource._reset();
  nativeState.supported = true;
  nativeState.started = [];
  nativeState.stopped = 0;
  nativeState.camera = [];
  nativeState.listeners = [];
  headingWatchers.length = 0;
});

describe('withPose', () => {
  it('attaches heading/pitch/roll/fov/camera height from a fresh motion sample (camera heading beats GPS course)', () => {
    const out = withPose(fix, { source: 'motion', sample: sample(), updatedAt: 1000, needsCalibration: false }, 1500);
    expect(out).toEqual({
      ...fix,
      heading: 271.3,
      pitch: -18,
      roll: 2.5,
      hfov: 42.3,
      vfov: 69.4,
      camera_height_m: CAMERA_HEIGHT_M,
    });
  });

  it('leaves the fix untouched when the sample is stale or missing', () => {
    expect(withPose(fix, { source: 'motion', sample: sample(), updatedAt: 1000, needsCalibration: false }, 1000 + POSE_MAX_AGE_MS + 1)).toBe(fix);
    expect(withPose(fix, { source: 'none', sample: null, updatedAt: 0, needsCalibration: false }, 5)).toBe(fix);
  });

  it('compass fallback sends heading + default portrait FOV but no pitch/roll (the server keeps them level)', () => {
    const out = withPose(
      fix,
      { source: 'compass', sample: sample({ heading: 90, pitch: 0, roll: 0, hfov: FALLBACK_HFOV_DEG, vfov: 69 }), updatedAt: 1000, needsCalibration: false },
      1200,
    );
    expect(out.heading).toBe(90);
    expect(out.pitch).toBeUndefined();
    expect(out.roll).toBeUndefined();
    expect(out.hfov).toBe(FALLBACK_HFOV_DEG);
    expect(out.camera_height_m).toBe(CAMERA_HEIGHT_M);
  });

  it('a sample without a field of view still corrects the heading but adds no frame fields', () => {
    const out = withPose(fix, { source: 'motion', sample: sample({ hfov: undefined, vfov: undefined }), updatedAt: 1000, needsCalibration: false }, 1200);
    expect(out.heading).toBe(271.3);
    expect(out.hfov).toBeUndefined();
    expect(out.camera_height_m).toBeUndefined();
  });
});

describe('poseSource', () => {
  it('uses the native module when supported, publishes samples, forwards camera switches and stops cleanly', async () => {
    const seen: string[] = [];
    poseSource.subscribe((s) => seen.push(s.source));
    poseSource.setCamera('front');
    expect(nativeState.camera).toEqual([]); // not running yet: remembered, not forwarded
    await expect(poseSource.start()).resolves.toBe('motion');
    expect(nativeState.started).toEqual([{ camera: 'front', intervalMs: 250 }]);

    nativeState.listeners.forEach((l) => l(sample({ magneticAccuracy: 0 })));
    expect(poseSource.status.sample?.heading).toBe(271.26);
    expect(poseSource.status.needsCalibration).toBe(true);
    nativeState.listeners.forEach((l) => l({ error: 'boom', timestamp: 1 }));
    expect(poseSource.status.sample?.heading).toBe(271.26); // errors never clobber the last good sample

    poseSource.setCamera('back');
    expect(nativeState.camera).toEqual(['back']);

    await poseSource.start(); // idempotent
    expect(nativeState.started).toHaveLength(1);

    await poseSource.stop();
    expect(nativeState.stopped).toBe(1);
    expect(nativeState.listeners).toHaveLength(0);
    expect(poseSource.status).toEqual({ source: 'none', sample: null, updatedAt: 0, needsCalibration: false });
    expect(seen).toContain('motion');
  });

  it('an overlay hold keeps the sensors alive across telemetry stop(); the last one out stops them', async () => {
    const release = poseSource.acquire();
    await Promise.resolve();
    expect(nativeState.started).toHaveLength(1);
    await poseSource.start(); // telemetry joins — nothing restarts
    expect(nativeState.started).toHaveLength(1);
    await poseSource.stop(); // telemetry leaves, the overlay still reads
    expect(nativeState.stopped).toBe(0);
    expect(nativeState.listeners).toHaveLength(1);
    release();
    release(); // idempotent
    await Promise.resolve();
    expect(nativeState.stopped).toBe(1);
    expect(nativeState.listeners).toHaveLength(0);
    // The other order: the overlay leaves first, telemetry keeps the sensors until stop().
    const r2 = poseSource.acquire();
    await poseSource.start();
    r2();
    await Promise.resolve();
    expect(nativeState.stopped).toBe(1);
    await poseSource.stop();
    expect(nativeState.stopped).toBe(2);
  });

  it('falls back to the compass when the module is unsupported', async () => {
    nativeState.supported = false;
    await expect(poseSource.start()).resolves.toBe('compass');
    expect(nativeState.started).toEqual([]);
    expect(headingWatchers).toHaveLength(1);
    headingWatchers[0]({ trueHeading: 45.5, magHeading: 40, accuracy: 1 });
    expect(poseSource.status.source).toBe('compass');
    expect(poseSource.status.sample).toMatchObject({ heading: 45.5, pitch: 0, roll: 0, hfov: FALLBACK_HFOV_DEG, magneticAccuracy: 0 });
    expect(poseSource.status.needsCalibration).toBe(false);
    headingWatchers[0]({ trueHeading: -1, magHeading: 40, accuracy: 0 });
    expect(poseSource.status.sample?.heading).toBe(40); // magnetic when true north is unknown
    expect(poseSource.status.needsCalibration).toBe(true);
    await poseSource.stop();
    expect(headingWatchers).toHaveLength(0);
    expect(nativeState.stopped).toBe(0);
  });
});
