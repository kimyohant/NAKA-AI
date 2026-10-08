---
type: workflow
title: Marketing Suite
description: The product-marketing side of NAKA-AI built on the same agents, tasks and merge pipeline as the drama flow — AI Marketer campaigns, Product Studio, AI Seller posts, the skills library, curated trending data, the creative gallery, and AI Live.
tags: [marketer, studio, seller, live, skills-library, trending, gallery]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-9ed81da49e2b36ed3013defb
    resource: repo://backend/src/agents/skill-library.ts
  - id: openwiki-source-8775f46037e7b28b0f1118df
    resource: repo://backend/src/routes/skills.ts
  - id: openwiki-source-ae8f94d0817323b8de8f8e13
    resource: repo://backend/src/services/ai-live.ts
  - id: openwiki-source-f14ea8b72a783d335f410587
    resource: repo://backend/src/services/gallery.ts
  - id: openwiki-source-ab194fb9d3c2795083368f66
    resource: repo://backend/src/services/marketer.ts
  - id: openwiki-source-d4628f0b093cc255cbf08b72
    resource: repo://backend/src/services/seller.ts
  - id: openwiki-source-96dbf6f1053fdde36f7bbdfb
    resource: repo://backend/src/services/studio-autorender.ts
  - id: openwiki-source-0cf8b2d8480c668241f40e78
    resource: repo://backend/src/services/studio.ts
  - id: openwiki-source-d158f2e66ce87c78b37cb63d
    resource: repo://backend/src/services/trending.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# Marketing Suite

Besides short dramas, the app has several product-marketing features. They are mostly thin orchestration over shared infrastructure: Mastra agents ([AI Agents](../architecture/ai-agents.md)), the `pipeline_tasks` job table and cooperative cancellation ([Drama Pipeline](drama-pipeline.md)), image/video generation tasks ([Media Generation](media-generation.md)), and `mergeEpisodeVideos`. UI lives under `frontend/app/views/{marketer,studio,seller,viralclone}` and `pages/live.vue`. The Viral Clone feature has its own page: [Viral Clone](viral-clone.md).

## AI Marketer (`services/marketer.ts`)

A **campaign** holds a product brief, then agent-written documents and creatives. Typed steps are `startResearch` (agent `market_researcher` writes `product_brief` and `market_research`), `startStrategy` (`strategist` writes audience, message map, campaign plan and content brief), and `startCreatives` (`ad_scriptwriter` saves creatives). `campaign.status` is the state machine the frontend polls (`draft → researching → research_ready → strategizing → strategy_ready → writing → … → failed`); the `pipeline_tasks` row provides the mutual-exclusion lock, and `failStaleCampaigns` fails any `researching/strategizing/writing` campaign at boot (see [Backend Server](../architecture/backend-server.md)).

Agents write results through campaign-scoped tools (`marketer-tools.ts`) using a request context that restricts which doc kinds may be written and caps how many creatives may be added. Docs keep revision history (`campaign_doc_revisions`) with restore, and can be revised by instruction. Product input can come from a URL via `ingestUrl` → `product-ingest.ts`, which uses the SSRF-safe fetch described in [Server Update and Security](../operations/server-update.md). Further features: reference ads analysed by `ad_analyst` from a user-pasted transcript, generated product visuals (packshot / on-model / lifestyle) through `generateImage`, and `produceCreative`, which turns an approved creative into production.

All JSON returned to clients is camelCase (unlike most drama routes, which use snake_case).

## Trending and Gallery

`services/trending.ts` is a **curated, read-only** list (`TREND_VIDEOS`) of Thai viral-clip patterns with beats (hook/demo/proof/offer/cta). The code states a deliberate rule: no scraping or pulling from platforms (terms-of-service), and all numbers are reference data as of a curation date. `services/gallery.ts` aggregates approved / in-production creatives across campaigns together with performance numbers (views, likes, comments, shares, sales) that users enter by hand; `performanceEvidenceBlock` feeds that evidence back into marketer prompts. Same no-platform-data rule applies.

## Product Studio (`services/studio.ts`)

One Studio project = one product review video. It creates and owns a system-generated drama plus episode (linked via metadata `studioProjectId`), and each shot is an ordinary `storyboards` row, so image/video generation, task prep, budget guard and merge are reused unchanged. The script is an async `pipeline_tasks` job run by the `review_director` agent following a template's beat structure (`studio-templates.ts`, `studio-shots.ts`), optionally with an avatar or an AI **influencer** (`studio-influencer.ts`: portrait, review images, review script). Keyframe and video progress are read live from `sys_task`. Subtitles/captions are built in `captions.ts` (SRT/ASS burn-in, requires a bundled caption font).

`studio-autorender.ts` adds one-click rendering: a `studio_render` pipeline task advances stages keyframes → videos → merging, polling `sys_task` every 5 s. A failed shot is counted but does not stop the pipeline; cancel stops before submitting the next stage; at boot `resumeStaleAutoRenders` continues from the interrupted stage, or fails with `E_TASK_INTERRUPTED` if it cannot.

## AI Seller (`services/seller.ts`)

A seller **post** is a product (name, price, images, links, optional video) plus per-channel copy for TikTok, Shopee, Facebook and Instagram. `generateCopy` asks `seller_copywriter` for caption, hashtags and a pinned comment per channel; the model returns JSON that the backend validates, with hashtag limits per channel. The product/affiliate link is **never generated by the model**: `composeChannel` appends it to the comment itself so a URL cannot be altered. Posting is manual (no platform account integration).

`makeVideo` links a post to a Studio project: it requires a product name and active text, image and video model configs (checked before spending money), creates the project, starts the script, and marks `videoAuto`. `driveVideo` is a single-per-post loop that calls the idempotent `syncVideo` every few seconds to start auto-render when the script is ready and attach the finished merged video, or record `videoError` on failure; `resumeSellerVideos` restarts drivers at boot.

## Skills Library (`agents/skill-library.ts`)

A static catalogue of optional, original skills for `script_rewriter`, `extractor`, `storyboard_breaker` and `prompt_generator`, grouped by category (story, continuity, cinematography, visual, quality) with English and Thai titles. `GET /skills/library` lists them with an `installed` flag; `POST /skills/library/<id>` renders a normal `SKILL.md` into the agent's workspace folder (refusing if it already exists) and refreshes the skill workspaces, so the next agent run picks it up with no restart.

## AI Live (`services/ai-live.ts`)

Live-selling avatars run on a separate GPU host ([Server Update and Security](../operations/server-update.md)). The backend never talks to LiveTalking or SRS directly; it calls `naka-live-agent` with a Bearer token (`/start`, `/stop`, `/say`, `/interrupt`, `/push/start`, `/whep`, …). Settings are stored in `app_settings` under key `ai_live`; the token and the RTMP URL (which contains a stream key) are never returned to the frontend, only `hasToken` / `hasRtmpUrl` / the RTMP host. Unreachable hosts and 401 responses become `E_LIVE_UNREACHABLE` / `E_LIVE_UNAUTHORIZED`. The `live_host` agent writes the host script and `live_responder` answers viewer comments, both returning JSON that the backend parses; `services/tiktok-live.ts` supplies live chat events.
