// Contract tests for the verbatim port src/common/lib/TimeMapper.js.
// These tests DEFINE the port's behaviour (CLAUDE.md rule 5): if one fails,
// fix the caller or the test's expectation — never the lib.

import {
  createTimeMapper,
  validateVideoTimeUtcTimeMap,
  isVideoTimeInTimeMapEntry,
  isUtcTimeInTimeMapEntry,
} from '../TimeMapper';

// A gap-compensated video: 25s of continuous video built from two recording
// segments with a 20s wall-clock gap between them (recorder paused 1010 -> 1030).
//   video 0..10  <-> utc 1000..1010
//   video 10..25 <-> utc 1030..1045
const GAPPED_MAP = [
  { videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010 },
  { videoStart: 10, videoEnd: 25, utcStart: 1030, utcEnd: 1045 },
];

// The mapper memoises the last matched interval, so build a fresh one per
// assertion whenever a test must be order-independent.
const mapper = () => createTimeMapper(1000, GAPPED_MAP.map(e => ({ ...e })));

describe('interval predicates', () => {
  const entry = GAPPED_MAP[0];

  it('treats both video bounds as inclusive', () => {
    expect(isVideoTimeInTimeMapEntry(entry, 0)).toBe(true);
    expect(isVideoTimeInTimeMapEntry(entry, 10)).toBe(true);
    expect(isVideoTimeInTimeMapEntry(entry, 5)).toBe(true);
    expect(isVideoTimeInTimeMapEntry(entry, -0.001)).toBe(false);
    expect(isVideoTimeInTimeMapEntry(entry, 10.001)).toBe(false);
  });

  it('treats both utc bounds as inclusive', () => {
    expect(isUtcTimeInTimeMapEntry(entry, 1000)).toBe(true);
    expect(isUtcTimeInTimeMapEntry(entry, 1010)).toBe(true);
    expect(isUtcTimeInTimeMapEntry(entry, 999.999)).toBe(false);
    expect(isUtcTimeInTimeMapEntry(entry, 1010.001)).toBe(false);
  });
});

describe('videoToUtc (gap-compensated)', () => {
  it('maps times inside the first segment', () => {
    expect(mapper().videoToUtc(0)).toBe(1000);
    expect(mapper().videoToUtc(4.5)).toBe(1004.5);
    expect(mapper().videoToUtc(10)).toBe(1010);
  });

  it('adds the gap for times in the second segment — naive start+seconds is wrong', () => {
    expect(mapper().videoToUtc(10.5)).toBe(1030.5);
    expect(mapper().videoToUtc(15)).toBe(1035); // NOT 1000 + 15
    expect(mapper().videoToUtc(25)).toBe(1045);
  });

  it('extrapolates linearly from the edge segments when out of range', () => {
    // Out-of-range video time snaps to the first/last interval but still applies
    // that interval's linear offset — it does NOT clamp to its bounds.
    expect(mapper().videoToUtc(-5)).toBe(995);
    expect(mapper().videoToUtc(100)).toBe(1120);
  });

  it('coerces numeric strings and returns null for non-finite input', () => {
    expect(mapper().videoToUtc('12')).toBe(1032);
    expect(mapper().videoToUtc(NaN)).toBeNull();
    expect(mapper().videoToUtc(Infinity)).toBeNull();
    expect(mapper().videoToUtc(undefined)).toBeNull();
    expect(mapper().videoToUtc(null)).toBe(1000); // Number(null) === 0
  });
});

describe('utcToVideo (gap-compensated)', () => {
  it('maps times inside either segment', () => {
    expect(mapper().utcToVideo(1000)).toBe(0);
    expect(mapper().utcToVideo(1004.5)).toBe(4.5);
    expect(mapper().utcToVideo(1010)).toBe(10);
    expect(mapper().utcToVideo(1035)).toBe(15);
    expect(mapper().utcToVideo(1045)).toBe(25);
  });

  it('snaps a utc inside the gap forward to the start of the next segment', () => {
    // Nothing was recorded 1010 -> 1030, so every utc in the gap resolves to the
    // first video time that exists after it.
    expect(mapper().utcToVideo(1010.001)).toBe(10);
    expect(mapper().utcToVideo(1020)).toBe(10);
    expect(mapper().utcToVideo(1029.999)).toBe(10);
    expect(mapper().utcToVideo(1030)).toBe(10);
  });

  it('extrapolates linearly from the edge segments when out of range', () => {
    expect(mapper().utcToVideo(900)).toBe(-100);
    expect(mapper().utcToVideo(2000)).toBe(980);
  });

  it('returns null for non-finite input and does NOT coerce strings', () => {
    // Asymmetric with videoToUtc, which runs Number() first. Callers must pass numbers.
    expect(mapper().utcToVideo('1005')).toBeNull();
    expect(mapper().utcToVideo(NaN)).toBeNull();
    expect(mapper().utcToVideo(undefined)).toBeNull();
    expect(mapper().utcToVideo(null)).toBeNull();
  });
});

describe('round-trips across the gap', () => {
  it.each([0, 0.5, 4.5, 9.999, 10, 10.001, 15, 24.5, 25])(
    'videoToUtc -> utcToVideo returns video time %p',
    videoTime => {
      const m = mapper();
      expect(m.utcToVideo(m.videoToUtc(videoTime))).toBeCloseTo(videoTime, 10);
    },
  );

  it.each([1000, 1005, 1010, 1030, 1035, 1045])(
    'utcToVideo -> videoToUtc returns utc %p',
    utcTime => {
      const m = mapper();
      expect(m.videoToUtc(m.utcToVideo(utcTime))).toBeCloseTo(utcTime, 10);
    },
  );

  it('is not round-trip stable for utc inside the gap (the gap has no video)', () => {
    const m = mapper();
    expect(m.videoToUtc(m.utcToVideo(1020))).toBe(1010);
  });

  it('round-trips repeatedly on one mapper instance (memoised interval stays correct)', () => {
    const m = mapper();
    for (const t of [1, 12, 3, 24, 9, 11]) {
      expect(m.utcToVideo(m.videoToUtc(t))).toBeCloseTo(t, 10);
    }
  });
});

describe('memoised interval at a segment boundary', () => {
  it('resolves the shared boundary video time using the last matched interval', () => {
    // video time 10 is the inclusive end of segment 1 AND the start of segment 2,
    // so its utc depends on which interval was matched last. Documented, not desired:
    // callers that need a stable answer must use a fresh mapper or avoid the seam.
    const fresh = mapper();
    expect(fresh.videoToUtc(10)).toBe(1010); // scans from the start -> segment 1

    const warmed = mapper();
    warmed.utcToVideo(1035); // caches segment 2
    expect(warmed.videoToUtc(10)).toBe(1030); // -> segment 2
  });
});

describe('createTimeMapper without a usable time map', () => {
  it.each([[null], [undefined], [[]], ['nope'], [{}]])(
    'falls back to plain startUtc offsets for %p',
    badMap => {
      const m = createTimeMapper(500, badMap);
      expect(m.videoTimeUtcTimeMap).toBeNull();
      expect(m.videoToUtc(5)).toBe(505);
      expect(m.utcToVideo(505)).toBe(5);
      expect(m.utcToVideo(499)).toBe(-1);
    },
  );

  it('exposes startUtc, defaulting non-finite values to 0', () => {
    expect(createTimeMapper(1234.5, null).startUtc).toBe(1234.5);
    expect(createTimeMapper(NaN, null).startUtc).toBe(0);
    expect(createTimeMapper(undefined, null).startUtc).toBe(0);
  });

  it('keeps the validated map on the mapper when one is supplied', () => {
    expect(mapper().videoTimeUtcTimeMap).toHaveLength(2);
  });
});

describe('validateVideoTimeUtcTimeMap', () => {
  it('accepts a contiguous gap-compensated map', () => {
    expect(validateVideoTimeUtcTimeMap(GAPPED_MAP)).toBe(true);
  });

  it('returns false (no throw) for a missing or empty map', () => {
    expect(validateVideoTimeUtcTimeMap(null)).toBe(false);
    expect(validateVideoTimeUtcTimeMap([])).toBe(false);
    expect(validateVideoTimeUtcTimeMap('nope')).toBe(false);
  });

  it.each([
    [
      'video time not sorted',
      [
        { videoStart: 10, videoEnd: 20, utcStart: 1010, utcEnd: 1020 },
        { videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010 },
      ],
      /not sorted.*previousVideoStart/,
    ],
    [
      'utc time not sorted',
      [
        { videoStart: 0, videoEnd: 10, utcStart: 1030, utcEnd: 1040 },
        { videoStart: 10, videoEnd: 20, utcStart: 1000, utcEnd: 1010 },
      ],
      /not sorted.*previousUtcStart/,
    ],
    [
      'videoStart after videoEnd',
      [{ videoStart: 10, videoEnd: 5, utcStart: 1000, utcEnd: 995 }],
      /videoStart > videoEnd/,
    ],
    [
      'utcStart after utcEnd',
      [{ videoStart: 0, videoEnd: 10, utcStart: 1010, utcEnd: 1000 }],
      /utcStart > utcEnd/,
    ],
    [
      'gap in video time',
      [
        { videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010 },
        { videoStart: 12, videoEnd: 20, utcStart: 1030, utcEnd: 1038 },
      ],
      /gap in video time/,
    ],
    [
      'overlap in video time',
      [
        { videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010 },
        { videoStart: 5, videoEnd: 15, utcStart: 1030, utcEnd: 1040 },
      ],
      /overlap in video time/,
    ],
    [
      'overlap in utc time',
      [
        { videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010 },
        { videoStart: 10, videoEnd: 20, utcStart: 1005, utcEnd: 1015 },
      ],
      /overlap in UTC time/,
    ],
    [
      'segment durations disagree',
      [{ videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1020 }],
      /durations not equal/,
    ],
  ])('throws on %s', (_label, badMap, message) => {
    expect(() => validateVideoTimeUtcTimeMap(badMap)).toThrow(message);
    expect(() => createTimeMapper(1000, badMap)).toThrow(message);
  });

  it('tolerates sub-10ms duration drift between video and utc', () => {
    const drifted = [{ videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010.005 }];
    expect(validateVideoTimeUtcTimeMap(drifted)).toBe(true);
    expect(createTimeMapper(1000, drifted).videoToUtc(10)).toBe(1010);
  });

  it('pins the tolerance boundary: 0.01 drift passes, anything beyond it throws', () => {
    // The check is `> 0.01`, so exactly 0.01 is accepted.
    const at = [{ videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010.01 }];
    expect(validateVideoTimeUtcTimeMap(at)).toBe(true);

    for (const drift of [0.0100001, 0.0101, 0.02, 1]) {
      const over = [{ videoStart: 0, videoEnd: 10, utcStart: 1000, utcEnd: 1010 + drift }];
      expect(() => validateVideoTimeUtcTimeMap(over)).toThrow(/durations not equal/);
    }
  });
});
