# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

naka-ai: a Thai-market AI selling platform (naka-ai.com). One Cloudflare Worker (`src/index.ts`) serves everything: the static front end from `public/` (Workers Assets binding `ASSETS`, no build step), the JSON APIs, webhooks, and a per-minute cron. Storage is D1 (`DB`); R2 (`MEDIA`) is bound only in `wrangler.dev.jsonc` — production leaves it unbound and the upload routes answer 503. Docs and UI copy are largely Thai.

## Commands

```bash
npm run dev                 # wrangler dev -c wrangler.dev.jsonc on 127.0.0.1:8788 (dev config: no custom-domain routes, R2 bound)
npm run auth:setup          # generates a local SESSION_SECRET into .dev.vars (copy .dev.vars.example first)
npm run db:migrate:local    # apply migrations/ to the local D1
npm run typecheck           # tsc -p . (covers src/ only)
npm test                    # node --test over tests/ and src/{auth,social,inbox}/tests
node --test tests/billing.test.cjs     # single test file
node --test --test-name-pattern="x" tests/billing.test.cjs   # single test
npm run deploy              # wrangler deploy (see docs/DEPLOY.md for secrets/migrations order)
```

CI (`.github/workflows/ci.yml`) runs `typecheck` + `test` on Node 24 — tests use `node:sqlite`, so older Node won't work. `schema.sql` (`db:local`/`db:remote`) is the legacy LINE-bot schema; everything newer lives in `migrations/NNNN_*.sql` (apply with `wrangler d1 migrations apply`, and run them *before* deploying code that depends on them).

## Architecture

**Routing** — `src/index.ts` `fetch` is a linear chain: `withSettings` → www→APP_ORIGIN redirect → `closedFeature` (feature-switch 503s) → studio SSO → `handleAuth` → per-prefix handlers (`/api/social`, `/api/marketer`, `/api/inbox`, `/api/billing`, `/api/receipts`, `/api/works`, `/api/onboarding`, `/api/affiliate`, `/webhook/{line,meta,stripe}`, `/api/admin/*`) → fall through to `env.ASSETS.fetch`. Only `/api/*` and `/webhook/*` hit the Worker first (`run_worker_first`); everything else is served as static files. Each `src/<area>/index.ts` exports a `handleX(request, env, url, …)` that returns `null`/`Response`. State-changing session requests are checked against `Origin`.

**Runtime settings overlay** — `withSettings(env)` (`src/system/store.ts`) runs on every request and cron tick, merging values saved in `/admin/system/` (D1 `system_settings`, API keys AES-GCM encrypted with `SETTINGS_KEY`) over wrangler vars/secrets. Modules just read `env.X`. Only keys listed in `src/system/registry.ts` are editable this way; feature switches are read with `featureOn(env, "FEATURE_…")`. Adding a new configurable value or feature flag means registering it there. See `docs/system-control.md`.

**Job queue** — `src/jobs.ts` is a D1-backed queue drained by the cron (`scheduled` → `runQueue`, 30 jobs / 5 concurrent). Credits are held at `enqueueJob` and refunded exactly once on permanent failure; jobs use leases with fencing. Handlers are registered by `kind` in `jobHandlers(env)` (affiliate, inbox replies, marketer tasks, AI video…); throw `PermanentJobError` to fail without retry, `JobDeferredError` to retry later. `src/credits.ts` owns balances/ledger/plans.

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

Issues live in GitHub Issues (`kimyohant/naka-ai-landing`, via `gh`). See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
