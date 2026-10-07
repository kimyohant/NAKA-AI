---
type: workflow
title: Media Generation
description: The unified image/video generation task lifecycle on the sys_task table — provider adapters, submit/poll flow, per-config queueing, restart recovery, write-back to business rows, cost budgets and source-freshness snapshots.
tags: [generation, sys-task, adapters, video, image, queue, budget, recovery]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-3019945c97bb031934c9d338
    resource: repo://backend/src/services/adapters/registry.ts
  - id: openwiki-source-2c7cc4d464f0df2362fcc021
    resource: repo://backend/src/services/generation-cost.ts
  - id: openwiki-source-0a3b1e4f18c49bf0975b631f
    resource: repo://backend/src/services/generation.ts
  - id: openwiki-source-3a6d4aa72bbd3f5d82e13b1a
    resource: repo://backend/src/services/source-freshness.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Media Generation

All image and video generation, for dramas, Studio, Seller and Viral Clone alike, goes through `backend/src/services/generation.ts`. Callers invoke `generateImage(...)` or `generateVideo(...)` and get back a `sys_task` id immediately; everything else happens in a background worker. Callers include the drama pipeline ([Drama Pipeline](drama-pipeline.md)) and the marketing features ([Marketing Suite](marketing-suite.md)).

## Task lifecycle

1. **Config selection.** A request may name a `configId` (episodes can lock one). If it is missing, deleted or disabled, the code silently falls back to the active config for that service type; no config at all raises `E_NO_IMAGE_MODEL` / `E_NO_VIDEO_MODEL`. Configs come from the `ai_service_configs` table, edited in Settings.
2. **Create.** `createTask` runs in one DB transaction: it resolves the owning drama (from storyboard/character/scene/prop), estimates cost, enforces the project budget, snapshots the shot's sources (video only), and inserts a `sys_task` row with status `queued`. Then `startTask` launches the worker.
3. **Build and submit.** `processTask` selects the adapter by provider name, normalizes references (images inlined as compressed data URLs; reference video/audio/files must resolve to public URLs, which need `PUBLIC_BASE_URL`), optionally calls `adapter.prepareRecord` (for providers that need uploads first), builds the HTTP request, sets status `submitting`, and POSTs with a 10-minute timeout.
4. **Busy retry.** If the adapter's `isRetryableSubmit` says the provider is busy (including on non-2xx bodies, e.g. an Unsloth 409), the task waits 15 s and resubmits, up to 40 times (about 10 minutes) instead of failing.
5. **Complete or poll.** The adapter's `parseGenerateResponse` says whether the result is synchronous (URL or base64 for Gemini-style providers) or asynchronous with a `taskId`. Async tasks move to `processing` and `pollTask` polls: images every 5 s up to 120 times (10 minute cap), videos every 10 s up to 300 times. Transient poll errors are retried.
6. **Download and write back.** The result is downloaded into local storage (`localPath`) and the task becomes `completed`. Write-back updates business rows: scene/character/prop images directly, and for storyboards the shot's image or video fields — **unless** the user has already pinned a candidate for that slot in `storyboard_media_selections`, in which case the new result stays a candidate only (see readiness in [Drama Pipeline](drama-pipeline.md)).

Failure statuses distinguish certainty: `failed` (with `errorMsg` and `errorCode`) when the provider rejected or reported failure, and `unknown` when a worker died or submission state is uncertain, because blindly resubmitting could double-charge. `resumeGenerationTask` lets a user resume polling an `unknown`/`processing` task that has a provider task id.

## Adapters

`adapters/registry.ts` holds two maps keyed by lowercase provider name. Image: `openai`, `gemini`, `volcengine`, `qwencloud`, `wancreate`, `unsloth`. Video: `volcengine`, `minimax`, `aliyun`, `wancreate`, `unsloth`. An unknown provider throws `Unsupported image/video provider`. To add a provider, implement `ImageProviderAdapter` or `VideoProviderAdapter` (`adapters/types.ts`): `buildGenerateRequest`, `parseGenerateResponse`, `buildPollRequest`, `parsePollResponse`, and URL/base64 extractors, plus optional `prepareRecord` and `isRetryableSubmit`; then register it. Video adapters may declare `capabilities` (min/max/step duration, `maxConcurrent`, `nativeAudio`, `needsPublicUrls`, estimated seconds per clip) which are additive: undeclared fields mean no limit, so older providers behave unchanged.

## Per-config video queue

When a video adapter declares `maxConcurrent` (for example the self-hosted Unsloth GPU, limited to 1), only that many tasks per config may be in `submitting`/`processing`/`unknown` (plus in-memory slot claims set before the DB status changes, to avoid races). Excess tasks stay `queued`. `config.settings.max_concurrent` overrides the declared value. `pumpVideoQueue` starts the oldest queued task when a slot frees; a 60 s sweep also fails tasks waiting beyond `queue_timeout_minutes` (default 240) with `E_VIDEO_QUEUE_TIMEOUT`. `videoQueuePosition` gives the UI a 1-based position. Providers without `maxConcurrent` bypass all of this.

## Restart recovery

`recoverGenerationTasks` runs at startup ([Backend Server](../architecture/backend-server.md)). For each task in `queued`/`submitting`/`processing`: if it has a provider task id and its config is recoverable, polling resumes; a `queued` task is re-queued; otherwise it is marked `unknown`. The config is resolved by the stored `config_id`, or for older rows only when exactly one config matches the provider. Then the queue is pumped. Resume only happens when the provider name still matches.

## Cost and budget

`generation-cost.ts` reads prices from the config's `settings` JSON: `price_thb_per_image` or `price_thb_per_video_second` (times duration), rounded up to cents. A drama may have `budgetThb`; if so, creating a task requires a priced config and the sum of all the drama's `estimated_cost_thb` plus the new estimate must not exceed the budget, otherwise creation throws before anything is sent to a provider. `quoteGeneration`/`budgetForDrama` expose the same numbers for UI previews, including a count of unpriced tasks. Estimates are local accounting only; they are not read back from provider billing.

## Source freshness

For video tasks tied to a shot, `sourceSnapshotForShot` stores SHA-256 digests of the script, style, shot fields, scene, characters (and looks), props and reference images at creation time. `videoSourceStatus` later compares the current snapshot against the one stored with the completed task that produced the shot's current video: `current`, `stale` (with the list of changed sections) or `untracked` (legacy clips with no snapshot). Export health turns stale/untracked into warnings (see [Drama Pipeline](drama-pipeline.md)).

Tests: the budget and freshness rules are covered by `production-guards-scenario.ts`, queueing by `unsloth-queue-scenario.ts` ([Test Suite](../testing/test-suite.md)).
