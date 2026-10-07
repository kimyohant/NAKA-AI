---
type: testing
title: Test Suite
description: How naka-ai's node:test suite works — compiling the TypeScript Worker modules per test file, the node:sqlite D1 shim with migrations, Miniflare runtime tests, where tests live, and how to run one.
tags: [testing, node-test, sqlite, miniflare, ci]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-5b54a58d1b51cd490b0e7162
    resource: repo://package.json
  - id: openwiki-source-8329dfc89a73d068c0013716
    resource: repo://src/auth/tests/runtime.test.cjs
  - id: openwiki-source-d06ad866d97ba06e1de32a73
    resource: repo://tests/billing.test.cjs
  - id: openwiki-source-32dc54ef9e1883cd16ba16f4
    resource: repo://tests/helpers/d1.cjs
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Test Suite

Tests are plain `node:test` files (`*.test.cjs`) with no test framework. They require **Node 24** because they use `node:sqlite` (CI pins Node 24).

## Running

```bash
npm test                                   # tests/*.test.cjs plus src/{auth,social,inbox}/tests/*.test.cjs
node --test tests/billing.test.cjs         # one file
node --test --test-name-pattern="x" tests/billing.test.cjs   # one test
npm run test:auth                          # auth tests only
npm run typecheck                          # tsc -p . (src/ only; tests are not type-checked)
```

<!-- openwiki: broken internal link [/openwiki/operations/deployment-and-config.md] link "/openwiki/operations/deployment-and-config.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
CI runs typecheck then the full suite on every push and PR (see [Deployment and Configuration](/openwiki/operations/deployment-and-config.md)).

## How tests reach TypeScript code

The test files are CommonJS, but the Worker is TypeScript. Typical tests (for example `tests/billing.test.cjs`, `tests/webhook-body-limits.test.cjs`, `tests/log-scrubbing.test.cjs`) compile `src/` at start-up by spawning the project's `tsc` with `--noEmit false --module node16 --outDir .wrangler/<name>-tests-<pid>`, `require` the emitted JS, and delete the build directory in `after`. External services are mocked at `fetch` (for example Stripe), so no network or money is involved.

Some auth tests (`src/auth/tests/runtime.test.cjs`) instead bundle with `esbuild` and run the Worker inside **Miniflare** (both already installed through the pinned Wrangler) to exercise real Workers runtime behaviour.

## D1 shim and migrations

`tests/helpers/d1.cjs` provides:

- `d1(sqlite)` — a minimal `D1Database` over `node:sqlite`: `prepare().bind().first/all/run` and a `batch` that runs inside `BEGIN`/`COMMIT` and rolls back on error, matching D1's atomic batch.
- `migratedDb(...files)` — a fresh in-memory database with the named `migrations/*.sql` applied, returning `{ sqlite, db }`.

<!-- openwiki: broken internal link [/openwiki/architecture/data-model.md] link "/openwiki/architecture/data-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Each test chooses the migrations it needs, so schema changes are verified by the same SQL that production applies. See [D1 Data Model and Migrations](/openwiki/architecture/data-model.md).

## Coverage map

| Area | Files |
| --- | --- |
| Queue and credits | `job-lease-fencing`, `credits` |
| Billing and receipts | `billing`, `receipts` |
| Auth | `password-login`, `password-reset`, `password-reset-ui`, `password-change`, `line-login`, `sms-gateway`, `studio-sso`, `auth-ui`, `src/auth/tests/*` |
| Admin and settings | `admin-auth`, `admin-customers`, `system-control` |
| Marketer, video, studio | `marketer`, `ai-video`, `studio`, `workflows` |
| Social and inbox | `src/social/tests/*`, `src/inbox/tests/*` |
| Pages and misc | `account-page`, `onboarding`, `works`, `legal`, `affiliate` |
| Security hygiene | `webhook-body-limits` (oversized webhook bodies get 413 before being fully read), `log-scrubbing` (error output carries no customer content) |

Auth, social and inbox keep their tests beside the source under `src/<area>/tests/`.
