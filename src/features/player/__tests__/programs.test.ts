import { existingProgramLabels, isMobileProgram, MAX_TILE_PLAYERS, planProgramTiles, programTrackLabel, wantsOwnTrack } from '../programs';
import { makeVideo, primary, s1, s2, s3, s4 } from './multiprogramFixtures';

describe('planProgramTiles (ProgramStrip policy)', () => {
  it('caps decoding tiles at MAX_TILE_PLAYERS, live first, the rest as thumbnails', () => {
    const vod = makeVideo({ id: 300, program_type: 'IR' });
    const tiles = planProgramTiles([primary, vod, s1, s2, s3], primary.id);
    expect(tiles.map((t) => t.video.id)).toEqual([201, 202, 203, 300]);
    expect(tiles.filter((t) => t.mode === 'player')).toHaveLength(MAX_TILE_PLAYERS);
    expect(tiles.map((t) => t.mode)).toEqual(['player', 'player', 'thumbnail', 'thumbnail']);
  });

  it('never renders the active program, never gives a processing program a player, drops URL-less VOD', () => {
    const processing = { ...s4, live_stream_state: 'processing' as const };
    const noUrl = makeVideo({ id: 301, hls_stream_url: null, mp4_url: null });
    const noVideo = makeVideo({ id: 302, has_video: false });
    const tiles = planProgramTiles([primary, s1, processing, noUrl, noVideo], s1.id);
    expect(tiles.map((t) => [t.video.id, t.mode])).toEqual([
      [100, 'player'],
      [204, 'processing'],
    ]);
  });

  it('with 3 live phones and the primary active, every phone is visible and tappable', () => {
    const tiles = planProgramTiles([primary, s1, s2, s3], primary.id);
    expect(tiles).toHaveLength(3);
    expect(tiles.every((t) => t.video.live_stream_state === 'live')).toBe(true);
  });
});

describe('isMobileProgram / wantsOwnTrack', () => {
  it('a phone program is one whose program_type starts with "mobile" (web parity)', () => {
    expect(isMobileProgram(s1)).toBe(true);
    expect(isMobileProgram(makeVideo({ id: 300, program_type: 'IR' }))).toBe(false);
    expect(isMobileProgram(makeVideo({ id: 301, program_type: null }))).toBe(false);
    expect(isMobileProgram(null)).toBe(false);
  });

  it('only a non-primary phone program fetches its own flight points', () => {
    expect(wantsOwnTrack(s1)).toBe(true);
    expect(wantsOwnTrack(primary)).toBe(false);
    expect(wantsOwnTrack(makeVideo({ id: 300, program_type: 'IR' }))).toBe(false);
    expect(wantsOwnTrack(makeVideo({ id: 302, program_type: 'Mobile', is_primary: true }))).toBe(false);
    expect(wantsOwnTrack(null)).toBe(false);
  });
});

describe('programTrackLabel (LIVE-003 mitigation)', () => {
  it('is null for the primary and for a phone program (own track), names the primary for other secondaries', () => {
    const ir = makeVideo({ id: 300, program_type: 'IR' });
    expect(programTrackLabel([primary, s1], primary.id)).toBeNull();
    expect(programTrackLabel([primary, s1], s1.id)).toBeNull();
    expect(programTrackLabel([primary, ir], ir.id)).toBe('Track: Flight 12 (primary)');
    expect(programTrackLabel([ir], ir.id)).toBeNull();
  });
});

describe('existingProgramLabels', () => {
  it('lists non-primary program labels for the joining phone default name', () => {
    expect(existingProgramLabels([primary, s1, s2])).toEqual(['Mobile · Ana', 'Mobile · Ben']);
  });
});
