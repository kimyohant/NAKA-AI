---
type: workflow
title: Viral Clone
description: How Viral Clone turns a user-pasted transcript of a viral ad into a validated Blueprint, expands it into a matrix of variants, renders each variant through the shared generation pipeline, and finishes with either the Hypit engine or FFmpeg merge plus burned captions.
tags: [viral-clone, blueprint, variants, hypit, captions, ffmpeg, render]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-13f19d25a70f6fff09730212
    resource: repo://backend/src/services/clone.ts
  - id: openwiki-source-05fa8d6c05fc423b1ed89ce8
    resource: repo://backend/src/services/hypit-render.ts
  - id: openwiki-source-463d9a0205c8febd67f070b2
    resource: repo://study/README.md
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Viral Clone

Viral Clone copies the *structure* of a viral short ad — not its footage — into many ad variants. Code lives in `backend/src/services/clone.ts` (routes in `routes/clone.ts`, mounted at `/api/v1/clone`), with `captions.ts` and `hypit-render.ts` for the finishing step. The UI is `frontend/app/views/viralclone/workspace.vue`. It reuses the Studio pipeline instead of adding a renderer ([Marketing Suite](marketing-suite.md), [Media Generation](media-generation.md)).

## 1. Analyze: transcript → Blueprint

The user pastes the transcript (max 20,000 chars). `analyzeCloneProject` takes a `clone_analyze:<id>` lock via `pipeline_tasks`, checks a text model exists (`E_NO_TEXT_MODEL` before any state change), sets the project `analyzing`, and runs the `viral_cloner` agent, which has no tools and must reply with JSON only.

`runCloneAnalyze` extracts the JSON object (tolerating code fences), validates it with `validateBlueprint`, and on failure makes **exactly one repair attempt**, sending the validation errors and previous JSON back. A second failure sets the project to `error` with `E_CLONE_ANALYZE_FAILED`. Success stores `blueprintJson` (beats with role `hook|demo|proof|offer|cta`, visual type `product|avatar|broll|text`, spoken line, duration, optional alternative hooks and caption style) and sets `ready`. The user can also edit the Blueprint directly (`PUT /projects/:id/blueprint`, re-validated). On boot `failStaleCloneAnalyzes` fails projects left `analyzing` ([Backend Server](../architecture/backend-server.md)).

## 2. Variants: the matrix

`buildMatrix` takes four optional angles — hook indexes, product ids, avatar ids, languages — and builds their Cartesian product. An **empty angle counts as one default option, not zero** (keep the Blueprint hook, no product/avatar override, project language), so any non-empty subset still yields variants. The total is capped at `CLONE_MATRIX_CAP = 12`. Each combination becomes a `clone_variants` row in `draft` status with its overrides stored as JSON.

## 3. Render

`startCloneRender` (single variant, or `render-all`) requires a Blueprint, moves only `draft`/`failed` variants to `queued`, then takes a project-level `clone_render:<projectId>` lock. If a driver is already running it simply returns the queued count and the existing driver will pick the new rows up. Otherwise `runCloneRenderPipeline` loops: honour cancel (queued variants go back to `draft`; a variant already rendering is allowed to finish), pick the lowest-id `queued` variant, and call `renderSingleVariant`; the batch ends `done` when none remain. Variants render **one at a time**; provider-side concurrency is governed by the normal generation queue.

`renderSingleVariant` stages, recorded via `saveRenderState` so a restart can resume: `prepare` (if the variant language differs from the project language, a text model translates the lines and hooks first; short beats are merged by `mergeShortBeats` to respect the video model's minimum duration) → `keyframes` (first-frame images through `generateImage`) → `videos` (clips via `generateVideo`, with spoken lines and native audio when supported) → `merge`. It waits for the `sys_task` rows to settle and asserts they succeeded. Errors mark the variant `failed` with an `errorCode` (default `E_RENDER_TASK_FAILED`) and a truncated message; the driver then continues with the next variant. At boot `resumeStaleCloneRenders` restarts drivers for `running` `clone_render` tasks, failing those whose project is missing.

## 4. Finishing: Hypit or FFmpeg

The last step depends on the project's `render_engine` (`naka` or `hypit`):

- **`naka` (default / fallback):** `mergeEpisodeVideos` concatenates the beat clips ([Drama Pipeline](drama-pipeline.md)), then `burnCloneCaptions` builds timed cues (`captions.ts`: language-aware line splitting with `Intl.Segmenter`, SRT/ASS output with `clean`/`bold`/`boxed` styles and an AI-label line) and burns them with ffmpeg. If caption burning fails (for example a missing font — `assertCaptionFontAvailable` raises `E_CAPTION_FONT_…` when the language's bundled font in `CAPTION_FONT_DIR` is absent), the variant is still delivered **without captions**.
- **`hypit`:** `renderCloneWithHypit` probes each clip, builds an SVML/SVS/SVRun composition (media, audio and typography tracks) in a temporary workdir under `DATA_ROOT/hypit`, and runs the Hypit CLI as a **separate Node process** (`study/hypit/bin/hypit.mjs build`, 30-minute default timeout via `HYPIT_TIMEOUT_MS`), then fetches `final.video` into `static/merged/<uuid>.mp4`. It always shuts down the Hypit runtime worker and deletes the workdir (unless `HYPIT_KEEP_WORKDIR=1`). `getHypitStatus` reports unavailable when `bin/hypit.mjs`, its `node_modules`, or the configured Chromium (`HYPIT_CHROME_PATH`) is missing; `GET /clone/hypit/status` exposes this. If Hypit is unavailable **or any step throws**, the function returns `null` and the pipeline falls back to the ffmpeg path, so a variant is still delivered.

Finally the output duration is probed with ffprobe and the variant becomes `completed` with `outputPath` and `durationSec`.

## Hypit licensing constraint

`study/hypit/` is an unmodified vendored copy of the Hypit project. Per `study/README.md` it is used **internally only**: it must not be distributed with NAKA-AI to outsiders for commercial gain or offered as a multi-tenant hosted service without a commercial license, and its LICENSE and attribution must stay intact. The backend never imports Hypit code, only spawns the CLI. Desktop and Docker builds do not include a working Hypit install, so they always use the ffmpeg path.

Tests: `clone-blueprint.test.ts`, `clone-pipeline.test.ts`, `clone-structure.test.mjs` and `hypit-render.test.ts` ([Test Suite](../testing/test-suite.md)).
