---
type: guide
title: Quickstart
description: Orientation for NAKA-AI — what the product is, how the repo is laid out, how to run each part, key environment variables, and a task-to-page routing map for this wiki.
tags: [quickstart, overview, setup, navigation]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-9a7277933ab0110af5cb7cbe
    resource: repo://backend/package.json
  - id: openwiki-source-66cbd5bba5561e9a939541db
    resource: repo://backend/src/db/index.ts
  - id: openwiki-source-2a2dfd1bcd8735843534fafd
    resource: repo://backend/src/index.ts
  - id: openwiki-source-ba3747343d534414568f04e5
    resource: repo://backend/src/utils/paths.ts
  - id: openwiki-source-24f77a48f966a05631988d08
    resource: repo://desktop/package.json
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Quickstart

NAKA-AI is an all-in-one production tool for AI short dramas and motion comics, plus a product-marketing suite built on the same engine. The core flow is novel → script rewrite → asset extraction → image generation → storyboard breakdown → video generation → FFmpeg merge and export. It is a full TypeScript stack shipped two ways: an Electron desktop app (macOS and Windows) and a Docker/server deployment.

## Repository map

| Path | What it is |
|---|---|
| `backend/` | Hono HTTP server, Drizzle + better-sqlite3 database, Mastra AI agents, media-generation services |
| `backend/workspace/` | Editable agent prompts (`prompts/`) and skills (`skills/`); the agents' file-system jail |
| `frontend/` | Nuxt 3 SPA (`ssr: false`), views under `app/views/` |
| `desktop/` | Electron main process, esbuild bundling and packaging scripts |
| `study/hypit/` | Vendored Hypit render engine, called as a CLI subprocess by Viral Clone (internal use only) |
| `docker-compose.yml`, `Dockerfile` | Server deployment with Watchtower-based updates |
| `deploy/ai-live/` | GPU-host install for the AI Live avatar service |
| `docs/` | Per-feature planning notes (marketer, studio, seller, viral clone, unsloth, live) |
| `configs/` | Legacy; code does not read it |

## Running

- **Backend** (`cd backend`): `npm run dev` (tsx watch, port 5679), `npm start`, `npm run typecheck`.
- **Frontend** (`cd frontend`): `npm run dev` (port 3013, proxies `/api` and `/static` to 5679); `npm run generate` produces the static site in `.output/public` (use it, not `nuxt build`, for static hosting since `build` emits no `index.html`).
- **Desktop** (`cd desktop`): `npm run dev` bundles the backend and opens Electron; `npm run dist` builds the macOS dmg, `npm run dist:win` the Windows installer. Packaging needs the frontend built first (`npm run build:frontend` at the root, i.e. `generate`), because `prepare-resources.mjs` exits if `index.html` is missing; the root `npm run dist` only forwards to `desktop`'s `dist`.
- **Tests:** there is no `npm test` script; see [Test Suite](testing/test-suite.md).

Useful environment variables (all optional for local dev): `PORT`, `SQLITE_PATH`, `STORAGE_PATH`, `WORKSPACE_PATH`, `FRONTEND_DIST`, `FFMPEG_BIN`/`FFPROBE_BIN`, `PUBLIC_BASE_URL` (Seedance needs a public URL for local assets, which the desktop app cannot provide), `NAKA_HOST`/`NAKA_AUTH_USER`/`NAKA_AUTH_PASSWORD` (mandatory password for non-loopback hosts), and `HYPIT_*` for the Hypit engine. The source reads `NAKA_DATA_DIR` and a default database named `naka.sqlite3`; some README tables and comments still show older names such as `NAKA-AI_DATA_DIR` and `NAKA-AI.sqlite3`, so trust the code. AI provider keys, base URLs and models are **not** environment variables: they live in the `ai_service_configs` table and are edited on the Settings page.

## Where to look for a task

| If you need to… | Read |
|---|---|
| Understand server startup, auth, routes, static serving, restart recovery | [Backend Server](architecture/backend-server.md) |
| Change tables, add a column/migration, back up or import data | [Database](architecture/database.md) |
| Touch prompts, skills, model selection, relay-provider quirks, language output | [AI Agents](architecture/ai-agents.md) |
| Work on the Nuxt app, routing, the API client, i18n | [Frontend](architecture/frontend.md) |
| Change Electron boot, userData, storage migration, updater, packaging | [Desktop App](architecture/desktop-app.md) |
| Follow an episode from script to merged video; extraction, readiness, export health | [Drama Pipeline](workflows/drama-pipeline.md) |
| Add an image/video provider, change queueing, budgets, task recovery | [Media Generation](workflows/media-generation.md) |
| Work on Marketer, Studio, Seller, Skills Library, trending, AI Live | [Marketing Suite](workflows/marketing-suite.md) |
| Work on Viral Clone, Hypit, or captions | [Viral Clone](workflows/viral-clone.md) |
| Deploy with Docker, configure Watchtower updates, fetch user URLs safely | [Server Update and Security](operations/server-update.md) |
| Write or run tests | [Test Suite](testing/test-suite.md) |

## Cross-cutting conventions

- **Long jobs are background promises with DB state.** Agent jobs use `pipeline_tasks`, media jobs use `sys_task`, and both are recovered or failed at boot, so state survives restarts.
- **Errors carry stable codes** (`AppError.errorCode`, for example `E_NO_TEXT_MODEL`) that the frontend maps to localized text; message strings are fallback only.
- **Cooperative cancellation:** long loops check a `cancel_requested` flag between steps; an in-flight provider or agent call is not interrupted.
- **Schema changes** require a versioned migration plus the matching Drizzle definition and test expectation (see [Database](architecture/database.md)).
- **Prompt/skill text is user-editable data**, copied once into the desktop userData directory; language directives in code override stale copies.
