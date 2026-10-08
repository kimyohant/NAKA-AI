---
type: workflow
title: Drama Pipeline
description: The core novel-to-video workflow for an episode — agent-driven script rewrite, asset extraction, storyboard breakdown and video prompts, then per-shot readiness checks, export health validation and FFmpeg merge.
tags: [workflow, episode, storyboard, extraction, pipeline-tasks, ffmpeg, export]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-4c03e203b4fc82b1a8a8b318
    resource: repo://backend/src/routes/agent.ts
  - id: openwiki-source-6b4fc8084c88e97efc872412
    resource: repo://backend/src/routes/episodes.ts
  - id: openwiki-source-acf1a224521715c050ef1ed8
    resource: repo://backend/src/services/export-health.ts
  - id: openwiki-source-3b22371d98c6c423bfdb952c
    resource: repo://backend/src/services/extraction.ts
  - id: openwiki-source-5f1358620490558f8f722b37
    resource: repo://backend/src/services/ffmpeg-merge.ts
  - id: openwiki-source-ef032bff6b56b69f7f594b7d
    resource: repo://backend/src/services/pipeline-tasks.ts
  - id: openwiki-source-3e7b88be6d5fbcc15e9fc04d
    resource: repo://backend/src/services/storyboard-readiness.ts
  - id: openwiki-source-4494e212d2e321c0c1618b28
    resource: repo://backend/src/services/video-prompts.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Drama Pipeline

An episode moves through: **script rewrite → extract characters/scenes/props → storyboard breakdown → asset and shot images → video prompts → video generation → merge/export**. The UI for this is `frontend/app/views/drama/episode.vue` ([Frontend](../architecture/frontend.md)). Text steps are agent runs ([AI Agents](../architecture/ai-agents.md)); image/video steps use the task system in [Media Generation](media-generation.md).

## Progress model

`GET /episodes/:id/pipeline-status` (`routes/episodes.ts`) derives step states purely from stored data, so there is no separate workflow state to drift: script rewrite is `done` if `scriptContent` exists (or `ready` if only the original `content` does); extraction steps are `done` when drama-level characters/scenes/storyboards exist; image and video steps compare how many storyboards have `composedImage` / `videoUrl` against the total (`partial` in between); merge reflects the latest `video_merges` row.

## Chat-style agent calls

`POST /agent/:type/chat` (`routes/agent.ts`) validates the agent type, requires `drama_id` and `episode_id`, builds the request context, prepends the drama's creative context (`buildDramaCreativeContext`: genre, tropes, duration targets) to the user message, and runs `agent.generate` with `maxSteps: 20`. It returns the final text plus normalized tool calls and results. Script rewrite, storyboard breakdown and similar single-shot steps use this path; errors keep their `errorCode` for localized display.

## Long-running agent jobs

Extraction and batch video prompts run asynchronously and are tracked in the `pipeline_tasks` table via `services/pipeline-tasks.ts`, which is the single source of truth (replacing an in-memory map):

- Each job has a unique `key` such as `extract:<episode>:<target>` or `video_prompts:<episode>`. `startTask` returns `null` if a `running` row with that key exists, so the caller refuses duplicates; finished rows are reset in place, and a unique-constraint race on insert is retried.
- Cancellation is **cooperative**: `cancel_requested` is a flag the job checks at safe points. Extraction checks only before the agent call (a call in flight cannot be interrupted); video prompts check between shots.
- On boot, leftover `running` rows are marked failed (`failStaleRunningTasks`, see [Backend Server](../architecture/backend-server.md)).

**Extraction** (`services/extraction.ts`): targets `characters`, `scenes` and `props` run independently, so different targets for one episode can run in parallel. Each sends a type-specific instruction to the `extractor` agent, which reads existing project assets and saves via dedup tools so names (including `Name (role)` variants) and scene location+time pairs are merged, not duplicated; props are deliberately limited (0–3 per episode, only plot-driving items).

**Batch video prompts** (`services/video-prompts.ts`): selects storyboards missing a `video_prompt` (or an explicit id list, which regenerates even existing ones) and runs `prompt_generator` once per shot with `maxSteps: 8`, telling it which video model the episode locks to. Success is judged by whether `video_prompt` is actually non-empty in the database afterwards, not by the agent's reply; each shot updates `completed`/`failed` counters and one failure does not stop the batch.

## Readiness before video

`storyboardReadiness` (`services/storyboard-readiness.ts`) returns `ready_for_video` plus a list of `blockers`: missing video prompt, missing scene/character/prop (or assigned character look) reference image, and `select_image_candidate` when completed image candidates exist for a slot (`composed`, `first_frame`, `last_frame`) that the user has not selected via `storyboard_media_selections`. Character look assignments override the character's default image.

## Export health and merge

`episodeExportHealth` (`services/export-health.ts`) inspects each selected shot's clip with ffprobe (4 at a time): missing file, file under 1 KiB, no decodable video stream, bad duration or dimensions are **errors**; stale or untracked source freshness, missing audio, duration off from plan by more than max(2 s, 25%), and mixed aspect ratios are **warnings**. `ready` requires at least one clip and zero errors. Routes: `GET /merge/episodes/:id/health`.

`mergeEpisodeVideos` (`services/ffmpeg-merge.ts`, route `POST /merge/episodes/:id/merge`) merges the selected (or all) shots in shot-number order. Partial merges of generated shots are allowed when no selection is given; with an explicit selection every chosen shot must belong to the episode and have a video. It probes the ffmpeg binaries first (a broken binary can crash the process), verifies files exist, and re-runs export health, then inserts a `video_merges` row (`processing`), and runs `doMerge` in the background: concat demuxer to H.264 (crf 23) + AAC 48 kHz, output `static/merged/<uuid>.mp4`, verified by ffprobe duration and size, poster frame extracted, row marked `completed`, and `episodes.videoUrl` updated. Failures mark the merge `failed` with `errorMsg`. `GET /merge/episodes/:id/merge` returns the latest merge and `/merges` the last 30 non-deleted ones.
