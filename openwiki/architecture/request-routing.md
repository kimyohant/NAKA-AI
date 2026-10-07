---
type: architecture
title: Worker Request Routing
description: How the single naka-ai Cloudflare Worker dispatches each request — settings overlay, www redirect, feature closing, studio SSO, auth, per-prefix API handlers, webhooks, the admin API and the static-asset fall-through.
tags: [routing, worker, api, auth, webhooks]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Worker Request Routing

One Worker (`src/index.ts`, `main` in `wrangler.jsonc`) serves everything. Its `fetch` is a **linear chain**: each step either returns a `Response` or falls to the next. Handlers in `src/<area>/index.ts` export `handleX(request, env, url, …)` returning `Response | null`; `null`/missing becomes `404 {"error":"not found"}` at the call site.

## Order of the chain

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
1. **Settings overlay** — `withSettings(workerEnv)` merges admin-saved values over wrangler vars on every request. See [Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md).
2. **www redirect** — requests for `www.<APP_ORIGIN host>` get 301 (GET/HEAD) or 308 to the main origin, because sign-in cookies and CSRF checks belong to `APP_ORIGIN` only.
3. **`closedFeature`** — returns 503 for switched-off features. `FEATURE_MAINTENANCE` closes all `/api/*` except `/api/admin`, `/api/health`, `/api/auth/config`, `/api/auth/logout` and `/api/auth/google*`. `FEATURE_CLIPS` blocks `POST /api/affiliate/reviews`, `FEATURE_SOCIAL` blocks `/api/social` except signed `/api/social/media/*` (Instagram may still be fetching a clip), and `FEATURE_INBOX` blocks `/api/inbox`.
4. **Studio SSO** — `handleStudioSso` runs *before* `handleAuth` because the token exchange is server-to-server (no `Origin`).
<!-- openwiki: broken internal link [/openwiki/workflows/authentication.md] link "/openwiki/workflows/authentication.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
5. **`handleAuth`** — the auth endpoints (see [Authentication and Sessions](/openwiki/workflows/authentication.md)).
6. **Per-prefix handlers**, each calling `requireUser(request, env)` for a session unless noted:
   - `/api/affiliate/*` — also rejects non-GET requests whose `Origin` differs from the Worker's origin (403).
   - `/api/social*` — session required except signed `/api/social/media/*`.
   - `/api/marketer*` — `GET` of `trending`, `image` and `media/*` is public; everything else needs a session. A `kick` closure runs `runQueue` (2 jobs, concurrency 2) under `ctx.waitUntil` so a new task starts immediately.
   - `/api/inbox*`, `/api/billing/*`, `/api/receipts*`, `/api/works`, `/api/onboarding`.
7. **Webhooks** — `/webhook/stripe` (Stripe signature, session re-read from Stripe), `/webhook/meta` (`X-Hub-Signature-256`), `/webhook/line` (POST; `x-line-signature`). None use a session.
8. **Public** — `/api/health`, `/api/plans`, and the `/world/index.wasm` gzip special case.
9. **`/api/admin/*`** — `checkAdmin` accepts a Google account in `ADMIN_EMAILS` signed in within 12 h, or the `ADMIN_TOKEN` break-glass. Then in order: `/api/admin/me`, `/api/admin/studio`, system settings (given the *unmerged* `workerEnv` so the panel can tell saved values from wrangler ones), marketer admin, customer admin, and finally the legacy `handleAdmin` REST handlers (products, orders, shop settings, LINE conversations, manual credit grants, test chat). Errors become a generic 500 logged via `errorSummary`.
<!-- openwiki: broken internal link [/openwiki/architecture/frontend.md] link "/openwiki/architecture/frontend.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
10. **Fall-through** — `env.ASSETS.fetch(request)` serves `public/`. See [Static Front End](/openwiki/architecture/frontend.md).

## Conventions and invariants

- State-changing session requests are checked against `Origin`; webhooks and the SSO exchange are the deliberate exceptions, authenticated by signature or secret instead.
- `wrangler.jsonc` sends only `/api/*` and `/webhook/*` through the Worker first; all other paths hit static assets without running code.
- User-facing errors are Thai strings (for example `กรุณาเข้าสู่ระบบ` for 401); admin responses add `Cache-Control: no-store`.
<!-- openwiki: broken internal link [/openwiki/workflows/line-sales-agent.md] link "/openwiki/workflows/line-sales-agent.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- LINE webhook bodies are read through `readBodyBytes` with a 256 KiB cap (413 if larger), signature-verified, and acknowledged immediately while events are handled in `ctx.waitUntil`. See [LINE Sales Agent and Admin Back Office](/openwiki/workflows/line-sales-agent.md).
<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- The same module also exports `scheduled` (cron) and `jobHandlers(env)`. See [Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md).

## Adding a route

Create `handleX` in a new `src/<area>/index.ts`, add a prefix branch in `fetch` (apply `requireUser` and the `Origin` check as needed), and gate it with `featureOn` in `closedFeature` if it should be switchable.
