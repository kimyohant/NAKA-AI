---
type: architecture
title: Database
description: SQLite persistence via better-sqlite3 and Drizzle — connection settings, idempotent DDL replay plus versioned column migrations, seeded style presets, consistent backups, and the one-time MySQL import.
tags: [database, sqlite, drizzle, migrations, backup, mysql]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-530eb91f202678e6a9dd95c2
    resource: repo://backend/src/db/backup.ts
  - id: openwiki-source-66cbd5bba5561e9a939541db
    resource: repo://backend/src/db/index.ts
  - id: openwiki-source-87d1514ba6bb9de52a2dd8a4
    resource: repo://backend/src/db/mysql-import.ts
  - id: openwiki-source-f3a96564b8a94aafc154d2bd
    resource: repo://backend/src/db/sqlite-schema.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Database

The whole product stores state in a single SQLite file. `backend/src/db/index.ts` opens it, applies schema, optionally imports legacy MySQL data, and exports the Drizzle `db`, the `schema` namespace and `getInsertId`.

## Connection

- Path: `SQLITE_PATH` if set (the desktop app injects one under userData), otherwise `data/naka.sqlite3` in the repo. The filename is the post-rebrand name.
- Pragmas: `journal_mode = WAL`, `busy_timeout = 5000`, `synchronous = NORMAL`, so polling of generation tasks and page reads do not block each other.
- `getInsertId` converts better-sqlite3's possibly-`bigint` `lastInsertRowid` to a number and throws if it is missing.
- The module runs `initDb()` and awaits the MySQL auto-import at import time, so any module importing `db` sees a ready schema.

## Two schema definitions

- **DDL** lives in `db/sqlite-schema.ts` as `sqliteSchemaStatements` (`CREATE TABLE IF NOT EXISTS ...`). It is the runtime source of truth.
- **Drizzle table definitions** in `db/schema.ts` (sqlite-core) give typed queries. They must be kept in step with the DDL by hand; nothing generates one from the other.

Tables cover the drama core (`dramas`, `episodes`, `characters`, `scenes`, `props`, `storyboards` and their join tables such as `episode_characters`, `storyboard_props`), configuration (`ai_service_configs`, `ai_service_providers`, `style_presets`, `app_settings`), job state (`sys_task` for media generation, `pipeline_tasks` for agent runs, `video_merges`), and product areas (`campaigns*`, `studio_*`, `clone_*`, `seller_posts`, `creative_results`, `character_looks`, `storyboard_media_selections`).

## Startup migration

`initSqliteSchema` is idempotent and safe on every boot:

1. Replay every `CREATE TABLE IF NOT EXISTS` statement.
2. Create `schema_migrations(version, applied_at)`.
3. In one transaction, for each entry in `MIGRATIONS` not yet recorded: add each listed column via `ALTER TABLE` only if `PRAGMA table_info` shows it missing, run any extra statements, then record the version. The latest version in this file is 19 (seller video columns).
4. Seed `style_presets`: insert missing presets by `value`; upgrade a seeded row to the new structured prompt only if its stored prompt still equals the known legacy seed text (so user edits from Settings are never overwritten); delete retired presets only when their prompt is still the untouched seed.

To add a column, append a migration with a new version number; do not edit the `CREATE TABLE` alone, because existing databases will not get the column.

## Backups

`backupSqlite(source, destination)` in `db/backup.ts` produces a consistent snapshot including committed WAL data. It refuses identical paths, a missing source or an existing destination, runs `integrity_check` on the source, writes through better-sqlite3's online `backup` to a `.partial` temp file, integrity-checks the snapshot, then renames it into place and cleans the temp file on failure. `scripts/sqlite-snapshot.ts` is the CLI front end.

## MySQL import

Earlier deployments used MySQL. `db/mysql-import.ts` shares one core between the startup auto-import and `scripts/import-mysql-to-sqlite.ts`. Auto-import only runs when all hold: `MYSQL_AUTO_IMPORT` is not `false`; MySQL is explicitly configured (`DATABASE_URL` or `MYSQL_HOST`, defaults alone do not count); SQLite business tables are empty (seeded presets excluded); and no `<db>.mysql-imported` marker exists. It reads all tables into memory, backs up any existing file to `<db>.bak-<timestamp>`, writes in a single SQLite transaction with per-table row-count verification, and writes the marker on success (or when the MySQL side is empty). An unreachable MySQL or a failed import never blocks boot; it rolls back and retries next start.

Related: [Backend Server](backend-server.md) (startup order) and [Test Suite](../testing/test-suite.md) (`sqlite-migration-backup.test.ts`).
