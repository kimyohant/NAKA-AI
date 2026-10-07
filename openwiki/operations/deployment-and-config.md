---
type: operations
title: Deployment and Configuration
description: How naka-ai is configured and shipped — production vs. dev wrangler configs, bindings, secrets and vars, local setup, and the CI and manual deploy workflows with migration ordering.
tags: [deployment, wrangler, cloudflare, ci, secrets, operations]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-6c45bbce18be327062154e99
    resource: repo://.dev.vars.example
  - id: openwiki-source-164e2da859b5277df81c7d94
    resource: repo://.github/workflows/ci.yml
  - id: openwiki-source-6766b7a0c14857435d2077c9
    resource: repo://.github/workflows/deploy.yml
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4c73bc6a0889cb5ec7f5c105
    resource: repo://wrangler.dev.jsonc
  - id: openwiki-source-f1c29df965300759d3c1ff56
    resource: repo://wrangler.jsonc
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Deployment and Configuration

The full production runbook (Thai) is `docs/DEPLOY.md`; this page summarises the structure.

## Two wrangler configs

| | `wrangler.jsonc` (production) | `wrangler.dev.jsonc` (`npm run dev`) |
| --- | --- | --- |
| Routes | `naka-ai.com` and `www.naka-ai.com` as custom domains | none (custom-domain routes make `wrangler dev` rewrite requests to the live site and break the auth origin check) |
| `workers_dev` | `false` — no second `*.workers.dev` origin (security audit note) | `true` |
| R2 `MEDIA` | **not bound** — R2 is not enabled, auto-posting is off, upload routes answer 503 | bound to bucket `naka-ai-media` |
| Shared | `main: src/index.ts`, `nodejs_compat`, `ASSETS` (`./public`, `run_worker_first` for `/api/*` and `/webhook/*`), D1 `DB` (`naka-ai-db`), cron `* * * * *`, observability on | same |

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Keep bindings in sync between the two files. Production `vars` hold non-secret values (`APP_ORIGIN`, `SMS_PROVIDER`, receipt seller name/address); secrets go through `wrangler secret put`. Many of these can instead be overridden at runtime from the admin panel — see [Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md). Only keys in the registry are overridable; session and encryption keys stay in wrangler.

## Local development

1. Copy `.dev.vars.example` to `.dev.vars` (Anthropic key, LINE secrets, `ADMIN_TOKEN`, `APP_ORIGIN=http://127.0.0.1:8788`, `SMS_PROVIDER=mock`, optional Google OAuth).
2. `npm run auth:setup` generates a local `SESSION_SECRET` without printing it.
3. `npm run db:migrate:local` applies `migrations/` to the local D1.
4. `npm run dev` serves on `127.0.0.1:8788`.

## CI and deploy

- **CI** (`.github/workflows/ci.yml`): on every push and PR, Node 24 (needed for `node:sqlite`), `npm ci`, `npm run typecheck`, `npm test`.
- **Deploy** (`.github/workflows/deploy.yml`): manual `workflow_dispatch`, only from `main`, in the `production` environment with a `production` concurrency group. It repeats typecheck and tests, then `wrangler d1 migrations apply naka-ai-db --remote`, then `wrangler deploy`. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It deliberately takes no DB dump (that would put customer data in GitHub); D1 Time Travel restores any minute of the last 30 days.

## Ordering rule

<!-- openwiki: broken internal link [/openwiki/architecture/data-model.md] link "/openwiki/architecture/data-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Apply migrations **before** deploying code that depends on them (the workflow does this). For features gated behind external setup (Resend email, Stripe, Meta review, R2) the code can ship dark and be switched on later via feature flags or secrets; `docs/DEPLOY.md` and `docs/launch-checklist.md` list the steps. See [D1 Data Model and Migrations](/openwiki/architecture/data-model.md).
