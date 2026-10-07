---
type: architecture
title: AI Agents
description: How NAKA-AI registers Mastra agents, assembles their instructions from prompt files, skills and language directives, resolves the text model per request, and adapts to relay providers with a chain of fetch patches.
tags: [agents, mastra, prompts, skills, llm, backend]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T09:20:00.933Z
sources:
  - id: openwiki-source-edad222fec5d87de7643460a
    resource: repo://backend/src/agents/index.ts
  - id: openwiki-source-050b66ede6b5efdfcf275572
    resource: repo://backend/src/agents/language.ts
  - id: openwiki-source-df10d2f9e8e516d798b8a6c4
    resource: repo://backend/src/agents/skills.ts
generated: { by: "claude-code", at: "2026-10-07T09:20:00.933Z" }
---

# AI Agents

All LLM-driven text work (script rewrite, asset extraction, storyboard breakdown, prompt writing, marketing, live selling) runs through [Mastra](https://mastra.ai) agents defined in `backend/src/agents/index.ts` and mounted on a single `Mastra` instance in `backend/src/mastra/index.ts` (logger disabled; the project uses its own task logger).

## Registry

`validAgentTypes` is the key set of `DEFAULT_PROMPTS`. For each type, `agentRegistry` creates one **static** `Agent` whose `instructions` and `model` are *dynamic functions* of the request, not fixed strings. Core drama agents are `script_rewriter`, `extractor`, `storyboard_breaker` and `prompt_generator`; the same registry also holds `script_reviewer`, `hook_suggester`, marketer agents (`market_researcher`, `strategist`, `ad_scriptwriter`, `ad_analyst`), Product Studio's `review_director`, and JSON-returning agents with no tools (`viral_cloner`, `viral_translator`, `influencer_writer`, `seller_copywriter`, `live_host`, `live_responder`).

Tools come from `AGENT_TOOLS` (`agents/tools/*`). `prompt_generator` combines image-prompt tools with the storyboard read/update tools; tool-less agents return JSON in the message and the backend parses/validates it itself.

## Per-request context

Routes build a Mastra `RequestContext` with `buildAgentRequestContext` (`agents/context.ts`) holding `episodeId`, `dramaId`, optional `modelOverride`/`textConfigId`, and the content `language` (defaulting to the global `app_settings` content language). Tools read the ids from the context instead of taking them as arguments. Marketer agents use a separate campaign-scoped context that also restricts which doc kinds and how many creatives may be written.

## Instruction assembly

`buildInstructions(type)` joins, in order and dropping empties:

1. the prompt file body from `workspace/prompts/<type>[.<lang>].md`, falling back to the in-code `DEFAULT_PROMPTS` text;
2. the concatenated full text of the agent's skills (`loadAgentSkills`);
3. a pacing directive (only `storyboard_breaker`, `script_rewriter`, `ad_scriptwriter`, non-zh languages) that overrides the Chinese "500 chars/min, 4.5 chars/s" rules;
4. a "HIGHEST PRIORITY" output-language directive (`agents/language.ts`).

Chinese (`zh`) is the base language and adds zero directive tokens. For other languages the loader prefers `<type>.<lang>.md` / `SKILL.<lang>.md`; Thai falls back to the English variant before the Chinese base. The language directive explicitly overrides "output Chinese only" lines in older workspace copies, because the desktop app never overwrites an existing user workspace.

## Workspace and skills

`agents/skills.ts` creates one Mastra `Workspace` per agent, jailed to `backend/workspace/` (or `WORKSPACE_PATH`, which the desktop app points at a writable userData copy). `AGENT_SKILL_MAP` maps each agent to skill directories under `workspace/skills/`; matching is by path prefix, so a skill added from the Settings page (for example under `storyboard-breaker/`) is picked up without restart. Although Mastra natively injects only skill metadata, the project injects the full `SKILL.md` text for consistent behaviour. The filesystem instructions are deliberately worded without the word "workspace" because Gemini low-thinking modes sometimes read it as Google Workspace and refuse to call tools. `refreshSkillWorkspaces` forces a rescan after skill edits.

Prompt files (`agents/prompts.ts`) use a tiny frontmatter with only `name` and `model`. The `model` field is only ever read from the base (Chinese) file, never from language variants, to avoid drift.

## Model resolution and fetch patches

`buildModel` picks the model name by precedence: request `modelOverride` > prompt-file `model` > the text config's model. The text config is `textConfigId` (via `getConfigById`) or the active text config from the `ai_service_configs` table (`services/ai.ts`). `getModel` builds a Gemini provider for provider `gemini`, otherwise an OpenAI-compatible `.chat` provider, both with a custom `fetch` composed from patches:

- **Thinking off** (`createThinkingOffFetch`): for non-official hosts, injects `thinking: {type:'disabled'}` / `enable_thinking:false`, and Gemini-native `thinkingConfig` (`thinkingLevel: 'low'` for Gemini 3, `thinkingBudget: 0` earlier). Needed because new-api style relays demand `reasoning_content` round-tripping on thinking models. Disabled with `AI_DISABLE_THINKING=false`.
- **Temperature**: applied only when the config sets one.
- **Max tokens**: forced to `AI_MAX_TOKENS` (default 16384) except on official OpenAI hosts.
- **Retry** (outermost): retries 429/500/502/503/504 with backoff of 2/5/12/25 s, honouring upstream retry hints, skipping retries on per-day quota exhaustion. For Gemini, after a second failure (or immediately on daily quota) it rewrites the URL to the next model in `GEMINI_FALLBACK_MODELS`.

## Related

See [Drama Pipeline](../workflows/drama-pipeline.md) for how routes invoke these agents and [Media Generation](../workflows/media-generation.md) for the non-text side.
