# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The NAKA-AI monorepo. Two apps that used to live in separate repos, merged with full history (`git subtree`, 2026-10):

| Path | Was | What it is | Runs on |
|---|---|---|---|
| `apps/landing/` | `kimyohant/naka-ai-landing` | naka-ai.com: public landing, accounts/auth, credits, Stripe billing, receipts, social, inbox, admin. The **account hub** | Worker code on Node in Docker, PostgreSQL schema `account` |
| `apps/studio/` | `kimyohant/naka-drama-studio` | NAKA Studio: the AI production engine (Drama, Marketer, Seller, Product Studio, Viral Clone, Live). Hono backend + Nuxt frontend + Nuxt admin | Docker (service `studio` in the root `docker-compose.yml`) |

Each app keeps its own `package.json`, lockfiles, tests and `CLAUDE.md` — **read the app's own `CLAUDE.md` before working in it**:
- `apps/landing/CLAUDE.md`
- `apps/studio/CLAUDE.md`

There is no shared workspace install: run `npm ci` inside the app (or sub-app: `apps/studio/{backend,frontend,admin}`) you work on.

## How the two apps connect

Members sign in on naka-ai.com; the studio redeems a one-time code from the Worker (SSO). Worker side `apps/landing/src/auth/studio.ts`, studio side `apps/studio/backend/src/auth/naka-sso.ts`, doc `apps/landing/docs/studio-sso.md`. `apps/studio/backend/tests/naka-sso.test.ts` checks the contract against the Worker source in this checkout — change both sides together.

## Commands (from the repo root)

```bash
npm run db:up              # the shared PostgreSQL (Docker)
npm run dev:landing        # landing on 127.0.0.1:8788 (needs apps/landing/.env)
npm run test:landing       # node --test (PostgreSQL in-process via PGlite; no Docker needed)
npm run dev:studio         # studio backend on :5679
npm run dev:studio-web     # studio frontend on :3013
```

CI: `.github/workflows/landing-ci.yml` (with a PostgreSQL service), `studio-ci.yml` and `db-ci.yml` run only when their files change. Deploy: `docker compose up -d --build` at the root (postgres + landing + studio; one app: `docker compose up -d --build studio`). The Cloudflare Worker deploy was retired with D1.

## Shared database (docs/adr/0004)

One PostgreSQL 17 (`docker-compose.yml` at the root, `npm run db:up`) for both apps, one schema per owner: `account` (landing, role `account_app`), `studio` (studio, role `studio_app`), `reporting` (read-only views, `reporting_ro`). Each role's `search_path` is its own schema, so unqualified table names keep working; an app can't read or write the other schema except through views/`SECURITY DEFINER` functions the owner grants. Layout: `infra/postgres/init/` (runs once on an empty volume); permissions are tested with `npm run test:db` (PGlite, no Docker). No RabbitMQ/Redis: queues live in Postgres. Member features (which menus/quotas a plan gives, per-member admin overrides) live in `account` and are read by both apps through SQL functions: `docs/entitlements.md`. Status: Phase 0 (database), Phase 1 (landing) and Phase 2 (studio, `apps/studio/backend/migrations/pg/`) done; both apps' tests run on PGlite. Next: Phase 3 (credit functions, `studio.users` → view, queues on Postgres).

## Architecture decisions

`docs/adr/` — 0001 (merge + service boundaries), 0002 (Docker-only platform on the owner's host), 0003 (studio split into per-menu modules — done), 0004 (shared PostgreSQL, no RabbitMQ/Redis). Check them before restructuring.
