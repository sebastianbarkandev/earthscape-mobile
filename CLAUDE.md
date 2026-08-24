# CLAUDE.md — Earthscape Mobile

React Native app (Expo, TypeScript, expo-router) for Earthscape: aerial-video platform (police/utility flight footage + synced flight-path maps). This repo is a **client** of the existing Earthscape Flask API (separate `earthscape` repo: Flask + Flask-Security + SQLAlchemy/Alembic + Postgres/PostGIS + Celery + S3/CloudFront). This repo contains **zero backend code**. Backend changes are additive-only, in the earthscape repo, on feature branches — the production website shares every endpoint; never change an existing response shape.

## Commands
- Dev: `npx expo start` (backend running from earthscape repo: `--host 0.0.0.0`, port 8000)
- Device build: `npx expo run:ios --device` (required after adding native modules)
- Video/HLS must be tested on a PHYSICAL iPhone; the Simulator is unreliable for AVPlayer.

## Hard rules (each verified against backend source)
1. **Base URL = org subdomain** (`https://{sub}.earthscape.com`), built in `src/common/config.ts`; dev = LAN IP. **NEVER the `api.` subdomain**: `before_request` skips org loading for it, and the auth decorators (`login_required_but_demo_okay`) and `requires_setting` dereference `g.organization`/`g.settings` — they crash or 403 without the org subdomain.
2. **Auth = Flask-Security 5.x session cookie.** `LoginForm` is stock Flask-Security (fields: `email`, `password`, `remember`). Login: `POST /login`, JSON body, `Accept: application/json` → JSON response + session cookie. All fetches include credentials (matches the web repo's `EventsApi`/`TagApi` convention). CSRF: server-side monkeypatch exempts JSON content-type and `/api/`+`/v1/` paths — do not send CSRF tokens. Do NOT build JWT auth (the backend's JWT pieces are only for live WebRTC viewer-session tokens + a public-key endpoint). Store only subdomain + login flag in expo-secure-store.
   - **Demo escape hatch:** orgs with `is_demo=True` bypass auth entirely in `login_required_but_demo_okay`.
   - **MFA:** orgs with `REQUIRE_MFA` or users with `authy_id` get redirected to TOTP flows — use a non-MFA test user; do not build MFA screens.
3. **Video = expo-video only.** VOD source: `hls_stream_url` (fallback `mp4_url`) from the event payload. Live source: `GET /live/{live_stream_id}/playlist.m3u8` (server-cached HLS; supports `?token=` share tokens). Media URLs are sometimes absolute (CloudFront) and sometimes server-relative (live playlist via url_for) — always resolve through `resolveMediaUrl` in config.ts. Do NOT implement WebRTC/mediasoup/viewer-session — that's the web live path.
4. **Map = react-native-maps** (Apple Maps, `mapType="hybrid"`). Flight path Polyline = `map.data.loc`; target path Polyline = `map.data.target`; aircraft Marker pos = `getClosestPointValueOrNull(map.data.loc, currentUtc)`, rotation = closest `acft_hdg`; footprint Polygon. Series values arrive `[lat, lon]` (backend ST_FlipCoordinates). Web parity NOT wanted: no KML, TAK, heatmap, drawing tools, locate control.
5. **`src/common/lib/` contains verbatim ports — never rewrite, "improve," or reformat them; wrap if needed:**
   - `TimeMapper.js`: `createTimeMapper(startUtc, videoTimeUtcTimeMap) → {startUtc, videoTimeUtcTimeMap, videoToUtc(t), utcToVideo(t)}`. Handles gap-compensated videos. API sends snake_case `time_mapping` entries (`video_start`…) — convert keys before constructing (done in playerSlice.toMapperSpec). ALL video↔UTC conversion goes through this; naive `start + seconds` math is WRONG.
   - `timeSeries.js`: series = arrays of `[utc, value]`. `getClosestPointValueOrNull(series, utc)` (binary search; clamps to edge values out of range — keeps the aircraft pinned at path ends), `getLastValueOrNull(series)` (live-follow mode).
   - `mergeGraphData.js`: ⚠ currently a PLACEHOLDER — replace with the verbatim web copy before any graph feature.
   - Mappers hold functions and are never stored in Redux: keep the spec `{startUtc, videoTimeUtcTimeMap}` in state, re-create via `createTimeMapper` at use sites (`useTimeMapper` hook — the web does the same).
6. **State = Redux Toolkit, slim**: `auth`, `library`, `player` slices only (web has ~24 — do not mirror them). `reference/eventSlice.js` maps the domain — read for shapes/endpoints, never copy logic (it's bound to window/document/Jinja globals; mobile has `src/common/config.ts` instead).
7. **Styling = StyleSheet + `src/common/theme.ts`** — tokens extracted from web player.scss: `accent #FB8333 / hover #FF9B58 / active #E9741F / tint #FFF3EA; bg #F9F9F9, surface #FFF, bgSubtle #F2F2F2, bgHover #E9E9E9, bgActive #DCDCDC; text #0F0F0F / #606060 / #909090; border #E5E5E5 / #D3D3D3; danger #C62828, success #2E7D32, live #CC0000; radius 6/12/16/pill`. No SCSS, no Tailwind, no invented colors.

## API contracts (traced to backend source; times are UTC epoch floats unless noted)
- `POST /login` — JSON `{email, password}` → session cookie. Runtime response shape: verify once.
- `GET /api/v1/bootstrap` — shell bootstrap (SPA's bootstrapSlice consumes it). Shape UNVERIFIED; authSlice stores it loosely.
- `GET /api/v1/videos/list?page&per_page&sort` → `{items[], page, per_page, total, pages, has_next, has_prev, sort}`; item `{id, title, status, duration, uploaded_filesize, date_posted(ISO), start(ISO), thumbnail_url, deleted_at, user{}, tail?}`. Sorts: recently-uploaded|recently-recorded|title-asc|title-desc|shortest|longest|category-asc|category-desc. ISO dates may lack 'Z' — normalize via `normalizeIsoDate`.
- `GET /api/v1/live/list?page` → same envelope, currently-live videos.
- `GET /api/v1/events/{event_id}.json` → `{events:[{id, tags, custom_field_values, videos:[videoDict]}]}`. videoDict: `{id, event_id, title, description, duration, start, end (epoch floats), date_posted(epoch string), is_primary, program_type, status, live_stream_state (null|'live'|'processing'|'recording_ready'), live_stream_id?, live_start?, hls_stream_url, mp4_url, stream_url, thumbnails_vtt_url, subtitles_vtt_url, thumbnail_url, time_mapping (snake_case), waveform, transcript, clipmarks[], tail, has_audio, has_video, download_url}`.
- `GET /api/v1/videos/{id}/flight_data.json[?after=<epoch>]` (accepts `?token=` share token) → `{flight_data:{loc, target, footprint, acft_hdg, graphs, first_flight_point_utc, last_flight_point_utc}}` — compressed `[utc, value]` series. Load pattern (useFlightData): initial fetch, then loop `?after=last_flight_point_utc` concatenating until no new tail; while `live_stream_state==='live'`, keep polling (~7s).
- `POST /api/v1/videos/{id}/viewing` body `{paused}` → `{liveStreamState, loggedIn}`. Fire every 5s on the player (useViewingHeartbeat); on liveStreamState change, reload the event so the source swaps live↔VOD.
- Clipmarks: `GET/POST /api/v1/videos/{id}/clipmarks` (POST `{event_id, time_start, time_end, type, text}` epoch floats; type 'clip' triggers server-side eager render of ts+mp4 to EFS); `POST .../clipmarks/{cid}` update; `DELETE`; `POST .../clipmarks/{cid}/clip` `{title, description}` → new Video via Celery; `GET .../formats` → `{formats:[]}`; `GET .../download?format=` — poll header `X-Status: 'File ready for download'`.
- Search (stretch): `POST /api/v1/clip_embedding/search/enhanced` `{query, top_k, rerank}`; tags `GET /api/v1/tags`; filters `GET /api/v1/videos/filter_choices`.
- Multi-program events: always use the video where `is_primary === true`; ignore secondaries.
- Permission quirk: `flight_data.json` checks LIVESTREAMS READ while live and VIDEOS READ otherwise — a 403 mid-transition means reload the event, not a client bug.

## Verified vs UNVERIFIED
Verified: everything in "API contracts" traced to backend source; HLS is the VOD default; clipping is server-side; live HLS playlist endpoint exists with ACL + share-token checks; demo orgs bypass auth; CSRF exempt for JSON+/api.
UNVERIFIED — do not build load-bearing code on these; flag and ask when reached:
- [ ] Live playlist.m3u8 plays and stays current in AVPlayer during a real stream (cached_playlist freshness)
- [ ] `POST /login` JSON runtime response shape (Flask-Security 5.x JSON mode assumed on)
- [ ] `GET /api/v1/bootstrap` response contents
- [ ] `event_id` present in `/videos/list` items and `event_id`+`live_stream_id` in `/live/list` items — if missing: additive backend fix in videos_list_api / live list serializer; do NOT work around with per-item requests
- [ ] Session cookie persistence across app restarts on iOS

## Implementation status (initial scaffold — update as things change)
Built and wired: session login (`features/auth`: authSlice + LoginScreen, subdomain-first), library + live lists with pagination/sort/pull-to-refresh (`features/library`), the player (`features/player`): expo-video via PlayerVideo (native controls, timeUpdate @0.5s), react-native-maps via FlightMap, flight-data incremental loop (useFlightData), 5s heartbeat + live↔VOD reload (useViewingHeartbeat), TimeMapper spec-in-store pattern (useTimeMapper), clipmark tap-to-seek chips (requestSeek one-shot consumed by PlayerVideo). Routes in `app/` are thin and must stay thin. Store: `src/store` assembles the three slices; typed hooks in `src/store/hooks.ts`.
Known intentional gaps / tripwires:
- `src/common/lib/mergeGraphData.js` is a PLACEHOLDER — swap in the verbatim web copy.
- Missing `event_id` in list payloads raises an Alert naming the backend fix — do not work around it client-side.
- Nothing has run against the real API yet: expect the login response parse in authSlice and the EventPayload types in `features/player/api.ts` to need small corrections on first contact — correct the types, don't add defensive mush.
- No tests yet. When adding: unit-test `src/common/lib` ports first (pure JS) — those tests define the ports' contract; never edit the libs to make tests pass.

## Scope (hackathon)
IN, priority order: session login → library (list/paginate/sort) → VOD player (video top, synced map below, fullscreen landscape) → map sync (flight_data + TimeMapper + closest-point marker) → live (list → playlist.m3u8 → heartbeat transition → incremental flight points) → polish. STRETCH: two-tap clip in/out (no scrubber — server renders), semantic search box.
OUT (do not build or scaffold): uploads, drawing tools, KML/TAK layers, transcripts/CC, screenshots, admin/superadmin, WebRTC, MFA screens, multiprogram/secondary videos, timeline pan/zoom, VTT scrub thumbnails, playlists, reporting, ArcGIS, JWT auth.

## Conventions
- Screens in `app/` (expo-router — the file tree IS the router; route files stay thin); domain code in `src/features/{auth,library,player}` (mirrors the web repo's feature-folder convention); shared code in `src/common`; `src/common/config.ts` is the only place URLs are built; every request goes through `src/common/api/client.ts` — no raw fetch in components.
- Deployment target: Expo default — do not override. `EXPO_PUBLIC_API_URL` per eas.json profile (development/staging/production).
- `reference/` is gitignored web-repo context (eventSlice.js, Map.jsx, Dashboard.jsx, sample payloads) — read it via explicit paths (search tools skip gitignored files), never import from it.
- Backend repo access when needed: `/add-dir ~/dev/earthscape` in-session; backend edits stay deliberate, additive, on feature branches — never in auto mode.

## Standing rules (workflow)
- NEVER commit or push unless I explicitly say to. Prepare commits when asked; stop there. (Enforced in .claude/settings.json: push denied, commit asks.)
- Never reformat, clean whitespace, or change line endings on lines you aren't otherwise editing. Repo standard is LF (.gitattributes enforces it).
- After completing any feature or fix, run /review-loop before declaring it done: the code-reviewer subagent reviews the diff cold; fix every CRITICAL and WARNING; each fix round gets a FRESH reviewer. 3-iteration cap, then stop and escalate remaining findings to me.
- Tests are the contract: run them (and `npx tsc --noEmit`) before review; never edit `src/common/lib` to satisfy a test.
- Prefer plan mode for anything touching playerSlice, auth, or the backend repo.
- When an UNVERIFIED item above is hit at runtime, state it explicitly, propose the fix, and update this file's checkbox with the verified fact before moving on. Keep this file under ~200 lines — cut before adding.
