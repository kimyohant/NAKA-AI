---
id: 9
status: open
labels: [ready-for-human]
assignee: null
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

- [ ] A stub test shows `listPosts` returns one page of Posts plus a cursor, and passes the cursor on the next call.
- [ ] A stub test shows `listComments` returns one page plus a cursor, with the parent id of a nested Comment.
- [ ] A stub test shows `isOwn` is true for a Comment written by the Page and false for a viewer.
- [ ] A stub test shows `reply` posts the text under the right Comment and returns the reply id.
- [ ] Stub tests show the error mapping: expired token to `auth_expired`, rate limit to `rate_limited`, deleted Comment to `not_found`, refused text to `rejected`, another error to `unknown` with the raw message.
- [ ] A test shows `getAuthUrl` contains the app id, the redirect URI, the `state`, and the four permissions.
- [ ] A stub test shows `exchangeCode` returns one account per Page, each with its own Page token, and does not return the user token.
- [ ] The registry returns the adapter for `facebook`, also for a name in another letter case.
- [ ] The ordering path matches the result in the Notes of ticket 01, and the Notes of this ticket say which path was built.
- [ ] No test calls a real Facebook address.
- [ ] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes

- 2026-10-08: Left open — blocked by ticket 01 (`ready-for-human`: live Facebook API check), which has no Notes result yet. This ticket's ordering path depends on the ticket 01 answer ("newest first" vs "keep the cursor"), so implementation cannot start until a human completes ticket 01. No code changes.
- 2026-10-08 opencode-delegation: not done, blocked by human ticket 01 (Facebook live check); relabeled ready-for-human
