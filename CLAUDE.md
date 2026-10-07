# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NAKA-AI TECH — an all-in-one production tool for AI short dramas / motion comics and product-selling videos. This repo holds the
**user-facing frontend** and the **Electron desktop app**. The backend (API, DB, AI agents, media generation), the system-settings
back-office (`/admin`) and the Docker deployment live in **kimyohant/naka-ai-backend** (private) — check it out next to this repo
(`../naka-ai-backend`) for anything that touches the server.

## Structure

```
frontend/  — Nuxt 3 + Vue 3 + TypeScript, ssr:false (plain CSS, no UI framework)
desktop/   — Electron desktop app: main process + esbuild bundling scripts + electron-builder config
             (bundles ../naka-ai-backend/backend and ../naka-ai-backend/admin; override NAKA_BACKEND_DIR)
deploy/ai-live/ — GPU agent for AI Live (separate service)
openwiki/  — generated docs (may still mention backend/ paths: they now refer to naka-ai-backend/backend)
configs/   — Legacy dead config, zero references in code
```

## Commands

### Frontend (`frontend/`)
- `npm run dev` — Vite dev server (port 3013, proxies /api and /static to the backend on 5679)
- `npm run generate` — produce a static site containing index.html (`.output/public`; `nuxt build` does not emit index.html and cannot be used for static hosting). The backend serves this folder by default when the repos sit side by side
- `node --test tests/*.test.mjs` — structure tests; the ones comparing against backend sources use `tests/_backend.mjs` and skip when `../naka-ai-backend` is missing

### Desktop (`desktop/`; `npm run dist` at the repo root chains the whole flow)
- Needs `../naka-ai-backend` with `npm install` in `backend/` and `npm run generate` in `admin/`
- `npm run dev` — bundle the backend + run in an Electron window
- `npm run build:backend` — esbuild bundles naka-ai-backend/backend/src → build/backend.mjs (ESM; externals: sharp/better-sqlite3/ffmpeg-static/ffprobe-static)
- `npm run build:main` — bundle the main process → dist/main.js
- `npm run rebuild:native` — rebuild better-sqlite3 for the Electron ABI (postinstall already does it)
- `npm run dist` — prepare-resources (frontend, admin, workspace template, fonts, ffmpeg) + electron-builder → release/
- `npm run dist:win` — cross-build the Windows NSIS installer (win-x64)
- `node --test desktop/tests/*.test.mjs` — packaging tests

### Backend (in naka-ai-backend)
- `cd ../naka-ai-backend/backend && npm run dev` (port 5679) — root `npm run dev:backend` does the same; `npm run dev:admin` starts the back-office

## Architecture

### Frontend
- Nuxt 3 SPA; dynamic routes are registered manually in `pages:extend` in `nuxt.config.ts`; `/` redirects to `/seller` (AI Seller), the drama studio is at `/drama`
- `app/composables/useApi.ts` is the unified fetch client (all relative paths, same origin as the backend in production)
- No Settings page: "configure AI" links go to the back-office (`runtimeConfig.public.adminUrl`, default `/admin/`)
- Core workbenches: `app/views/drama/episode.vue` (drama pipeline), `app/views/seller/workspace.vue` (AI Seller)

### Desktop
- Main process `desktop/src/main.ts`: single-instance lock → free port → userData preparation (workspace template copy-once + `.template-version` marker) → `utilityProcess.fork` the backend bundle (env: `NAKA_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`ADMIN_DIST`/`FFMPEG_BIN`/`FFPROBE_BIN`/`CAPTION_FONT_DIR`) → poll health → BrowserWindow
- No `ADMIN_TOKEN` on desktop, so `/admin` (system settings) opens without sign-in; in-app links that open a new tab load in the main window
- userData: packaged build `~/Library/Application Support/NakaAi/`, dev build `NakaAi-Dev/` (kept separate)

## Key Config
- AI service configs live in the backend DB and are edited in the back-office (`/admin`, naka-ai-backend), never in config files
- Backend environment variables (`ADMIN_TOKEN`, `NAKA_AUTH_PASSWORD`, `FRONTEND_DIST`, …) are documented in the naka-ai-backend README
- `configs/config.yaml` is dead config (do not reference it)

## Agent skills

### Issue tracker

Issues live in GitHub Issues on `kimyohant/naka-drama-studio` (via the `gh` CLI). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- OPENWIKI:START -->

## OpenWiki

@AGENTS.md

<!-- OPENWIKI:END -->
