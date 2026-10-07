---
type: quickstart
title: Quickstart
description: Orientation to the naka-ai repository — a Thai-market AI selling platform on one Cloudflare Worker with D1 — with the main commands and a map from common tasks to the right wiki page.
tags: [quickstart, overview, cloudflare-workers, d1, onboarding]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-4c73bc6a0889cb5ec7f5c105
    resource: repo://wrangler.dev.jsonc
  - id: openwiki-source-f1c29df965300759d3c1ff56
    resource: repo://wrangler.jsonc
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# naka-ai Quickstart

naka-ai (naka-ai.com) is a Thai-market AI selling platform. **One Cloudflare Worker** (`src/index.ts`) serves the build-less static front end from `public/` (Workers Assets binding `ASSETS`), all JSON APIs and webhooks, and a per-minute cron. Storage is D1 (`DB`); R2 (`MEDIA`) is bound only in the dev config, so upload routes answer 503 in production. Code is TypeScript under `src/`; docs and UI copy are largely Thai.

## Everyday commands

```bash
npm run dev                  # wrangler dev -c wrangler.dev.jsonc on 127.0.0.1:8788
npm run auth:setup           # generate a local SESSION_SECRET into .dev.vars (copy .dev.vars.example first)
npm run db:migrate:local     # apply migrations/ to the local D1
npm run typecheck            # tsc -p . (src/ only)
npm test                     # node --test (needs Node 24 for node:sqlite)
node --test tests/billing.test.cjs
npm run deploy               # see docs/DEPLOY.md first
```

## Where to look

| If you want to… | Read |
| --- | --- |
<!-- openwiki: broken internal link [/openwiki/architecture/request-routing.md] link "/openwiki/architecture/request-routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Understand how a request is dispatched, add an API prefix, or see which paths skip sessions | [Worker Request Routing](/openwiki/architecture/request-routing.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Add a configurable value or feature flag, or understand the admin settings panel | [Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Add background work, understand credit holds/refunds, or the cron | [Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/data-model.md] link "/openwiki/architecture/data-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Change a table or write a migration | [D1 Data Model and Migrations](/openwiki/architecture/data-model.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/authentication.md] link "/openwiki/workflows/authentication.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Touch sign-in, sessions, admin access or naka-studio SSO | [Authentication and Sessions](/openwiki/workflows/authentication.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/billing-and-receipts.md] link "/openwiki/workflows/billing-and-receipts.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Change plans, Stripe checkout, expiry or receipts | [Billing, Plans and Receipts](/openwiki/workflows/billing-and-receipts.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/ai-marketer-and-video.md] link "/openwiki/workflows/ai-marketer-and-video.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Work on the AI marketer, trending data, studio drafts or AI video providers | [AI Marketer and AI Video](/openwiki/workflows/ai-marketer-and-video.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/social-and-inbox.md] link "/openwiki/workflows/social-and-inbox.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Work on Meta connections, scheduled posts or AI inbox replies | [Social Publishing and Inbox Replies](/openwiki/workflows/social-and-inbox.md) |
<!-- openwiki: broken internal link [/openwiki/workflows/line-sales-agent.md] link "/openwiki/workflows/line-sales-agent.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Touch the original LINE bot or the legacy admin endpoints | [LINE Sales Agent and Admin Back Office](/openwiki/workflows/line-sales-agent.md) |
<!-- openwiki: broken internal link [/openwiki/architecture/frontend.md] link "/openwiki/architecture/frontend.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Edit pages, styles or 3D assets under `public/` | [Static Front End](/openwiki/architecture/frontend.md) |
<!-- openwiki: broken internal link [/openwiki/operations/deployment-and-config.md] link "/openwiki/operations/deployment-and-config.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Configure wrangler, secrets, CI or deploy | [Deployment and Configuration](/openwiki/operations/deployment-and-config.md) |
<!-- openwiki: broken internal link [/openwiki/testing/test-suite.md] link "/openwiki/testing/test-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
| Write or run tests | [Test Suite](/openwiki/testing/test-suite.md) |

## Four things to know first

1. **Only `/api/*` and `/webhook/*` run the Worker first**; everything else is static. Each `src/<area>/index.ts` exports a handler returning `Response | null`.
2. **Settings are layered.** Values saved in `/admin/system/` override wrangler vars on every request; modules just read `env.X`. New keys must be registered in `src/system/registry.ts`.
3. **Paid or slow work goes through the D1 job queue**, which holds credits at enqueue and refunds them exactly once on permanent failure.
4. **UI rules.** Thai-first, white/cobalt identity, no invented proof, prices or integrations (`.ui-craft/brief.md`), and do not mention the retired legacy messaging integration on user-facing pages.

Repository docs for each phase live in `docs/` (for example `docs/DEPLOY.md`, `docs/system-control.md`, `docs/ai-marketer.md`, `docs/security-audit-2026-10.md`); `README.md` top section describes the current public landing, while older sections cover legacy routes.
