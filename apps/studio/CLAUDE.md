# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in `apps/studio/` of the NAKA-AI monorepo (see the root `CLAUDE.md`).

## Project Overview

NAKA-AI TECH — an all-in-one production tool for AI short dramas / motion comics and product-selling videos. Full TypeScript stack: novel → script rewrite → asset extraction → image generation → storyboard breakdown → video generation → FFmpeg merge & export. Ships as a server deployment (Docker). The Electron desktop app was retired (2026-10); `desktop/` was removed in the monorepo merge.

## Structure

```
backend/   — Hono + Drizzle ORM (better-sqlite3) + Mastra (AI agents)
backend/workspace/ — Agent working directory (root of the Mastra Workspace jail)
backend/workspace/skills/ — Agent SKILL.md definitions (editable online from the back-office)
admin/     — NAKA Admin: Nuxt 3 SPA (ssr:false, base /admin/) for system settings, served by the backend at /admin
frontend/  — Nuxt 3 + Vue 3 + TypeScript, ssr:false (plain CSS, no UI framework)
data/      — SQLite database (naka.sqlite3) + generated static files (static/)
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
- backend: `cd backend && npx tsx --test tests/*.test.ts tests/*.test.mjs`; frontend: `cd frontend && node --test tests/*.test.mjs`

### Deploy
- Windows server: `scripts\redeploy.ps1` (npm ci, frontend + admin generate, SQLite snapshot, detached restart on 5679)
- Docker: `docker compose up -d --build` (run from `apps/studio/`; project name pinned to `naka-drama-studio`, data in the `naka-drama-studio_naka-data` volume)

### Frontend (`frontend/`)
- `npm run dev` — Vite dev server (port 3013, proxies /api and /static to 5679)
- `npm run generate` — produce a static site containing index.html (`.output/public`; `nuxt build` does not emit index.html and cannot be used for static hosting)

## Architecture

### Backend
- **Layout** (docs/adr/0003, root of the monorepo): `src/core/` is shared by every menu (`http`, `auth`, `db`, `ai` + `ai/adapters`, `agents`, `mastra`, `generation`, `production` (episode/storyboard readiness, ffmpeg merge, captions — Product Studio and Viral Clone reuse the drama tables as their timeline), `product`, `tasks`, `utils`, `system`, and the shared `routes`). Each product menu lives in `src/modules/<menu>/` (`drama`, `marketer`, `product-studio`, `seller`, `viral-clone`, `live`) with `routes/`, `services/`, optional `agent-tools.ts`, and an `index.ts` that exports its `StudioModule` (`core/module.ts`: routes + startup `failStale`/`resume`) plus whatever other menus may use. `src/modules.ts` lists the menus in recovery order. Rules, enforced by `tests/module-boundaries.test.mjs` (in CI): `core/` never imports a menu; a menu imports another menu only via its `index.ts` and only product-studio → marketer, seller → marketer/product-studio, viral-clone → product-studio. New menu = new folder + index.ts + entry in `modules.ts` + `ALLOWED` in that test. Agents owned by a menu get their tools from that menu: `modules/<menu>/agent-tools.ts` calls `registerAgentTools(type, tools)` (core/agents) on import, and the menu's service imports that file before running the agent (tools resolve per request)
- **HTTP**: Hono (entry `src/index.ts`), routes mounted at `/api/v1`, `/static` serves DATA_ROOT, `/admin` serves the admin build, everything else the frontend build (`FRONTEND_DIST`, default `frontend/dist`, else `frontend/.output/public`)
- **Members (unified system)**: with `NAKA_SSO_URL`/`NAKA_SSO_SECRET` set, members sign in through the naka-ai.com Worker (`apps/landing/src/auth/studio.ts` in this monorepo) — `src/core/auth/naka-sso.ts`. The Worker is the account hub (members, credits, payments, the one admin); this backend is the production engine. SSO off = single-user mode (`'local'`)
- **Per-member data**: `src/core/auth/ownership.ts` (after requireSession) checks every id a request names — path segments and parent ids in query/JSON body — and answers 404 `E_FORBIDDEN_OWNER` for another member's rows. Top-level tables carry `owner_user_id` (stamped on insert from `core/auth/owner-context.ts`, an AsyncLocalStorage scope); children resolve through their parent. List queries add `ownedBy(table.ownerUserId)`. New top-level table → add the column, an `OWNER_SQL`/`PATH_KINDS` entry and the list filter. Admins open anything and list their own + legacy `'local'` rows
- **Admin guard**: `src/core/auth/admin.ts` — `ADMIN_TOKEN` (≥ 16 chars, `X-Admin-Token`) or a naka-ai admin session protects the system-settings API
- **Database**: SQLite (better-sqlite3 + WAL); `SQLITE_PATH` overrides the DB file location; DDL lives in `src/core/db/sqlite-schema.ts` and is replayed idempotently at startup; Drizzle table definitions in `src/core/db/schema.ts` (sqlite-core). Adding a migration: bump the pinned migration lists in the tests (`grep -rn "19, 20, 21" backend/tests`)
- **Path anchors**: `src/core/utils/paths.ts` resolves DATA_ROOT/STORAGE_ROOT in one place; Docker injects `NAKA_DATA_DIR`/`SQLITE_PATH`/`WORKSPACE_PATH`/`FRONTEND_DIST`/`ADMIN_DIST`; dev uses defaults relative to `apps/studio/`
- **AI Agents**: Mastra, 4 agents (script_rewriter / extractor / storyboard_breaker / prompt_generator); instructions are assembled dynamically from `workspace/prompts/*.md` + skills, and the model is resolved per request; a chain of fetch patches adapts to domestic (China) relay providers (disable thinking / temperature / max_tokens)
- **Media generation**: `core/generation/generation.ts` owns the unified task lifecycle (sys_task table), using an adapter pattern: image — openai/gemini/volcengine; video — volcengine/minimax
- **Video merge**: `core/production/ffmpeg-merge.ts`; FFmpeg binaries are bundled (ffmpeg-static), overridable via `FFMPEG_BIN`/`FFPROBE_BIN`
- **Hypit render engine**: `services/hypit-render.ts`; when a Viral Clone project has `render_engine='hypit'`, SVML is generated from the beat segments and `study/hypit/bin/hypit.mjs build` is spawned; if unavailable or failing it automatically falls back to the ffmpeg path

### Frontend
- Nuxt 3 SPA; `/` redirects to `/seller` (AI Seller), the drama studio is at `/drama`
- **Menus are Nuxt layers** in `frontend/menus/<menu>/` (same six names as the backend modules): `pages/`, `views/` (pages with params), `components/`, `utils/`, `locales/{th,en}.json` (that menu's top-level i18n section) and `routes.ts` (its param routes). `menus/index.ts` `MENUS` is the switch: `nuxt.config.ts` extends those layers and registers their `routes.ts` in `pages:extend`. Shared UI stays in `app/` (layouts, base components, composables, plugins, assets, public, shared strings in `app/locales`); `app/composables/i18n.ts` merges `app/locales` with every `menus/*/locales`. Inside a layer `~/` still means `app/`; import another file of the same menu relatively. Frontend tests read merged messages through `tests/_locales.mjs`
- No Settings page: "configure AI" links go to the back-office (`runtimeConfig.public.adminUrl`, default `/admin/`); a 401 `E_AUTH_REQUIRED` sends the browser to the naka-ai sign-in
- `app/composables/useApi.ts` is the unified fetch client (all relative paths, same origin as the backend in production)
- Core workbenches: `menus/drama/views/episode.vue` (drama pipeline), `menus/seller/views/workspace.vue` (AI Seller)

## Database
Single SQLite file (default `data/naka.sqlite3`). `initSqliteSchema` idempotently creates tables and seeds style presets at startup. One-off MySQL→SQLite migration: `cd backend && npx tsx scripts/import-mysql-to-sqlite.ts [--force]` (per-table row-count verification, backup before writing).

## Key Config
- AI service configs are stored in the DB (`ai_service_configs` table) and maintained from the back-office app (`admin/`, served by the backend at `/admin`), not in config files. The user-facing app no longer has a Settings menu
- `ADMIN_TOKEN`: guards the system-settings API (`backend/src/core/auth/admin.ts`); admin-only calls need `X-Admin-Token`. The app keeps open reads (AI config list without keys, style presets) and `/settings/*` user prefs
- The full list of environment variables is in the README ("环境变量" section)
- `PUBLIC_BASE_URL`: Seedance needs a public address to reference local assets

## Agent skills

### Issue tracker

Issues live in GitHub Issues on the monorepo `kimyohant/NAKA-AI` (via the `gh` CLI; older issues remain on `kimyohant/naka-drama-studio`). See `docs/agents/issue-tracker.md`.

### Triage labels

Default five-label vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

<!-- OPENWIKI:START -->

## OpenWiki

@AGENTS.md

<!-- OPENWIKI:END -->
