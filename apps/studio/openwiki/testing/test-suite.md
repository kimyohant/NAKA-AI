---
type: testing
title: Test Suite
description: How the backend tests under backend/tests are organized — node:test unit tests, source-text "structure" tests, and child-process scenario tests on isolated SQLite files — and what each style guards.
tags: [testing, node-test, tsx, sqlite, scenarios, structure-tests]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-9a7277933ab0110af5cb7cbe
    resource: repo://backend/package.json
  - id: openwiki-source-479fc0219583cf8cd138741b
    resource: repo://backend/tests/production-guards-scenario.ts
  - id: openwiki-source-9c06e54983c2b79780630608
    resource: repo://backend/tests/production-guards.test.ts
  - id: openwiki-source-9bd77c6ff7398a809d1a9909
    resource: repo://backend/tests/sqlite-migration-backup.test.ts
  - id: openwiki-source-4467b2bb7397dca293df7afe
    resource: repo://backend/tests/studio-backend-structure.test.mjs
  - id: openwiki-source-60f80676a2a47ccf5659a847
    resource: repo://backend/tests/unsloth-queue.test.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Test Suite

Automated tests live in `backend/tests/` (about 50 files) and `frontend/tests/` (27 files, mostly `*-structure.test.mjs` plus a few such as `video-preflight.test.mjs` that import the pure helpers in `frontend/app/utils/*.js`). They use Node's built-in runner (`node:test` + `node:assert/strict`) rather than a framework; `frontend/package.json` has no test script either. The desktop package has no tests. The rest of this page describes the backend suite; the frontend structure tests follow the same source-text pattern described below.

## Running

`backend/package.json` defines no `test` script; the only checks it ships are `npm run typecheck` (`tsc --noEmit`) and the dev/start scripts. Run a file directly from `backend/` with Node's runner, loading `tsx` for TypeScript files, for example `node --import tsx --test tests/seller.test.ts` (`.test.mjs` files need no loader). This invocation is inferred from the dependencies and test code, not from a documented script. Tests that touch the database must not run against a real data file; see the isolation pattern below.

## Three styles

### 1. Unit tests (`*.test.ts`)

Import real modules and call them in-process: `seller.test.ts`, `gallery.test.ts`, `trending.test.ts`, `ai-live.test.ts`, `live-avatars.test.ts`, `style-gallery.test.ts`, adapter tests such as `aliyun-wan3-video.test.ts` and `unsloth-video-adapter.test.ts`, and security checks such as `safe-fetch` coverage inside `campaigns-migration.test.ts` (`isBlockedAddress`, `assertPublicHttpUrl`, see [Server Update and Security](../operations/server-update.md)).

Database-schema tests build their own database. `sqlite-migration-backup.test.ts` creates a temp WAL database, runs `initSqliteSchema`, deliberately drops columns and a `schema_migrations` row, re-runs it twice, and asserts migrations 1–19 are recorded exactly once with the columns restored. It then snapshots with `backupSqlite`, restores from the snapshot, checks row contents, and asserts a second backup to an existing destination is rejected. Adding a migration therefore requires updating the expected version list in this test. See [Database](../architecture/database.md).

### 2. Structure tests (`*-structure.test.mjs`)

Many files (for example `studio-backend-structure.test.mjs`, `clone-structure.test.mjs`, `campaigns-structure.test.mjs`, `final-prompt-structure.test.mjs`, `remove-*-structure.test.mjs`) read source files as text and assert with regexes that routes, tool registrations or code fragments exist, or that removed features stay removed. They run fast and need no database, but they pin source *shape*: a harmless refactor of a route declaration can fail them, and they do not prove runtime behavior. When changing such a file, update the matching structure test deliberately.

### 3. Scenario tests (wrapper + `*-scenario.ts`)

For code that imports `db`, the wrapper test (`production-guards.test.ts`, `unsloth-queue.test.ts`, `skill-library.test.ts`) spawns a **child process** running `tsx tests/<name>-scenario.ts` with `SQLITE_PATH` pointing into a fresh temp directory, then asserts exit code 0 and a sentinel line in the output (for example `production guards: passed`) and deletes the directory. A child process is required because `db/index.ts` opens the database and runs migrations at import time (see [Database](../architecture/database.md)), so each scenario needs its own process-level `SQLITE_PATH`.

- `production-guards-scenario.ts` seeds a drama, episode, storyboard and an offline video config, then verifies: a text-only video preflight is rejected with 400 and creates no `sys_task` row; a quote beyond the drama budget fails `validateBudgetQuote` and `generateVideo` before any provider call; source-freshness flips from `current` to `stale` after a prompt edit; and `episodeExportHealth` reports missing or incomplete clip files. This guards the budget, freshness and export-readiness rules of [Media Generation](../workflows/media-generation.md).
- `unsloth-queue-scenario.ts` covers the per-config concurrency gate for providers that declare `maxConcurrent`: gating, recovery after restart, queue timeout, and that Volcengine behavior is unchanged.

## Helpers and manual scripts

`gallery-seed.ts` and `e2e-seed-unsloth-studio.ts` are seed helpers, not tests. Under `backend/scripts/`, `e2e-*.mjs` and `test-*.ts` are manual end-to-end scripts that call real services and are not part of the automated suite.
