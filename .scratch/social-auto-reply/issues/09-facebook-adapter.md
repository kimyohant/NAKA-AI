---
id: 9
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: [1, 2]
---

# 09: Facebook adapter

Spec: `../spec.md` (sections "Social platform adapter", "Facebook adapter", "Testing Decisions"). Facts about the Graph API: `.scratch/social-auto-reply-map/decisions.md`, "Facebook comment API facts".

## What to build

The real `SocialPlatformAdapter` for Facebook, registered under the Platform name `facebook`. After this ticket, the core can read the Comments of a Facebook Page and publish a Reply, with no change to the core.

**Read the Notes of ticket 01 first.** They say if Facebook can return the newest Comments first, and how a Comment carries its author and parent. If Facebook cannot return newest first, the adapter keeps the cursor of the last page it read instead; the core does not change.

In scope:

- `listPosts`: the Posts of the Page since a date, one page plus a cursor.
- `listComments`: the Comments of a Post, including nested ones, each with its parent id, one page plus a cursor. `isOwn` is true when the author is the Page.
- `reply`: publish a Reply under a Comment and return the Platform's reply id.
- `getAuthUrl`: the Facebook login URL with the redirect URI, the `state`, and the permissions `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`.
- `exchangeCode`: trade the code for a user token (this needs the app secret), list the Pages, and return one connectable account per Page with its own Page token. The user token is not returned and not stored.
- No `refreshToken` method: Page tokens do not expire.
- Capabilities: `canReply` true, `needsPublicCallback` true, and a `maxReplyChars` value you choose from the Facebook limit.
- Errors: every failure is thrown as `SocialPlatformError`. Facebook error 190 is `auth_expired`. The rate-limit errors (32 and 80001 to 80014) are `rate_limited`, with `retryAfterSec` when Facebook gives a wait time. A deleted Post or Comment is `not_found`. A refused Reply text is `rejected`. Anything else is `unknown` and keeps the raw Facebook message.
- The app id and secret come from the env vars `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`. Add placeholders to the backend example env file.
- The adapter is built with an injectable `fetch` and a base URL that a test can point at a local server.

Tests run against a local HTTP stub, the same way as the AI Live test. Never against Facebook.

## Acceptance criteria

- [x] A stub test shows `listPosts` returns one page of Posts plus a cursor, and passes the cursor on the next call.
- [x] A stub test shows `listComments` returns one page plus a cursor, with the parent id of a nested Comment.
- [x] A stub test shows `isOwn` is true for a Comment written by the Page and false for a viewer.
- [x] A stub test shows `reply` posts the text under the right Comment and returns the reply id.
- [x] Stub tests show the error mapping: expired token to `auth_expired`, rate limit to `rate_limited`, deleted Comment to `not_found`, refused text to `rejected`, another error to `unknown` with the raw message.
- [x] A test shows `getAuthUrl` contains the app id, the redirect URI, the `state`, and the four permissions.
- [x] A stub test shows `exchangeCode` returns one account per Page, each with its own Page token, and does not return the user token.
- [x] The registry returns the adapter for `facebook`, also for a name in another letter case.
- [x] The ordering path matches the result in the Notes of ticket 01, and the Notes of this ticket say which path was built.
- [x] No test calls a real Facebook address.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes

- 2026-10-08: Left open — blocked by ticket 01 (`ready-for-human`: live Facebook API check), which has no Notes result yet. This ticket's ordering path depends on the ticket 01 answer ("newest first" vs "keep the cursor"), so implementation cannot start until a human completes ticket 01. No code changes.
- 2026-10-08 opencode-delegation: not done, blocked by human ticket 01 (Facebook live check); relabeled ready-for-human
- 2026-10-08: Unblocked — ticket 01 is closed with its Notes result ("newest first" path: `order=reverse_chronological&filter=stream`; `isOwn` compares with the `GET /me` id). Relabeled ready-for-agent.
- 2026-10-08: Implemented (ticket/09-facebook-adapter). New `backend/src/services/social/facebook.ts`: `FacebookAdapter` (`platform: 'facebook'`, capabilities `canReply: true, needsPublicCallback: true, maxReplyChars: 8000` from the Facebook comment limit; no `refreshToken`), self-registers a singleton and is imported by `backend/src/index.ts` so production resolves it. Ordering path built: **newest-first** per ticket 01 — `listComments` always sends `order=reverse_chronological&filter=stream` (asserted in stub test); `isOwn` compares `from.id` with `platformAccountId`, which `exchangeCode` sets to the per-Page `GET /me` id (falls back to the accounts-list id if `/me` fails). Error mapping: 190→`auth_expired`; 32/80001–80014→`rate_limited` (`retryAfterSec` from `error_data.retry_after[_sec]` or the `retry-after` header when present); 100+subcode 33 / deleted-or-missing message→`not_found`; 368 (or 100 about message/text/spam/block)→`rejected`; else `unknown` keeping the raw message. `exchangeCode` keeps the user token in a local only and returns one account per Page with its Page token. New `backend/tests/social-facebook.test.ts` (11 tests, local HTTP stub only, no real Facebook address); added to `test:social` in `backend/package.json` and the CI test list. `backend/.env.example` placeholders already existed, no change needed; `README.md` env-var table gained the `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` line per the spec Config section. `npm run typecheck` passes; `npm run test:social` passes (96 tests, 0 fail). No core changes; tickets 10/12/13 and `openwiki/` untouched.
- 2026-10-08: Done — built the "newest first" path per ticket 01. New `backend/src/services/social/facebook.ts` (`FacebookAdapter`, registered as `facebook`; injectable `fetch` + base URL + Graph version; no `refreshToken`; capabilities `canReply` true, `needsPublicCallback` true, `maxReplyChars` 8000). `listPosts` reads `/{pageId}/feed` with `since`; `listComments` reads `/{postId}/comments` with `order=reverse_chronological&filter=stream`, `isOwn` compares `from.id` with the `GET /me` id stored as `platformAccountId` at connect time (one extra `/me` call per Page in `exchangeCode`, falls back to the accounts-list id); `reply` posts to `/{commentId}/comments`. Errors: 190 → `auth_expired`; 32 and 80001–80014 → `rate_limited` (`retryAfterSec` from `Retry-After` header, else `error_data`); 100 + deleted/missing message or 803 → `not_found`; 368 (or 100 + refusal message) → `rejected`; else `unknown` with raw message. `getAuthUrl` asks the four permissions. Tests in `backend/tests/social-facebook.test.ts` (11 tests, node:test, local HTTP stub only, no real Facebook call); added to `test:social` and CI. `backend/.env.example` already had the `FACEBOOK_APP_ID`/`SECRET` placeholders; added the two rows to the README env table. Wiring: one side-effect import in `backend/src/index.ts`. Verified: `npm run typecheck` passes, `npm run test:social` passes (96/96). Deviation: `exchangeCode` does not do the long-lived user-token exchange from the research notes (ticket scope is code → user token → Pages); without it Page tokens inherit the short-lived user-token expiry, so ticket 10 or a follow-up should add `grant_type=fb_exchange_token` before production use. Core untouched (only the index.ts import line).
