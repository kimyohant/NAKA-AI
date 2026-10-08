---
id: 8
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: [6, 7]
---

# 08: Read limits, Paused, and Reconnect needed

Spec: `../spec.md` (section "Poller").

## What to build

The Polling round stays inside the Platform's rate limits and reacts to errors by itself. A Social Account that hits the rate limit is Paused and continues later with no action from the user. One whose permission is gone becomes Reconnect needed. The user sees both on the Accounts page.

Read budget, per Social Account per round:

- At most 30 adapter read calls. The rest continue in the next round. The position is kept in memory; after a restart, reading starts again from the newest Post.
- The Post list is fetched once per hour, not every round.
- Every Post inside `watch_days` is read, newest Post first.
- Per Post: page until a Comment id that is already stored, or 10 pages, then stop.

Errors while reading:

- `unknown` on one Post: log it, skip that Post, continue with the next. The Social Account is not Paused.
- `auth_expired`: the Social Account becomes Reconnect needed.
- `rate_limited`: stop this Social Account for the round and pause it.

Paused (backoff):

- Pause for `retryAfterSec` when the Platform gives it. Otherwise 15 minutes, doubling each time, up to 1 hour.
- A round that finishes without a rate-limit error resets the step.
- Only that Social Account is Paused. The others keep working.
- The state lives in `paused_until` and `backoff_step` on the Social Account. No Redis.
- A `rate_limited` error while sending also pauses the Social Account.
- A Polling round skips a Social Account that is Paused, not `connected`, or not Watching.

Token refresh: before an adapter call, if the token expires within 10 minutes and the adapter has `refreshToken`, the core refreshes first and stores the new tokens. A failed refresh gives Reconnect needed. The Facebook adapter has no `refreshToken`; the rule is for later Platforms.

What the user sees:

- `last_polled_at` is set when a round finishes for a Social Account. The Accounts page shows "checked N minutes ago".
- When Paused, the Accounts page shows "paused until HH:MM".
- A Reconnect needed Social Account shows a warning badge on the Accounts page and a banner on the board. Its Drafts stay visible, and send is off for them. The Reconnect button itself comes in ticket 10.

No "check now" button and no polling history in the UI.

## Acceptance criteria

- [x] A test shows at most 30 read calls per Social Account per round, and the next round continues where the last one stopped.
- [x] A test shows the Post list is not fetched again inside one hour.
- [x] A test shows paging one Post stops after 10 pages.
- [x] A test shows an `unknown` error on one Post does not stop the other Posts and does not pause the Social Account.
- [x] Unit tests cover the backoff steps: 15 minutes, 30 minutes, 1 hour, stays at 1 hour, and `retryAfterSec` wins when given.
- [x] A test shows a good round resets the backoff step.
- [x] A test shows a Paused Social Account is skipped until `paused_until`, and another Social Account is still read in the same round.
- [x] A test shows `auth_expired` while reading gives Reconnect needed, and later rounds skip that Social Account.
- [x] A test shows `rate_limited` while sending pauses the Social Account and the Comment goes back to the state it came from.
- [x] A test with an adapter that has `refreshToken` shows a token that expires within 10 minutes is refreshed before the call, and a failed refresh gives Reconnect needed.
- [x] `last_polled_at` is set after a round, covered by a test.
- [x] The Accounts page shows "checked N minutes ago", "paused until HH:MM", and the Reconnect needed badge; the board shows the banner and send is off for those Drafts.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes (2026-10-08)

- New `backend/src/services/social/limits.ts`: read budgets (30 calls, 10 pages, 1h post cache), backoff (`retryAfterSec` wins else 15min doubling cap 1h, step reset on clean round), `markReconnectNeeded`, `ensureFreshToken` (<10min + adapter has `refreshToken`; failed refresh gives reconnect needed). No Redis.
- `poller.ts`: in-memory post cache + resume index per account (restart starts from newest post); per-post error mapping (`unknown` log+skip, `auth_expired` reconnect, `rate_limited` pause+stop); `last_polled_at` set for every attempted account; `__resetSocialPollerState` test hook.
- `actions.ts`: `rate_limited` send (queued + person) pauses the account and returns the comment to its prior state; sends stop after rate-limit/auth-expired; token refresh before sends; `sendQueuedReplies` returns `{ sent, rateLimited }`.
- Fake adapter: per-post comment failures, `failNext(kind, retryAfterSec?)`, refresh counters + `failRefresh`.
- Updated `social-auto.test.ts` (queued rate-limit now pauses) and `social-poll.test.ts` (post list cached) to the new specified behavior; added `social-limits.test.ts` (10 tests) to `test:social` and CI.
- Frontend: board reconnect banner + send disabled for those drafts (reject/close stay); accounts page "paused until" gated on active pause; `social.reconnectBanner` in en + th; `social-limits.test.mjs` (4 tests).
- Gates: typecheck clean; `test:social` 84/84; frontend 177/177; wide backend gate 283/284 (one unrelated base failure in `unsloth-image.test.ts`).
