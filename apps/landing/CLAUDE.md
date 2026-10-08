# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

naka-ai: a Thai-market AI selling platform (naka-ai.com). The app is written as one Cloudflare Worker (`src/index.ts`: the JSON APIs, webhooks and a per-minute cron, with the static front end in `public/`, no build step) and **runs on Node in Docker** (since 2026-10, docs/adr/0004): `server/node.ts` gives the unchanged Worker its bindings — `env.DB` is the D1 API on **PostgreSQL** (`src/db/pg-d1.ts` + `server/postgres.ts`, schema `account` of the shared database), `env.ASSETS` serves `public/` from disk (`server/assets.ts`), `env.MEDIA` is an R2 stand-in on a directory when `MEDIA_DIR` is set (`server/media.ts`), and the cron runs every minute in-process. Docs and UI copy are largely Thai.

## Commands

```bash
npm run db:up               # (repo root) the shared PostgreSQL in Docker
cp .env.example .env        # DATABASE_URL etc.; npm run auth:setup adds a SESSION_SECRET
npm run dev                 # tsx watch server/node.ts on 127.0.0.1:8788 (applies migrations/pg at start)
npm run typecheck           # src/ (Workers types) + server/ (Node types)
npm test                    # node --test over tests/ and src/{auth,social,inbox}/tests — PostgreSQL in-process (PGlite)
npm run test:pg             # tests/postgres.integration.test.cjs — needs TEST_DATABASE_URL (a real server)
node --test tests/billing.test.cjs     # single test file
docker compose up -d --build           # (repo root) postgres + landing; secrets in apps/landing/.env.production
```

**Database** — schema `migrations/pg/NNNN_*.sql` (0001 = the D1 schema after the old SQLite `migrations/0001…0018` + `schema.sql`, which stay only as history). `server/migrate.ts` applies new files at start, once each, under an advisory lock. Write SQL as before (SQLite-flavoured `?`/`?N`); `translate()` in `src/db/pg-d1.ts` converts placeholders (with typed casts), quotes camelCase aliases, turns `INSERT OR IGNORE` into `ON CONFLICT DO NOTHING` and reports `last_row_id`; the baseline defines `datetime()`, `json_extract()`, `json_valid()`, `instr()`, `unixepoch()`. Things that do **not** carry over: scalar `MIN/MAX(a,b)` (use `LEAST/GREATEST`), integers as booleans (`?N = 1`), `IS ?` (`IS NOT DISTINCT FROM`), `changes()`, `PRAGMA`, `sqlite_master`, `printf`, an untyped `? IS NULL` (`?::text IS NULL`), bare column names inside `ON CONFLICT DO UPDATE` (qualify them). **Writes are serialized like D1**: every write statement/batch takes one advisory lock first, because quota and balance checks are written as single `INSERT … SELECT … WHERE count < limit` statements. Results come back as D1 did: bigint/numeric → number, boolean → 1/0.

**Shared database objects** — `migrations/pg/0002_shared.sql` is what other apps may use from schema `account` (docs/adr/0004 phase 3); everything else stays closed to them. `studio_app` gets EXECUTE on `hold_credits(user, amount, ref) → (ok, hold_id, balance)`, `commit_hold(hold_id)` and `refund_hold(hold_id)` (SECURITY DEFINER, both return the hold's status `'committed'`/`'refunded'`) and SELECT on `users_public` (id, display_name, status, created_at); `reporting_ro` gets SELECT on `users_public`. Studio holds are ledger rows with reason `studio_hold`/`studio_refund` (job_id = the studio's ref) plus a state row in `credit_holds` (held → committed | refunded, once), so `getBalance` (SUM(delta)) covers them unchanged. `hold_credits` takes the adapter's write lock (`WRITE_LOCK_KEY`, 72040002) until the caller's transaction ends — a per-user lock would race the landing's own balance checks; if that key ever changes, the functions need a migration that changes it with them. The migration never names its schema and skips grants to roles that don't exist, so it runs in the test databases. Cross-app reporting views (`reporting.revenue_by_day`, `credits_used_by_user`, `active_subscriptions`) are superuser-owned, in `infra/postgres/init/03-reporting.sql`: re-run it after migrations that change the tables they read. Permissions are tested in `infra/postgres/tests/credits.test.mjs` (`npm run test:db` at the root).

**Tests** — `tests/helpers/d1.cjs`: `migratedDb()` gives `{ db, sqlite }` on a fresh schema (every `migrations/pg` file); `db` is the real adapter, `sqlite` a synchronous handle (`prepare().get/all/run`, `exec`, `failTrigger()`) backed by PGlite in a worker thread. `PG_DEBUG=1` prints failing SQL. CI also runs the integration tests against a PostgreSQL service.

## Architecture

**Routing** — `src/index.ts` `fetch` is a linear chain: `withSettings` → www→APP_ORIGIN redirect → `closedFeature` (feature-switch 503s) → studio SSO → `handleAuth` → per-prefix handlers (`/api/social`, `/api/marketer`, `/api/inbox`, `/api/billing`, `/api/receipts`, `/api/works`, `/api/onboarding`, `/api/affiliate`, `/webhook/{line,meta,stripe}`, `/api/admin/*`) → fall through to `env.ASSETS.fetch`. Only `/api/*` and `/webhook/*` hit the Worker first (`run_worker_first`); everything else is served as static files. Each `src/<area>/index.ts` exports a `handleX(request, env, url, …)` that returns `null`/`Response`. State-changing session requests are checked against `Origin`.

**Runtime settings overlay** — `withSettings(env)` (`src/system/store.ts`) runs on every request and cron tick, merging values saved in `/admin/system/` (`system_settings`, API keys AES-GCM encrypted with `SETTINGS_KEY`) over wrangler vars/secrets. Modules just read `env.X`. Only keys listed in `src/system/registry.ts` are editable this way; feature switches are read with `featureOn(env, "FEATURE_…")`. Adding a new configurable value or feature flag means registering it there. See `docs/system-control.md`.

**Job queue** — `src/jobs.ts` is a database-backed queue drained by the cron (`scheduled` → `runQueue`, 30 jobs / 5 concurrent). Credits are held at `enqueueJob` and refunded exactly once on permanent failure; jobs use leases with fencing. Handlers are registered by `kind` in `jobHandlers(env)` (affiliate, inbox replies, marketer tasks, AI video…); throw `PermanentJobError` to fail without retry, `JobDeferredError` to retry later. `src/credits.ts` owns balances/ledger/plans.

**Cron** — one `* * * * *` trigger fans out in `scheduled`: queue run, social publishing, billing (expiry + monthly credit top-up), receipt backfill, inbox drain, and hourly (minute 7) trending sync. Each piece is its own `ctx.waitUntil` so one failing config can't stop the others.

**Auth** — `src/auth/` (Google, LINE Login, phone OTP via SMS provider, email+password, reset, Turnstile, `studio.ts` SSO for naka-studio). Customer sessions last 30 days; admin access (`src/admin/auth.ts`) requires a Google account in `ADMIN_EMAILS`, re-login every 12 h, with `ADMIN_TOKEN` as an emergency fallback. Use `requireUser(request, env)` in handlers.

**Feature areas** (each has a `docs/phaseN-*.md` / `*-integration-status.md`): `agent.ts`+`line.ts` (original Claude sales agent on LINE OA), `studio.ts` (content draft API), `marketer/` (AI marketer, `docs/ai-marketer.md`), `video/` (pluggable AI-video providers), `social/` (Meta OAuth + scheduled posting), `inbox/` (Meta webhook → AI replies), `billing/` (Stripe), `receipts/`, `works/`, `onboarding/`, `admin/customers`.

**Front end** — plain HTML/CSS/JS under `public/` (`index.html` landing, `create/`, `studio/`, `app/`, `admin/`, `login/`, `legal/`). Design direction (white/cobalt naga identity, Thai-first, no invented proof/prices/integrations) is in `.ui-craft/brief.md` and `.ui-craft/tokens.md` — read before UI changes. `creative/` holds Blender/Godot/video sources for the landing's 3D/animated assets (rebuilt with `npm run world:postprocess` after Godot export; see README) and is not part of the Worker.

## Testing notes

Tests are `node:test` `.cjs` files that import the TS-free logic through the Worker's modules and use `tests/helpers/d1.cjs`, a minimal `D1Database` shim over `node:sqlite` (with transactional `batch`). Auth/social/inbox keep their tests beside the source in `src/<area>/tests/`.

## Conventions worth knowing

- `README.md` top section describes the *current* public landing; the older sections describe legacy routes still in the checkout.
- Don't mention the retired legacy messaging integration on user-facing pages (per design brief).
- Production config lives in `wrangler.jsonc` (`workers_dev: false`, only naka-ai.com routes); keep bindings in sync with `wrangler.dev.jsonc`.

<!-- OPENWIKI:START -->

## OpenWiki

@AGENTS.md

<!-- OPENWIKI:END -->

## Agent skills

### Issue tracker

Issues live in GitHub Issues on the monorepo `kimyohant/NAKA-AI` (via `gh`; older issues remain on `kimyohant/naka-ai-landing`). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
