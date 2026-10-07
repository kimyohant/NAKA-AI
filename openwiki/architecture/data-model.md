---
type: architecture
title: D1 Data Model and Migrations
description: How naka-ai stores state in Cloudflare D1 — the legacy LINE-bot schema.sql versus the numbered migrations/ files, the tables each feature area owns, and the rule to migrate before deploying dependent code.
tags: [d1, migrations, schema, persistence]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-6766b7a0c14857435d2077c9
    resource: repo://.github/workflows/deploy.yml
  - id: openwiki-source-fba11782efb4673b1889808b
    resource: repo://schema.sql
  - id: openwiki-source-32dc54ef9e1883cd16ba16f4
    resource: repo://tests/helpers/d1.cjs
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# D1 Data Model and Migrations

All persistent state is in one D1 database bound as `DB`. There are two schema sources and they must not be confused.

## Legacy schema vs. migrations

- `schema.sql` (applied by `db:local` / `db:remote`) is the **legacy LINE-bot schema**: `products`, `orders`, `conversations` (LINE history JSON plus `human_mode` / `handoff_reason`), and `settings` seeded with sample shop data. It is consumed by `src/db.ts`, `src/agent.ts` and the admin REST endpoints in `src/index.ts`.
- Everything newer lives in `migrations/NNNN_*.sql` (0001–0018), applied with `wrangler d1 migrations apply`. Migrations must be applied **before** deploying code that depends on them; `.github/workflows/deploy.yml` runs typecheck and tests, then applies migrations, then deploys (`docs/DEPLOY.md` also documents D1 time-travel restore for a bad migration).

## Tables by area

| Area | Migration(s) | Tables |
| --- | --- | --- |
| Auth | 0001, 0011, 0012, 0013, 0018 | `users`, `auth_identities`, `sessions`, `otp_codes`, `auth_otp_requests`, `auth_oauth_states`, `auth_passwords`, `auth_password_attempts`, `auth_password_resets`, `studio_sso_codes` |
| Credits / jobs | 0002, 0004, 0006 | `plans`, `subscriptions`, `credit_ledger`, `jobs` |
| Social | 0003 | `social_accounts`, `social_media`, `social_oauth_states`, `scheduled_posts` |
| Inbox | 0005 | `inbox_settings`, `inbox_kb`, `inbox_threads`, `inbox_messages`, `inbox_webhook_receipts` |
| Payments | 0007, 0010 | `payments` (rebuilt with a backup table in a later migration) |
| Receipts | 0008 | `receipts` |
| Admin / system | 0009, 0014, 0015 | `admin_audit`, `system_settings`, `system_audit` |
| Marketer / video | 0016, 0017 | `trending_videos`, `marketer_media`, `ai_videos` |

## Design points

<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Append-only ledger.** `credit_ledger` has a unique index on `(job_id, reason)` (`idx_ledger_job_reason`), which is what lets a job's hold and refund each be written at most once. See [Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md).
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
- **Settings in D1.** `system_settings` holds admin-saved overrides that `withSettings` merges over wrangler vars on every request. See [Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md).
- **Table rebuilds.** Some migrations change constraints by creating a `_new` table and copying (e.g. `auth_identities_new`, `admin_audit_new`, `payments`), because SQLite cannot alter constraints in place.
- **Admin fixture.** `src/admin/local-fixture.sql` seeds local data for the admin UI.

## Testing the schema

<!-- openwiki: broken internal link [/openwiki/testing/test-suite.md] link "/openwiki/testing/test-suite.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Tests build a fresh in-memory `node:sqlite` database from the listed migration files (`migratedDb(...)` in `tests/helpers/d1.cjs`) and wrap it in a minimal `D1Database` shim whose `batch` runs inside `BEGIN`/`COMMIT` with `ROLLBACK` on error, mirroring D1's atomic batch. See [Test Suite](/openwiki/testing/test-suite.md).
