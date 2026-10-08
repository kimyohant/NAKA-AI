---
name: ad-scriptwriter
description: Writing standards for ad creatives and formatted scripts — consumable by downstream extraction/storyboard agents
---

# Ad Script Standards

## Creative fields

Every creative requires: angle (differentiated, short), hook (the literal 0-3s hook line), format, platform, durationSec, cta (optional), script (complete formatted script).

- **format** — one of six: ugc (talking-head / unboxing feel), product_demo, problem_solution, before_after, testimonial, unboxing
- **durationSec**: usually 15/30/45/60; budget spoken content by duration and cut what does not fit
- **angle differentiation**: N creatives must not repeat angles (different pains, audiences, or scene entries)

## Formatted script format (hard constraint)

Downstream extractor / storyboard_breaker parse this structure — **do not change it**:

```
## S1 | 内景 · 卧室 | 白天

(Action paragraph: who does what where, how the product appears / is used)

角色名：（状态/表情）台词内容
```

- Scene header: `## S编号 | 内景/外景 · 地点 | 时间段`; time-of-day is limited to 白天 / 傍晚 / 夜晚
- Action has no camera language (no "close-up", no "dolly in" — that is the storyboard agent's job)
- Dialogue: `角色名：（状态/表情）台词内容`; narration is written as `旁白：内容`
- No Markdown structure besides scene headers: no titles, no lists, no bold, no block quotes
- durationSec ≤ 40s → exactly 1 scene; 45-60s → 2 scenes

## Content rules

- **Hook in 0-3 seconds**: the first spoken line of scene 1 is the hook (pain question / result first / counter-intuitive / price shock); exposition comes after
- **Product = prop**: write the product into action paragraphs with a specific name and concrete appearance (appearance details come from the product description — do not invent them) — held, used, or displayed on screen, so the extractor lifts it as a prop and real product photos get attached. **The product name must exactly match the campaign's Product field** (no rewriting, translating, or shortening): a mismatched name means the reference photos cannot be attached
- **Character economy**: 1-2 named characters; every speaking character becomes an extracted character asset — unnamed extras only add noise
- **Total duration matches durationSec**: all scenes combined ≈ durationSec
- **CTA**: the last line of the final scene lands on the cta (dialogue or narration)
- Shootable content only; no meta commentary like "product benefits are shown here"

## Recreate mode (rewriting from a reference ad)

When the user message contains 【Reference ad structure】:
- **Keep the skeleton**: beat order (hook/problem/demo/proof/offer/CTA), each beat's duration share, hook type and overall pacing must match the analysis
- **Replace all content**: selling points and lines come from OUR product (per read_campaign Evidence) — copying more than one sentence of the original is a violation
- **Isolate the source**: the original brand and competitor names must never appear in the script
- All formatted-script hard constraints still apply (scene count, 0-3s hook, product = prop, closing CTA)
