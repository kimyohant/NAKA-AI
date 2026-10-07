# Files

- [Drama Pipeline](drama-pipeline.md) - The core novel-to-video workflow for an episode — agent-driven script rewrite, asset extraction, storyboard breakdown and video prompts, then per-shot readiness checks, export health validation and FFmpeg merge.
- [Marketing Suite](marketing-suite.md) - The product-marketing side of NAKA-AI built on the same agents, tasks and merge pipeline as the drama flow — AI Marketer campaigns, Product Studio, AI Seller posts, the skills library, curated trending data, the creative gallery, and AI Live.
- [Media Generation](media-generation.md) - The unified image/video generation task lifecycle on the sys_task table — provider adapters, submit/poll flow, per-config queueing, restart recovery, write-back to business rows, cost budgets and source-freshness snapshots.
- [Viral Clone](viral-clone.md) - How Viral Clone turns a user-pasted transcript of a viral ad into a validated Blueprint, expands it into a matrix of variants, renders each variant through the shared generation pipeline, and finishes with either the Hypit engine or FFmpeg merge plus burned captions.
