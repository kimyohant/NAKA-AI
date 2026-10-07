---
type: workflow
title: AI Marketer and AI Video
description: How the AI marketer turns seller input into queued Claude tasks (insight, bulk plans, recreate), pulls trending videos, reads product URLs safely, and how AI video jobs submit to a pluggable provider, poll without blocking the queue, and store results in R2.
tags: [marketer, ai-video, claude, trending, r2, jobs, studio]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-48cc88b623e1d8d0c85d2a00
    resource: repo://src/marketer/ai.ts
  - id: openwiki-source-cf776d7712d8e7717ad97db9
    resource: repo://src/marketer/index.ts
  - id: openwiki-source-c11f7d661643b48ac89b0f38
    resource: repo://src/marketer/product.ts
  - id: openwiki-source-a84746d2e15be2634cecacd5
    resource: repo://src/marketer/trending.ts
  - id: openwiki-source-f5c0ca5dd16d18ce971b0968
    resource: repo://src/studio.ts
  - id: openwiki-source-dc327535becd3fcbc3d7fbce
    resource: repo://src/video/index.ts
  - id: openwiki-source-e530ccadf8643896c2a11154
    resource: repo://src/video/provider.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# AI Marketer and AI Video

<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
All of this work is paid in credits and runs through the shared job queue ([Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md)). The features sit behind `FEATURE_MARKETER` (cron parts) and the config that `/admin/system/` supplies ([Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md)). Overview docs: `docs/ai-marketer.md`.

## Marketer tasks (`src/marketer/`)

`handleMarketer` is mounted at `/api/marketer`. Config, trending lists and signed images are public GETs; creating tasks and looking up products needs a session. Creating a task validates the body with `parseMarketerInput` (Thai-language validation errors) and calls `enqueueJob` with `MARKETER_COST_CREDITS` (1 credit, `maxAttempts: 2`), returning `202 {jobId, cost}`. The router passes a `kick` that runs the queue for two jobs immediately.

Three job kinds are registered (`MARKETER_JOB_KINDS`): `marketer_insight` (template- or prompt-driven expert advice by category), `marketer_bulk` (1–10 content plans for a channel, tone and 15/30/60 s duration) and `marketer_recreate` (rebuild a trending video's structure, or replace its content, from up to 8 base64 frames). `makeMarketerHandlers(env)` calls Claude (`claude-opus-5-5` via `@anthropic-ai/sdk`) with a Thai-market context from `catalog.ts`; stored job input is re-validated with the same parser. Recent tasks are listed per user from the `jobs` table.

### Product URL reading (`product.ts`)

Reads a product page's Open Graph / schema.org data. It only accepts public `https` hosts (no IP literals, ports, credentials or local-looking names) and `fetchPublic` re-checks **every redirect hop** manually (max 4, 8 s timeout, 1.5 MB cap) so a public link cannot bounce into a private network. Images are served through an HMAC-signed proxy link valid for one hour.

### Trending (`trending.ts`)

`trending_videos` rows come from three sources — admin-curated, FastMoss/Kalodata-style export import, or an API (`TRENDING_API_URL`, optional `TRENDING_API_KEY`, `TRENDING_API_USD_RATE`). `normalizeTrending` accepts varied column names and Thai/English categories. The cron runs `syncTrendingApi` at UTC minute 7 and `refreshTrendingCovers` (3 per tick) because TikTok oEmbed covers are signed and expire after about a day.

## AI video (`src/video/`)

Flow:

1. **Upload** (`uploadMedia`): body is the file; allowed types MP4/MOV/WebM (≤ 50 MB) and JPG/PNG/WebP (≤ 10 MB). Declared and streamed sizes are both checked, and `looksLike` verifies magic bytes so renamed files are rejected. Person photos need `?person=consented|ai_generated&consent=1`. Objects go to R2 at `marketer/<userId>/<uuid>.<ext>` with a `marketer_media` row (the object is deleted if the insert fails). Without the `MEDIA` binding every route answers 503 — production leaves R2 unbound.
2. **Create** (`createAiVideo`): requires R2 and an active provider (`VIDEO_PROVIDER`, `VIDEO_API_KEY`, optional `VIDEO_BASE_URL`/`VIDEO_MODEL`). Kinds are `recreate`, `replace`, `product`, `plan`. It checks every referenced media key belongs to the user and has the right kind, enforces provider reference limits, clamps duration to the provider's range, builds an English prompt (`buildVideoPrompt`), and enqueues an `ai_video` job (default 5 credits, `AI_VIDEO_CREDITS` 1–100). Insufficient credits → 402, parallel limit → 429. An `ai_videos` row records prompt, provider and model.
3. **Job handler** (`makeAiVideoHandler`) is a small state machine on `ai_videos.status`: `queued` → atomically `submitting` → provider `submit` → `submitted` (store task id) → repeated `poll` → `done`. While waiting it throws `JobDeferredError` (30 s polls) so the queue worker is not blocked and the credit hold is kept. It gives up after 45 minutes ("provider timeout").
4. **Result**: the provider's expiring URL is downloaded (≤ 200 MB) into R2 at `marketer/<user>/out/<id>.mp4`.

### Never pay twice

A job found in `submitting` (crash between claim and recording the task id) is failed as "submit outcome unknown" rather than resubmitted. A `VideoProviderRejected` error means the provider refused before starting; other submit errors are also treated as possibly started. Failure marks the row and throws `PermanentJobError`, so the queue refunds the credits once; `publicError` maps internal reasons to short Thai messages stating the credits were returned.

### Signed media links

`signedMediaUrl` produces `/api/marketer/media/<key>?e=<exp>&s=<hmac>` valid up to 6 h; `serveMedia` checks the key pattern, expiry window and constant-time signature, requires a `marketer_media` row, supports a single byte range for playback and sets `nosniff` and a restrictive CSP. Providers fetch references through these links without a session.

### Provider seam

`provider.ts` defines `VideoProvider` (`id`, `defaultBaseUrl`, `defaultModel`, `limits`, `submit`, `poll`) and a `VIDEO_PROVIDERS` registry filled by `registerVideoProvider`. Adding a provider means implementing that interface and registering it; the admin panel selects it.

## Related content APIs

- `src/studio.ts` — the admin-token-protected content draft API (`/api/admin/studio`) generating captions, script, plan and image prompt for four workflows (`sales`, `drama`, `bot`, `live`) through Claude; it returns 503-style errors when `ANTHROPIC_API_KEY` is absent and text only (no rendering).
- `src/affiliate.ts` — the older review-clip job (`affiliate_review`, 1 credit): validated input, Claude script, optional Google TTS, optional affiliate link; `POST /api/affiliate/reviews` is blocked when `FEATURE_CLIPS` is off.

Tests: `tests/marketer.test.cjs`, `tests/ai-video.test.cjs`, `tests/studio.test.cjs`, `tests/affiliate.test.cjs`.
