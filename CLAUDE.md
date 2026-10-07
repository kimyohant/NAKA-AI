# CLAUDE.md

## Project Overview

naka-ai-backend — server side of NAKA-AI (AI short drama / product-video tool). The user-facing Nuxt app and the Electron
desktop app live in kimyohant/naka-drama-studio; check it out next to this repo (`../naka-drama-studio`) for full-stack work.

## Structure

```
backend/   — Hono + Drizzle ORM (better-sqlite3) + Mastra (AI agents); full history imported from naka-drama-studio
backend/workspace/ — Agent working directory (Mastra Workspace jail root); skills/ + prompts/
admin/     — NAKA Admin: Nuxt 3 SPA (ssr:false), system settings, served at /admin (base path /admin/)
study/     — Hypit render engine notes (source in study/hypit, not committed)
docker/, Dockerfile, docker-compose.yml — all-in-one image (backend + admin + frontend from naka-drama-studio)
```

## Commands

### Backend (`backend/`)
- `npm run dev` — tsx watch dev server (port 5679)
- `npm start` — tsx production start
- `npm run typecheck` — TypeScript type check
- `npx tsx --test tests/*.test.ts tests/*.test.mjs` — tests

### Admin (`admin/`)
- `npm run dev` — dev server on http://localhost:3014/admin/ (proxies /api, /static to 5679)
- `npm run generate` — static build in `.output/public` (served by the backend when `ADMIN_DIST` is set or the build exists)
- `npm test` — structure tests

## Architecture
- **HTTP**: Hono (`backend/src/index.ts`), routes at `/api/v1`, `/static` serves DATA_ROOT, `/admin` serves the admin build,
  everything else serves the user-facing frontend build (`FRONTEND_DIST`, default `../naka-drama-studio/frontend/.output/public`)
- **Admin guard**: `backend/src/middleware/admin.ts` — `ADMIN_TOKEN` (≥ 16 chars) protects the system-settings API;
  admin-only calls need `X-Admin-Token`. Open to the app: AI config list (keys stripped), style preset list, `/settings/*` prefs
- **Database**: SQLite (better-sqlite3 + WAL); DDL + idempotent migrations in `backend/src/db/sqlite-schema.ts`; Drizzle tables in `schema.ts`.
  Adding a migration: bump the pinned migration lists in the tests (`grep -rn "16, 17, 18" backend/tests`)
- **AI agents**: Mastra; instructions from `workspace/prompts/*.md` + skills; model resolved per request
- **Media generation**: `services/generation.ts` (sys_task lifecycle, adapter pattern); FFmpeg merge in `services/ffmpeg-merge.ts`
- **Cross-repo contracts**: tests reading the frontend use `backend/tests/_frontend.mjs` (skip when the sibling repo is missing)

## Key Config
- AI service configs live in the DB (`ai_service_configs`), edited from the admin app — never in config files
- Path defaults resolve from the repo root: `data/`, `study/hypit`; the desktop app injects `NAKA_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`FFMPEG_BIN`/`FFPROBE_BIN`
