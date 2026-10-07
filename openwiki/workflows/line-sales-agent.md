---
type: workflow
title: LINE Sales Agent and Admin Back Office
description: The original naka-ai product — a Claude-powered sales agent on a LINE Official Account with product search, stock-safe order creation, human handoff, plus the legacy admin REST endpoints and test chat.
tags: [line, agent, claude, orders, admin, legacy]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-dcc59514217eec36b993b9ec
    resource: repo://src/agent.ts
  - id: openwiki-source-70d4664310eebb80ab5b564c
    resource: repo://src/db.ts
  - id: openwiki-source-d1fbef09192ffbab6eff0bc2
    resource: repo://src/index.ts
  - id: openwiki-source-3f44f77d3e7f92940df2d5c0
    resource: repo://src/line.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# LINE Sales Agent and Admin Back Office

<!-- openwiki: broken internal link [/openwiki/architecture/data-model.md] link "/openwiki/architecture/data-model.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
This is the original product and is still live in the checkout, though it is no longer mentioned on public pages (see `CLAUDE.md`). Pieces: `src/line.ts` (LINE API client), `src/agent.ts` (Claude tool loop), `src/db.ts` (products, orders, conversations), and the `handleLineWebhook` / `handleLineEvent` / `handleAdmin` functions in `src/index.ts`. Storage is the legacy tables from `schema.sql` ([D1 Data Model and Migrations](/openwiki/architecture/data-model.md)).

## Inbound flow

1. `POST /webhook/line` reads the body with a 256 KiB cap (413 above it), verifies `x-line-signature` (HMAC-SHA256 of the raw body, base64, compared in constant time in `verifySignature`) against `LINE_CHANNEL_SECRET`, else 401.
2. If `FEATURE_LINE_BOT` is off it acknowledges `ok` and answers nothing.
3. Otherwise it returns `ok` immediately and handles each event in `ctx.waitUntil`; one failing event is logged by `errorSummary` and does not stop the others.
4. `handleLineEvent` only processes `message` events from 1:1 `user` sources that have a reply token. It loads the `conversations` row (fetching the LINE display name once).

Branches:

- **Human mode** — if an admin has taken over, the text is only appended to history for the dashboard; the bot does not answer.
- **Non-text message** — replies with a fixed Thai notice. An **image** is assumed to be a payment slip: the conversation is set to `human_mode` with a handoff reason so an admin verifies it.
- **Text** — shows the LINE typing indicator (30 s), runs `runSalesAgent`, saves the conversation, then `replyOrPush`.

`replyOrPush` replies with the token and falls back to a push message if the token expired; messages are split into at most five 5,000-character chunks. Only status codes are logged because LINE error bodies can echo customer text.

## The sales agent (`runSalesAgent`)

- Builds the model message list from stored history plus the new text and calls Claude (`claude-opus-5`, 25 s timeout, 1 retry, low effort, adaptive thinking, server-side fallback beta) with a cached system prompt: the Thai persona "นาคา", the shop name and `shop_info` policy text from the `settings` table, and rules (Thai chat style, no markdown, prices/stock **only** from tools, summarize and get confirmation before ordering).
- A loop of up to 6 rounds executes tool calls. Tools (strict schemas): `search_products`, `create_order`, `check_my_orders` and `handoff_to_human`.
- `handoff_to_human` sets `human_mode` and the reason on the in-memory conversation. A model refusal also hands off with a polite message.
- Tool errors are logged by class only and the model sees a generic Thai retry message, so provider or database messages never enter the conversation.
- It mutates `conv` (appending the user and assistant turns); the caller persists it.

## Orders and stock (`db.ts`)

`createOrder` validates items and quantities, reads current price and stock from active products (never from the model), then runs a single D1 batch: one `UPDATE … SET stock = stock - ? WHERE stock >= ?` per item plus the `INSERT INTO orders`. If any decrement changed no rows (a concurrent order took the stock), it compensates by restoring the decremented rows and deleting the order, returning an error the agent relays. `searchProducts` splits the query into at most 5 words and returns up to 30 active products; `ordersForUser` returns the latest 5.

`saveConversation` keeps only the last 20 history turns and trims leading assistant turns so history always starts with a user message.

## Admin back office (`handleAdmin`)

<!-- openwiki: broken internal link [/openwiki/workflows/authentication.md] link "/openwiki/workflows/authentication.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Reached under `/api/admin/*` after `checkAdmin` ([Authentication and Sessions](/openwiki/workflows/authentication.md)) and the newer admin handlers. Endpoints: products (list/create/update/delete), orders (list latest 200, status in `pending|paid|shipped|cancelled`), shop settings (only `shop_name` and `shop_info` may be written), conversations (list latest 100, toggle `human_mode`, send a manual `pushText` reply logged as `[แอดมิน]`), manual credit grants (positive integer amount) and balance/ledger view, and a **test chat** that runs the agent against a `test:admin` conversation without LINE. `public/chatbot/` just redirects to `/create/?workflow=bot`.

## Configuration

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/request-routing.md] link "/openwiki/architecture/request-routing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
`ANTHROPIC_API_KEY`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN` (see `.dev.vars.example`), and the `FEATURE_LINE_BOT` switch ([Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md)). The webhook route is described in [Worker Request Routing](/openwiki/architecture/request-routing.md).
