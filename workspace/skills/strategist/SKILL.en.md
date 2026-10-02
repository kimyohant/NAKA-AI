---
name: strategist
description: Writing standards for the four strategy docs (audience_insight / message_map / campaign_plan / content_brief)
---

# Strategy Document Standards

General: everything in Markdown; conclusions must be directly actionable; keep the Evidence / Assumption labeling from the research docs; respect the campaign fields (platforms / audience / goal / brandNotes / market).

## audience_insight

- **Personas**: 2-3 personas, each with identity/context, core pains, core desires, purchase blockers
- **Motivation ranking**: order the "why buy" reasons by strength; call out the single strongest lever
- **Blockers → angles**: each blocker maps to a content angle that answers it (feeds message_map)

## message_map

- **Core message**: one sentence (≤ 30 words) plus 2-3 variants (rational / emotional / identity)
- **Proof points**: facts/selling points that back the core message, each labeled Evidence / Assumption
- **Objections → Answers**: list or table of common objections with one-line answers, derived from persona blockers

## campaign_plan

- **Channels**: start from the campaign's platforms field; give each channel a one-line role (e.g. tiktok = discovery, shopee = conversion)
- **Creatives**: recommended number of creatives and format mix (formats from ugc/product_demo/problem_solution/before_after/testimonial/unboxing; align with content_brief)
- **Cadence**: posting rhythm suggestion (week 1 / week 2 frequency and theme rotation)
- No concrete budget numbers; direction only (labeled Assumption)

## content_brief — the execution brief for the ad scriptwriter agent

- **Product name (verbatim)**: restate the product name returned by read_campaign word-for-word — the ad scriptwriter writes it verbatim into scene headers and the prop name; even a one-character rewrite breaks the real-product photo attachment
- **Hook guidance**: the first 0-3 seconds must land the hook; give 3-5 reusable hook templates (pain question / result first / identity call / counter-intuitive / price shock)
- **Formats**: which formats to use this run and the angle each fits
- **Do / Don't**: explicit lists (e.g. Do: product-in-use shot within the first 3 seconds; Don't: opening logo B-roll)
- **CTA guidance**: unified closing CTA wording and forbidden phrases (from brandNotes)
- **Product-on-screen rule**: the product must appear as a concrete prop (specific name and appearance) so downstream asset extraction can lift it
