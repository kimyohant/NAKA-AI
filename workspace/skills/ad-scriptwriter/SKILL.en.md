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

- Scene header: `## S编号 | 内景/外景 · 地点 | 时间段`
- Action has no camera language (no "close-up", no "dolly in")
- Dialogue: `角色名：（状态/表情）台词内容`; narration is written as `旁白：内容`

## Content rules

- **Hook in 0-3 seconds**: the first line of scene 1 is the hook (pain question / result first / counter-intuitive / price shock); exposition comes after
- **Product = prop**: write the product into action paragraphs with a specific name and concrete appearance — held, used, or displayed on screen — so the extractor lifts it as a prop and the storyboard can give it close-ups. **The product name must exactly match the campaign's Product field** (no rewriting, translating, or shortening): the system pre-attaches real product photos to the prop by this exact name, and a mismatched name means the reference photos cannot be attached
- **Total duration matches durationSec**: all scenes combined ≈ durationSec; a single scene is 15-60 seconds, split when longer
- **CTA**: the last 3-5 seconds land on the cta (when provided)
- Shootable content only; no meta commentary like "product benefits are shown here"
