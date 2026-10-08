---
type: architecture
title: Backend Server
description: The Hono server entrypoint — optional Basic auth, route mounting under /api/v1, static file serving, data-root resolution, uniform response/error helpers, and the startup sweeps that recover work interrupted by a restart.
tags: [backend, hono, auth, startup, recovery, paths]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-2a2dfd1bcd8735843534fafd
    resource: repo://backend/src/index.ts
  - id: openwiki-source-ba3747343d534414568f04e5
    resource: repo://backend/src/utils/paths.ts
  - id: openwiki-source-70ea3198f3851f7314fdff1c
    resource: repo://backend/src/utils/response.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Backend Server

`backend/src/index.ts` is the single entrypoint (run with `tsx`, or bundled by esbuild for the desktop app). It builds one Hono `app`, mounts an `api` sub-app at `/api/v1`, serves static files, runs recovery sweeps, and only then calls `serve()`.

## Authentication and network exposure

- `NAKA_HOST` defaults to `127.0.0.1`. If it is set to a non-loopback host and `NAKA_AUTH_PASSWORD` is empty, startup **throws** — a network-exposed server must have a password.
- When a password is set, a global middleware requires HTTP Basic auth (`NAKA_AUTH_USER`, default `admin`), compared with `timingSafeEqual`. `/api/v1/health` and `OPTIONS` requests are exempt. With no password (the loopback default, used by the desktop app) auth is skipped entirely.
- CORS allows only `http://localhost:3013` (Nuxt dev) and `http://localhost:5679`.
- `/api/v1/health` returns `status`, `NAKA_VERSION` and a timestamp; the desktop main process polls it and the server-update flow uses the version.

## Routing

`api.route(...)` mounts one Hono router per domain: dramas, episodes, storyboards, scenes, characters, props, tasks, upload, ai-configs / ai-providers, style-presets, prompts, agent, merge, skills, storage, settings, campaigns, trending-videos, gallery, studio, clone, live, seller and server-update. Handlers live in `backend/src/routes/` and delegate to `backend/src/services/`.

## Static serving

- `/static/*` serves `DATA_ROOT`. Generated media is uuid-named and never changes, so responses get `Cache-Control: public, max-age=31536000, immutable`.
- Everything else serves the built frontend from `FRONTEND_DIST` (injected by the desktop app) or `frontend/dist`, with `index.html` as the SPA fallback.

## Data roots

`utils/paths.ts` is the only place that decides where data lives. `DATA_ROOT` is `NAKA_DATA_DIR` if set (the Electron main process injects a userData directory), otherwise the parent of `STORAGE_PATH`, otherwise the repo-level `data/`. `STORAGE_ROOT` is `STORAGE_PATH` or `DATA_ROOT/static`. Note that the code reads `NAKA_DATA_DIR`; older docs mention other variable names.

## Responses and errors

`utils/response.ts` wraps JSON as `{code, data, message}` (`success`, `created`, `badRequest`, `notFound`, `serverError`). `AppError` carries a stable `errorCode` (for example `E_NO_TEXT_MODEL`) that routes pass through `badRequest`, so the frontend can show a localized message from `errors.codes.<code>`. `middleware/logger.ts` supplies `requestLogger` and a global `errorHandler` that logs the stack and returns `{code, message}` with the error's status (default 500).

## Startup recovery

In-flight work lives in background promises, so a restart orphans it. Before listening, `index.ts` runs these sweeps, each in its own try/catch so one failure never blocks boot:

1. `recoverGenerationTasks` — re-attach or resume image/video `sys_task` rows (see [Media Generation](../workflows/media-generation.md)).
2. `failStaleRunningTasks` — fail interrupted agent pipeline tasks.
3. `failStaleCampaigns`, `failStaleStudioProjects`, `failStaleCloneAnalyzes` — mark `*ing` states as failed.
4. `resumeStaleAutoRenders`, `resumeSellerVideos`, `resumeStaleCloneRenders` — continue pipelines whose provider tasks were already recovered (ordering matters: auto-render resumes before seller videos, which depend on it).

See also [Database](database.md) and [Desktop App](desktop-app.md).
