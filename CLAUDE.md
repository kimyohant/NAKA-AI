# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NAKA-AI TECH — an all-in-one production tool for AI short dramas / motion comics and product-selling videos. Full TypeScript stack: novel → script rewrite → asset extraction → image generation → storyboard breakdown → video generation → FFmpeg merge & export. Ships as an Electron desktop app (macOS dmg) and as a server deployment.

## Structure

```
backend/   — Hono + Drizzle ORM (better-sqlite3) + Mastra (AI agents)
backend/workspace/ — Agent working directory (root of the Mastra Workspace jail)
backend/workspace/skills/ — Agent SKILL.md definitions (editable online from the back-office)
admin/     — NAKA Admin: Nuxt 3 SPA (ssr:false, base /admin/) for system settings, served by the backend at /admin
frontend/  — Nuxt 3 + Vue 3 + TypeScript, ssr:false (plain CSS, no UI framework)
desktop/   — Electron desktop app: main process + esbuild bundling scripts + electron-builder config
data/      — SQLite database (naka.sqlite3) + generated static files (static/)
configs/   — Legacy dead config, zero references in code
study/hypit/ — Full source of Hypit (hypit-ai/hypit @ 7f730ab); the Viral Clone "Hypit" render engine calls it via a CLI subprocess; internal use only, see study/README.md for the license
```

## Commands

### Backend (`backend/`)
- `npm run dev` — tsx watch dev server (port 5679)
- `npm start` — tsx production start
- `npm run typecheck` — TypeScript type check
- `npm run backfill-artwork` — backfill thumbnails and poster frames for existing images/videos

### Admin (`admin/`)
- `npm run dev` — dev server on http://localhost:3014/admin/ (proxies /api, /static to 5679)
- `npm run generate` — static build in `.output/public` (served by the backend when built, or from `ADMIN_DIST`)
- `npm test` — structure tests

### Tests
- backend: `cd backend && npx tsx --test tests/*.test.ts tests/*.test.mjs`; frontend: `cd frontend && node --test tests/*.test.mjs`; desktop: `node --test desktop/tests/*.test.mjs`

### Deploy
- Windows server: `scripts\redeploy.ps1` (npm ci, frontend + admin generate, SQLite snapshot, detached restart on 5679)
- Docker: `docker compose up -d --build` (project name pinned to `naka-drama-studio`, data in the `naka-drama-studio_naka-data` volume)

### Frontend (`frontend/`)
- `npm run dev` — Vite dev server (port 3013, proxies /api and /static to 5679)
- `npm run generate` — produce a static site containing index.html (`.output/public`; `nuxt build` does not emit index.html and cannot be used for static hosting)

### Desktop (`desktop/`; `npm run dist` at the repo root chains the whole flow)
- `npm run dev` — bundle the backend + run in an Electron window
- `npm run build:backend` — esbuild bundles backend/src → build/backend.mjs (ESM; externals: sharp/better-sqlite3/ffmpeg-static/ffprobe-static)
- `npm run build:main` — bundle the main process → dist/main.js
- `npm run rebuild:native` — rebuild better-sqlite3 for the Electron ABI (required whenever the native module ABI changes; postinstall already does it)
- `npm run dist` — prepare-resources + electron-builder produces arm64/x64 dmg → release/
- `npm run dist:win` — cross-build the Windows NSIS installer (win-x64); the Windows ffmpeg.exe is cached in build/win-bin/ (the script prints a download URL if it is missing)

## Architecture

### Backend
- **HTTP**: Hono (entry `src/index.ts`), routes mounted at `/api/v1`, `/static` serves DATA_ROOT, `/admin` serves the admin build, everything else the frontend build (`FRONTEND_DIST`, default `frontend/dist`, else `frontend/.output/public`)
- **Members (unified system)**: with `NAKA_SSO_URL`/`NAKA_SSO_SECRET` set, members sign in through the naka-ai.com Worker (kimyohant/naka-ai-landing, `src/auth/studio.ts`) — `src/auth/naka-sso.ts`. The Worker is the account hub (members, credits, payments, the one admin); this backend is the production engine. SSO off = single-user mode (`'local'`)
- **Per-member data**: `src/auth/ownership.ts` (after requireSession) checks every id a request names — path segments and parent ids in query/JSON body — and answers 404 `E_FORBIDDEN_OWNER` for another member's rows. Top-level tables carry `owner_user_id` (stamped on insert from `auth/owner-context.ts`, an AsyncLocalStorage scope); children resolve through their parent. List queries add `ownedBy(table.ownerUserId)`. New top-level table → add the column, an `OWNER_SQL`/`PATH_KINDS` entry and the list filter. Admins open anything and list their own + legacy `'local'` rows
- **Admin guard**: `src/middleware/admin.ts` — `ADMIN_TOKEN` (≥ 16 chars, `X-Admin-Token`) or a naka-ai admin session protects the system-settings API
- **Database**: SQLite (better-sqlite3 + WAL); `SQLITE_PATH` overrides the DB file location; DDL lives in `src/db/sqlite-schema.ts` and is replayed idempotently at startup; Drizzle table definitions in `src/db/schema.ts` (sqlite-core). Adding a migration: bump the pinned migration lists in the tests (`grep -rn "19, 20, 21" backend/tests`)
- **Path anchors**: `src/utils/paths.ts` resolves DATA_ROOT/STORAGE_ROOT in one place; the desktop app injects env from the Electron main process (`NAKA_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`FFMPEG_BIN`/`FFPROBE_BIN`); dev uses repo-relative defaults
- **AI Agents**: Mastra, 4 agents (script_rewriter / extractor / storyboard_breaker / prompt_generator); instructions are assembled dynamically from `workspace/prompts/*.md` + skills, and the model is resolved per request; a chain of fetch patches adapts to domestic (China) relay providers (disable thinking / temperature / max_tokens)
- **Media generation**: `services/generation.ts` owns the unified task lifecycle (sys_task table), using an adapter pattern: image — openai/gemini/volcengine; video — volcengine/minimax
- **Video merge**: `services/ffmpeg-merge.ts`; FFmpeg binaries are bundled (ffmpeg-static), overridable via `FFMPEG_BIN`/`FFPROBE_BIN`
- **Hypit render engine**: `services/hypit-render.ts`; when a Viral Clone project has `render_engine='hypit'`, SVML is generated from the beat segments and `study/hypit/bin/hypit.mjs build` is spawned; if unavailable or failing it automatically falls back to the ffmpeg path

### Frontend
- Nuxt 3 SPA; dynamic routes are registered manually in `pages:extend` in `nuxt.config.ts`; `/` redirects to `/seller` (AI Seller), the drama studio is at `/drama`
- No Settings page: "configure AI" links go to the back-office (`runtimeConfig.public.adminUrl`, default `/admin/`); a 401 `E_AUTH_REQUIRED` sends the browser to the naka-ai sign-in
- `app/composables/useApi.ts` is the unified fetch client (all relative paths, same origin as the backend in production)
- Core workbenches: `app/views/drama/episode.vue` (drama pipeline), `app/views/seller/workspace.vue` (AI Seller)

### Desktop
- Main process `desktop/src/main.ts`: single-instance lock → free port → userData preparation (workspace template copy-once + `.template-version` marker) → `utilityProcess.fork` the backend bundle (env: `NAKA_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`ADMIN_DIST`/`FFMPEG_BIN`/`FFPROBE_BIN`/`CAPTION_FONT_DIR`) → poll health → BrowserWindow
- No `ADMIN_TOKEN` on desktop, so `/admin` opens without sign-in; in-app links that open a new tab load in the main window
- userData: packaged build `~/Library/Application Support/NakaAi/`, dev build `NakaAi-Dev/` (kept separate)
- The backend bundle lives inside the asar (externals resolve through the asar node_modules; `.node` files are redirected to unpacked automatically)

## Database
Single SQLite file (default `data/naka.sqlite3`; in userData for the desktop app). `initSqliteSchema` idempotently creates tables and seeds style presets at startup. One-off MySQL→SQLite migration: `cd backend && npx tsx scripts/import-mysql-to-sqlite.ts [--force]` (per-table row-count verification, backup before writing).

## Key Config
- AI service configs are stored in the DB (`ai_service_configs` table) and maintained from the back-office app (`admin/`, served by the backend at `/admin`), not in config files. The user-facing app no longer has a Settings menu
- `ADMIN_TOKEN`: guards the system-settings API (`backend/src/middleware/admin.ts`); admin-only calls need `X-Admin-Token`. The app keeps open reads (AI config list without keys, style presets) and `/settings/*` user prefs
- The full list of environment variables is in the README ("环境变量" section); `configs/config.yaml` is dead config (do not reference it)
- `PUBLIC_BASE_URL`: Seedance needs a public address to reference local assets; the desktop app cannot provide one (it shows a Chinese error message)

## Agent skills

### Issue tracker

Issues and specs live as local markdown files under `.scratch/<feature>/`. Older issues stay on GitHub (`kimyohant/naka-drama-studio`) as history. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- OPENWIKI:START -->

## OpenWiki

@AGENTS.md

<!-- OPENWIKI:END -->
