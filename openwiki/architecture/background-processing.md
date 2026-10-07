---
type: architecture
title: Job Queue, Credits and Cron
description: How naka-ai runs AI work in the background — a D1-backed job queue with leases and fencing tokens, an append-only credit ledger that holds and refunds credits, and the per-minute cron that fans out to queue, social, billing, receipts, marketer and inbox work.
tags: [jobs, credits, cron, d1, queue]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-00b65815bc059302966f352f
    resource: repo://src/credits.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-28656765c1c7b3de1095608f
    resource: repo://src/jobs.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Job Queue, Credits and Cron

Slow or paid work (AI video, marketer tasks, inbox replies, affiliate clips) never runs inside the request that asked for it. It is written to a D1 `jobs` table and drained by workers in `src/jobs.ts`. Credits live in a separate append-only ledger owned by `src/credits.ts`.

## Credit ledger

- Balance is `SUM(delta)` over `credit_ledger` for a user; nothing is stored as a mutable balance (`src/credits.ts`).
- A user's plan is their `active` subscription's plan, else `free` (`PLAN_ID_SQL`). A plan carries `monthly_credits`, `max_parallel_jobs` and `price_thb`. `getPlan` throws if the `free` plan was not seeded by the migration.
- `grantCredits` appends positive rows with reason `grant` (admin) or `purchase`.

## Enqueue: hold and job in one batch

`enqueueJob` sends two statements in a single `db.batch`:

1. Insert a `job_hold` ledger row of `-cost` **only if** the balance covers the cost and, when the job counts toward the limit, the user has fewer queued/running limited jobs than the plan's `max_parallel_jobs`.
2. Insert the `jobs` row **only if** a hold row for that job id exists.

So a job and its hold never disagree. On failure it reports `insufficient_credits` or `too_many_jobs` by re-reading the balance. Background work such as inbox replies passes `countsTowardLimit: false` so it does not use the plan's parallel slots.

## Claiming, leases and fencing

- `claimNextJob` atomically flips the highest-priority, oldest runnable `queued` job (`run_after <= now`) to `running`, increments `attempts` and sets `lease_until` (default 300 s).
- `attempts` is the **fencing token**. `completeJob`, `failJob` and `deferJob` only write when `status='running' AND attempts = expected`, so a worker that overran its lease and lost the job to recovery cannot overwrite the new attempt's result (it logs "job fencing" instead).
- `recoverExpiredLeases` finds running jobs past their lease and fails the lost attempt with "worker lease expired" (retry or terminal).

## Failure, retry, defer, refund

- `failJob` requeues with exponential backoff (30 s base, doubling, capped at 900 s) when the error is retryable and attempts remain (`max_attempts` default 3); otherwise it marks the job `failed`.
- The same batch inserts a `job_refund` ledger row; a unique `(job_id, reason)` index makes the refund happen **exactly once**, and the `attempts` guard ties it to the attempt this call owns.
- Handlers signal intent by exception: `PermanentJobError` skips retry; `JobDeferredError(seconds)` puts the job back (5 s–1 h wait) keeping the credit hold, without spending a retry (`max_attempts` grows by one). A kind with no registered handler fails permanently.
- Stored errors and logs use `errorSummary` — error class name plus HTTP status, never the message — because provider messages can echo customer content. `PermanentJobError` messages are kept since they are fixed reason codes.

## Running the queue

`runQueue(db, handlers, {maxJobs, leaseSeconds, concurrency})` first recovers expired leases, then starts `concurrency` runners that reserve a slot before awaiting a claim, so parallel runners stay under `maxJobs`. Handlers are looked up by `kind` in `jobHandlers(env)` in `src/index.ts`: affiliate, inbox, marketer tasks and AI video. `getJobForUser` returns a user's own job plus how many runnable jobs are ahead of it (for queue-position UI).

Two callers exist: the cron (`maxJobs: 30, concurrency: 5`) and the marketer API's `kick` (`maxJobs: 2, concurrency: 2`, via `ctx.waitUntil`) so a newly created task starts without waiting for the next minute.

## Cron fan-out

`scheduled` in `src/index.ts` runs once per minute, reloads settings with `withSettings`, and starts each piece in its own `ctx.waitUntil` so one failing configuration cannot stop the others:

| Piece | Gate |
| --- | --- |
| `runQueue` | always |
| `publishDuePosts` (max 2) | `FEATURE_SOCIAL` |
| `runBillingCron` (expiry + monthly top-up) | always |
| `backfillReceipts` (max 20) | always |
| `syncTrendingApi` at UTC minute 7 | `FEATURE_MARKETER` and `TRENDING_API_URL` |
| `refreshTrendingCovers` (3) | `FEATURE_MARKETER` |
| `drainInbox` (5 receipts, 20 messages) | `FEATURE_INBOX` |

## Tests

`tests/job-lease-fencing.test.cjs` and `tests/credits.test.cjs` exercise this logic against the `node:sqlite` D1 shim.
