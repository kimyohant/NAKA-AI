# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NAKA-AI TECH — an all-in-one production tool for AI short dramas / motion comics. Full TypeScript stack: novel → script rewrite → asset extraction → image generation → storyboard breakdown → video generation → FFmpeg merge & export. Ships as an Electron desktop app (macOS dmg) and as a server deployment.

## Structure

```
backend/   — Hono + Drizzle ORM (better-sqlite3) + Mastra (AI agents)
backend/workspace/ — Agent working directory (root of the Mastra Workspace jail)
backend/workspace/skills/ — Agent SKILL.md definitions (editable online from the Settings page)
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
- **HTTP**: Hono (entry `src/index.ts`), routes mounted at `/api/v1`, `/static` serves DATA_ROOT, production serves the frontend static directory
- **Database**: SQLite (better-sqlite3 + WAL); `SQLITE_PATH` overrides the DB file location; DDL lives in `src/db/sqlite-schema.ts` and is replayed idempotently at startup; Drizzle table definitions in `src/db/schema.ts` (sqlite-core)
- **Path anchors**: `src/utils/paths.ts` resolves DATA_ROOT/STORAGE_ROOT in one place; the desktop app injects env from the Electron main process (`HUOBAO_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`FFMPEG_BIN`/`FFPROBE_BIN`); dev uses repo-relative defaults
- **AI Agents**: Mastra, 4 agents (script_rewriter / extractor / storyboard_breaker / prompt_generator); instructions are assembled dynamically from `workspace/prompts/*.md` + skills, and the model is resolved per request; a chain of fetch patches adapts to domestic (China) relay providers (disable thinking / temperature / max_tokens)
- **Media generation**: `services/generation.ts` owns the unified task lifecycle (sys_task table), using an adapter pattern: image — openai/gemini/volcengine; video — volcengine/minimax
- **Video merge**: `services/ffmpeg-merge.ts`; FFmpeg binaries are bundled (ffmpeg-static), overridable via `FFMPEG_BIN`/`FFPROBE_BIN`
- **Hypit render engine**: `services/hypit-render.ts`; when a Viral Clone project has `render_engine='hypit'`, SVML is generated from the beat segments and `study/hypit/bin/hypit.mjs build` is spawned; if unavailable or failing it automatically falls back to the ffmpeg path

### Frontend
- Nuxt 3 SPA; dynamic routes are registered manually in `pages:extend` in `nuxt.config.ts` (views/drama/)
- `app/composables/useApi.ts` is the unified fetch client (all relative paths, same origin as the backend in production)
- Core workbench `app/views/drama/episode.vue` (script → production → export pipeline)

### Desktop
- Main process `desktop/src/main.ts`: single-instance lock → free port → userData preparation (workspace template copy-once + `.template-version` marker) → `utilityProcess.fork` the backend → poll health → BrowserWindow
- userData: packaged build `~/Library/Application Support/NakaAi/`, dev build `NakaAi-Dev/` (kept separate)
- The backend bundle lives inside the asar (externals resolve through the asar node_modules; `.node` files are redirected to unpacked automatically)

## Database
Single SQLite file (default `data/naka.sqlite3`; in userData for the desktop app). `initSqliteSchema` idempotently creates tables and seeds style presets at startup. One-off MySQL→SQLite migration: `cd backend && npx tsx scripts/import-mysql-to-sqlite.ts [--force]` (per-table row-count verification, backup before writing).

## Key Config
- AI service configs are stored in the DB (`ai_service_configs` table) and maintained from the Settings page, not in config files
- The full list of environment variables is in the README ("环境变量" section); `configs/config.yaml` is dead config (do not reference it)
- `PUBLIC_BASE_URL`: Seedance needs a public address to reference local assets; the desktop app cannot provide one (it shows a Chinese error message)

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
