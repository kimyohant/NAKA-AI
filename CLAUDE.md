# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The NAKA-AI monorepo. Two apps that used to live in separate repos, merged with full history (`git subtree`, 2026-10):

| Path | Was | What it is | Runs on |
|---|---|---|---|
| `apps/landing/` | `kimyohant/naka-ai-landing` | naka-ai.com: public landing, accounts/auth, credits, Stripe billing, receipts, social, inbox, admin. The **account hub** | Cloudflare Worker + D1 (`wrangler`) |
| `apps/studio/` | `kimyohant/naka-drama-studio` | NAKA Studio: the AI production engine (Drama, Marketer, Seller, Product Studio, Viral Clone, Live). Hono backend + Nuxt frontend + Nuxt admin | Docker (`apps/studio/docker-compose.yml`) |

Each app keeps its own `package.json`, lockfiles, tests and `CLAUDE.md` — **read the app's own `CLAUDE.md` before working in it**:
- `apps/landing/CLAUDE.md`
- `apps/studio/CLAUDE.md`

There is no shared workspace install: run `npm ci` inside the app (or sub-app: `apps/studio/{backend,frontend,admin}`) you work on.

## How the two apps connect

Members sign in on naka-ai.com; the studio redeems a one-time code from the Worker (SSO). Worker side `apps/landing/src/auth/studio.ts`, studio side `apps/studio/backend/src/auth/naka-sso.ts`, doc `apps/landing/docs/studio-sso.md`. `apps/studio/backend/tests/naka-sso.test.ts` checks the contract against the Worker source in this checkout — change both sides together.

## Commands (from the repo root)

```bash
npm run dev:landing        # wrangler dev on 127.0.0.1:8788
npm run test:landing       # node --test (Node 24: tests use node:sqlite)
npm run dev:studio         # studio backend on :5679
npm run dev:studio-web     # studio frontend on :3013
npm run dev:studio-admin   # studio admin on :3014/admin/
```

CI: `.github/workflows/landing-ci.yml` and `studio-ci.yml` run only when their app's files change. Landing production deploy is manual (`landing-deploy.yml`). Studio deploys with `docker compose up -d --build` from `apps/studio/`.

## Architecture decisions

`docs/adr/` — 0001 (merge + service boundaries), 0002 (possible Docker-only platform, not adopted yet), 0003 (planned split of the studio into per-menu modules). Check them before restructuring.
