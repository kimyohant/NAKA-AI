---
type: workflow
title: Social Publishing and Inbox Replies
description: How sellers connect Facebook/Instagram through Meta OAuth, how scheduled clips are published with leases and never double-posted, and how the Meta webhook feeds an AI Inbox that drafts, guards and optionally auto-sends replies.
tags: [social, meta, instagram, facebook, inbox, webhook, ai-reply, r2]
verified:
  - by: openwiki/0.7.1
    at: 2026-10-07T08:08:50.062Z
sources:
  - id: openwiki-source-31f6922893222de4e0a65ab1
    resource: repo://src/inbox/draft.ts
  - id: openwiki-source-08eb12ff42bd345cff8776bd
    resource: repo://src/inbox/policy.ts
  - id: openwiki-source-cba0b37e8fa8154f3d83a2dd
    resource: repo://src/inbox/queue.ts
  - id: openwiki-source-0abf41152255034613cfec0e
    resource: repo://src/inbox/send.ts
  - id: openwiki-source-728b9d6830f6034d42f97dbe
    resource: repo://src/inbox/webhook.ts
  - id: openwiki-source-1b4eda48b46d21894a931699
    resource: repo://src/social/crypto.ts
  - id: openwiki-source-bdc3709652a5763a9b2ae072
    resource: repo://src/social/index.ts
  - id: openwiki-source-a39d9c30594dead27cfb22ff
    resource: repo://src/social/oauth.ts
  - id: openwiki-source-41da066c12752a5600fa7290
    resource: repo://src/social/posts.ts
generated: { by: "claude-code", at: "2026-10-07T08:08:50.062Z" }
---

# Social Publishing and Inbox Replies

<!-- openwiki: broken internal link [/openwiki/architecture/runtime-settings.md] link "/openwiki/architecture/runtime-settings.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
<!-- openwiki: broken internal link [/openwiki/architecture/background-processing.md] link "/openwiki/architecture/background-processing.md" is root-absolute, which no real consumer resolves against the repository root (not a coding agent reading the page, not GitHub's Markdown renderer, not a local viewer); use a path relative to this file instead. Fix the href or restore the target, then delete this comment. -->
Two features share one connection layer: the seller's Meta pages stored in `social_accounts`. Code is in `src/social/` and `src/inbox/`; both have their own tests (`src/social/tests/`, `src/inbox/tests/`). Both are gated by `FEATURE_SOCIAL` and `FEATURE_INBOX` ([Runtime Settings and Feature Flags](/openwiki/architecture/runtime-settings.md)), and both run from the minute cron ([Job Queue, Credits and Cron](/openwiki/architecture/background-processing.md)).

## Connecting accounts (`social/oauth.ts`, `crypto.ts`)

- `GET /api/social/meta/start` stores a hashed one-time `state` in `social_oauth_states` (10 minutes) and sets a matching cookie; the callback requires exactly one `state` value that matches the cookie and consumes the row with `DELETE … RETURNING`, bound to the signed-in user.
- The callback exchanges the code for a long-lived token, pages through `me/accounts` (and linked Instagram business accounts), upserts `social_accounts`, and subscribes pages to webhooks.
- Page tokens are **AES-GCM encrypted** with `SOCIAL_TOKEN_KEY` (32 bytes, base64) in `v1.<iv>.<ciphertext>` form. The AAD `["social-token-v1", user, platform, externalId]` stops ciphertext being moved between users, platforms or accounts. Disconnecting (`DELETE /api/social/accounts/:id`) blanks the token, sets `revoked`, and fails that account's queued posts in one batch. A Meta "revoked" error clears the token and sets the account to `error`.

## Publishing scheduled clips (`social/posts.ts`)

Uploads go to R2 (`MEDIA`) and `social_media`; **production has no R2 binding, so uploads and scheduling answer 503** until R2 is enabled. Scheduling needs the bucket, the token key, Meta config and an `https` `APP_ORIGIN`. A post must reference the user's own account and media (Instagram requires MP4), the caption is ≤ 2,200 characters, and `publishAt` is within 30 days. The insert itself is conditional on the account being active and unexpired.

`publishDuePosts` (cron, max 2 per tick):

1. **Recovery first.** Posts stuck in `publishing` past their lease are requeued, except a post whose `phase` is `publish_sent` (or out of attempts), which is **failed as `publish_outcome_unknown`** — it is quarantined rather than risk a duplicate public post.
2. **Claim** the oldest due queued post with a 180 s lease (`lease_id`, `attempts + 1`).
3. **Process.** Every state write (`checkpoint`) is fenced by `status = 'publishing' AND lease_id = ? AND lease_until > now`; a stale worker throws `lease_lost`. Instagram: create an unpublished Reels container (safe to retry), poll its `status_code` (up to 30 polls, one minute apart, not counted as attempts), then write `phase = publish_sent` and call `media_publish`. Facebook: write `publish_sent` then `POST videos` with the signed URL. A final publish is never retried automatically.
4. **Failure** requeues only if still in the safe `prepare` phase (or rate-limit rejected) and retryable, up to 5 attempts, with exponential backoff capped at one hour; otherwise `failed`. Users see a generic Thai failure message, not provider detail.

Meta fetches the clip through a signed link `/api/social/media/<key>`; that route is public (no session) but HMAC-signed with a key derived from `SOCIAL_TOKEN_KEY` via HKDF, and the router keeps it open even when `FEATURE_SOCIAL` is off so an in-flight post can finish.

## Meta webhook ingestion (`inbox/webhook.ts`, `events.ts`, `queue.ts`)

`/webhook/meta`:

- **GET** verification: requires `META_WEBHOOK_VERIFY_TOKEN`, a single `hub.mode=subscribe`, constant-time token compare, and a numeric challenge, which is echoed.
- **POST**: requires `META_APP_SECRET`; checks the `X-Hub-Signature-256` format, reads at most 256 KiB, verifies HMAC-SHA256 over the **original bytes**, then strict-UTF-8 decodes and parses. The raw body is stored in `inbox_webhook_receipts` keyed by its SHA-256 (`INSERT OR IGNORE`, so redelivery is idempotent) and only then acknowledged — a DB failure returns 503 so Meta retries. A background `drainInbox` is started immediately.

`drainInbox` (also in the cron) never calls an LLM: `processReceipts` turns stored receipts into threads/messages, and `enqueuePending` admits pending inbound messages to the job queue.

### Queue admission (`enqueuePending`)

Because `enqueueJob` and the inbox row cannot share a transaction, admission uses a lease: it first marks sends stuck `sending` for over 120 s as `uncertain` (and pauses the thread for a human), adopts orphan jobs by matching `enqueueToken`, and fails messages whose job ended without a draft. Candidates must belong to active users with an active, unexpired account, a non-`off` mode and an eligible plan. Each is claimed with a 60 s `queue_token`, then `enqueueJob` is called with **cost 0** and `countsTowardLimit: false` so inbox replies never consume the plan's parallel slots. Capacity or enqueue errors release or keep the token for safe retry.

## Drafting (`inbox/draft.ts`, `policy.ts`)

`makeInboxHandler` claims a message with a `draft_lock`, then:

- escalates **without calling the model** for built-in and per-shop keywords (refund, complaint, allergy… after NFKC normalisation), prompt-injection phrases, empty/attachment messages, bad timestamps, public comments containing private data (`publicSafe`), or an empty knowledge base (`knowledge_missing`);
- otherwise asks Claude (`claude-opus-5-5`, JSON-schema output) with the shop's `inbox_kb` entries (≤ 30) and the tone as **data, not instructions**. The system prompt forbids inventing prices or promises;
- post-checks the draft: public comments are redacted if unsafe, and any number in the reply that does not occur in the supplied facts becomes a handoff (`ungrounded_number`).

A handoff sets the thread to `needs_human` and `auto_paused`. Only when `mode = 'auto'`, no handoff, and confidence `high` does the handler call `sendReply`; `draft` mode leaves the draft for the seller to approve.

## Sending (`inbox/send.ts`)

`sendReply` is the irreversible boundary. It checks account validity, reply length (≤ 1,000 bytes), public-comment privacy, and the **24-hour DM window**. For automatic sends it re-checks that nothing changed since drafting (settings `revision`, thread revision, latest inbound message, not auto-paused). It then **claims** the message with one conditional `UPDATE` (`send_phase = 'sending'`) re-verifying the same conditions atomically, calls the Graph API, validates the returned ids, and records the outbound message. If the outcome cannot be confirmed (exception after the claim), the message becomes `uncertain` / `send_outcome_unknown` and the thread is paused for a human — there is **no automatic resend**. Manual approval by the seller also pauses auto mode on that thread.

Related: `docs/social-integration-status.md`, `docs/inbox-integration-status.md`.
