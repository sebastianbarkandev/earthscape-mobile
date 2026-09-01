import type { EventVideo } from './api';

/**
 * Multi-program (one event, several live/VOD videos — the aircraft plus phones
 * that joined via "Add my camera") policy helpers. Pure so they are unit-tested
 * with 1 primary + 3 live secondaries; ProgramStrip / PlayerScreen consume them.
 */

/**
 * Secondary tiles that get a real (muted, decoding) HLS player. iOS allows only a
 * handful of concurrent AVPlayer pipelines and every muted tile still decodes video,
 * so the rest fall back to a static thumbnail with the LIVE badge (still tappable).
 */
export const MAX_TILE_PLAYERS = 2;

export type TileMode = 'player' | 'thumbnail' | 'processing';

export interface ProgramTile {
  video: EventVideo;
  mode: TileMode;
}

export const isLiveProgram = (v: Pick<EventVideo, 'live_stream_state'>) => v.live_stream_state === 'live';

/** Tile caption: the program label, falling back to the title. */
export const programLabel = (v: Pick<EventVideo, 'program_type' | 'title'>) => v.program_type || v.title;

/**
 * Which secondaries to show and how. Live programs first (they are what a viewer
 * of a live event cares about), then VOD; the first `maxPlayers` decode, the rest
 * are thumbnails. `processing` programs (a stream that just ended; the serializer
 * still points hls_stream_url at the dead live playlist) never get a player.
 * Programs without any playable URL (and not processing) are dropped.
 */
export function planProgramTiles(videos: EventVideo[], activeId: number | null, maxPlayers = MAX_TILE_PLAYERS): ProgramTile[] {
  const candidates = videos.filter((v) => v.id !== activeId && v.has_video !== false);
  const live = candidates.filter(isLiveProgram);
  const rest = candidates.filter((v) => !isLiveProgram(v));
  let players = 0;
  const tiles: ProgramTile[] = [];
  for (const v of [...live, ...rest]) {
    if (v.live_stream_state === 'processing') {
      tiles.push({ video: v, mode: 'processing' });
      continue;
    }
    if (!v.hls_stream_url && !v.mp4_url) continue;
    if (players < maxPlayers) {
      players += 1;
      tiles.push({ video: v, mode: 'player' });
    } else {
      tiles.push({ video: v, mode: 'thumbnail' });
    }
  }
  return tiles;
}

/**
 * LIVE-003 mitigation: the backend's flight_data.json serves the PRIMARY video's
 * track whatever video id is requested, so when a secondary program is active the
 * map is honestly labelled as the primary's track instead of implying it is the
 * phone's own GPS. Returns null when the active video is the primary (or unknown).
 */
export function programTrackLabel(videos: EventVideo[], activeId: number | null): string | null {
  const active = videos.find((v) => v.id === activeId);
  if (!active || active.is_primary) return null;
  const primary = videos.find((v) => v.is_primary);
  if (!primary) return null;
  return `Track: ${programLabel(primary)} (primary)`;
}

/** Labels already used by non-primary programs of the event — for a joining phone's default name. */
export function existingProgramLabels(videos: EventVideo[]): string[] {
  return videos.filter((v) => !v.is_primary).map((v) => programLabel(v)).filter((s): s is string => !!s);
}
