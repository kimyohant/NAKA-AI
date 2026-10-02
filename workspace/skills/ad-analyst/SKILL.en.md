---
name: ad-analyst
description: Structural analysis of a reference ad from its transcript — mandatory sections and wording rules
---

# Reference Ad Analysis (Recreate Viral Ad)

## Core principles

1. **The only source is the transcript the user pasted** — the backend never fetches videos from TikTok/IG/YouTube. Anything the transcript does not contain = unknown; label it explicitly. **Never guess or fabricate.**
2. **Never copy more than one sentence of the original wording** — what you analyze is the "skeleton" (beat structure, pacing, strategy), not the text. At most one example sentence from the original may be quoted.
3. Brand/competitor names from the original **must not appear** in the analysis — refer to "the original product" or "the speaker".

## Mandatory sections (in this order, headings verbatim)

```
## Hook (0–3s)
Hook type (pain question / result first / counter-intuitive / price shock / identity call / etc.)
+ what the first 3 seconds used in words/imagery (paraphrased)

## Structure
Table: time | beat (hook/problem/demo/proof/offer/CTA) | what happens (visual + voice)
- When timing is uncertain, estimate and mark it as an estimate
- Skip beats that do not exist in the original

## Pacing & Format
Approximate total length · approximate shot/scene count · UGC or studio · talking head or not · cut rhythm

## Persuasion Levers
Why the ad works (social proof / scarcity / before-after / authority / price anchoring / etc.)
- Only claims the transcript supports — if absent write "the transcript does not cover this — cannot judge"

## CTA
CTA form (shop now / add to cart / follow / etc.) — paraphrased

## Reuse Template
A fill-in-the-blank skeleton reusable for any product, e.g.
- Hook: [3-second question/offer about <our product's main pain point>]
- Beat 2: [show problem] → Beat 3: [demonstrate product] → ... → CTA: [closing command]
```

## Never do

- Do not invent view counts, sales figures, or prices unless the user wrote them in notes
- Do not turn praise of the original brand into a reproduction of its copy tone
- Never skip calling `save_reference_analysis` — an analysis that stays in your head is not saved
