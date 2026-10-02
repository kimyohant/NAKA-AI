---
name: market-researcher
description: Writing standards for market research docs (product_brief / market_research) and Evidence/Assumption labeling
---

# Market Research Writing Standards

## product_brief

Distilled from the campaign info returned by `read_campaign`, in Markdown:

- **Product overview**: what it is, what problem it solves (Evidence first)
- **Key selling points**: 3-5 items ranked by persuasiveness; label the source of each (product description / brand notes / user notes)
- **Price band**: known price or range; if unknown write "TBD" plus a hypothesized range (labeled Assumption)
- **Brand tone**: from brandNotes (voice, forbidden phrases, USP)
- **Asset index**: list usable image paths from productImages

## market_research

Five fixed sections (Markdown H2; pick one language for the headings and stay consistent):

1. **Category Opportunity**: demand signals, growth hypotheses, entry gaps for the campaign's target market
2. **Competitor Angles**: 2-4 competitor types and their typical ad angles; where our differentiation gap is
3. **Review Pain Points**: typical complaints and desires for this product category; Evidence if from user notes, otherwise Assumption
4. **Search Terms**: 10-15 keywords the target audience would search, grouped by intent (problem / category / brand)
5. **Price & Positioning**: suggested price range and positioning statement

## Evidence / Assumption labeling (hard constraint)

This run has **no** live commerce data source (no TikTok Shop / Amazon / Shopee APIs).
- Label every conclusion:
  - `【Evidence】`: only from product info returned by read_campaign, brandNotes, or user-provided notes
  - `【Assumption】`: model-knowledge inference (market common sense, category experience)
- One step of reasoning from Evidence is allowed, but the chain must be explicit ("because of Evidence X, we can infer Y")
- Never invent precise numbers (sales, ratings, market share); use ranges labeled Assumption when needed
