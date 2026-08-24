# Earthscape Mobile

React Native (Expo) client for the Earthscape Flask API. Read **CLAUDE.md** first —
it is the ground truth for architecture rules, API contracts, and scope.

## Setup

```bash
npm install
npx expo install --fix        # aligns native-module versions to the Expo SDK
```

1. Set your laptop's LAN IP in `src/common/config.ts` (`DEV_API_HOST`).
2. Start the backend from the earthscape repo:
   `uvicorn/flask run with --host 0.0.0.0 --port 8000` (per its own docs).
3. Verify from the iPhone's Safari: `http://<LAN-IP>:8000` loads.
4. Run on a physical device (required for video/HLS):

```bash
npx expo run:ios --device
```

## Structure

- `app/` — expo-router routes (THIN; the file tree is the router)
- `src/common/` — config, theme tokens (from web player.scss), API client, verbatim libs
- `src/features/{auth,library,player}/` — feature folders (mirrors the web repo's convention)
- `src/store/` — Redux Toolkit assembly
- `reference/` — gitignored web-repo context for Claude Code

## Day-one verification list (also in CLAUDE.md)

- [ ] `POST /login` JSON returns 2xx + session cookie (test in LoginScreen)
- [ ] Live `playlist.m3u8` plays in AVPlayer during a real stream
- [ ] `event_id` present in `/videos/list` and `/live/list` items (the app
      alerts with the exact backend fix if missing)
- [ ] `GET /api/v1/bootstrap` response shape (stored loosely in authSlice)
- [ ] Replace `src/common/lib/mergeGraphData.js` placeholder with the verbatim web copy

## Env profiles

`eas.json`: development (dev client) / staging / production. `EXPO_PUBLIC_API_URL`
overrides the host per profile; empty in production so the subdomain entered at
login builds the URL (org-subdomain rule — never `api.*`).
