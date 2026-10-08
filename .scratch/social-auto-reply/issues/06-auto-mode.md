---
id: 6
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: [5]
---

# 06: Auto mode

Spec: `../spec.md` (sections "Comment lifecycle", "Poller", "Send failure, by error kind", "Testing Decisions").

## What to build

A Social Account in Auto mode publishes easy Replies by itself. The gate is strict: only a `reply` Verdict, and only on a Comment at most 24 hours old.

In scope:

- When a Comment is judged `reply`: in Auto mode, and the Comment is at most 24 hours old, the state is `queued`. In Draft mode, or when the Comment is older, the state is `draft` (as today).
- A Fallback Reply is queued like any other `reply` Verdict.
- The Polling round, per Social Account, now runs in this order:
  1. Move `sending` rows older than 5 minutes to Needs human.
  2. Move `queued` Comments older than 24 hours to Draft.
  3. Read new Comments.
  4. Judge `new` Comments.
  5. Send `queued` Comments.
- The sending step: at most 10 Replies per Social Account per round, oldest first, 3 seconds apart. It uses the same atomic guard as a send by a person. `reply_source` is `auto`.
- Send failure from `queued`: `rate_limited` goes back to `queued`; `auth_expired` goes to `draft` and the Social Account becomes Reconnect needed; `not_found` goes to `skipped`, "deleted on the Platform"; `rejected` goes to `needs_human` with the Platform's message; `unknown` goes back to `queued`, up to 3 rounds, then `needs_human`.
- Changing the Reply Mode touches no stored Comment. Drafts that already wait keep waiting.
- Watching off: the round skips the whole Social Account, so `queued` Comments wait. Actions a person takes still work.
- The 3-second wait must be replaceable in tests, so the tests are fast.

The Reply Mode switch in the UI comes in ticket 07. In this ticket, tests set the Reply Mode in the database.

Also add the end-to-end test file from the spec: fake adapter, fake LLM, temporary SQLite file, two paths.

1. Draft mode: Comment in, Polling round, Verdict `reply`, state `draft`, approve, state `replied`.
2. Auto mode: Comment in, Polling round, state `queued`, sent, state `replied`.

## Acceptance criteria

- [x] The end-to-end test walks the Draft mode path and the Auto mode path, and runs in CI.
- [x] A test shows Auto mode queues only the Verdict `reply`: `human`, `unsure`, and `skip` are never queued or sent.
- [x] A test shows a `reply` Comment older than 24 hours becomes a Draft in Auto mode.
- [x] A test shows a `queued` Comment that became older than 24 hours becomes a Draft and is not sent.
- [x] A test shows a Comment that could not be judged is never sent.
- [x] A test shows at most 10 Replies are sent per Social Account per round, oldest first, and the rest stay `queued`.
- [x] Tests show each error kind from `queued` gives the result above, and `unknown` gives `needs_human` after 3 rounds.
- [x] A test shows switching to Auto mode does not send Drafts that already wait.
- [x] A test shows a Social Account with Watching off sends nothing, and a send by a person still works.
- [x] A test shows a published Reply has `reply_source` `auto`.
- [x] The Queued column of the board shows `queued` Comments.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes (2026-10-08)

Done. `responder.ts`: `reply` verdict → `queued` only in Auto mode with comment age ≤24h (`isAutoReplyEligible`), else `draft`. `actions.ts`: `expireQueuedComments` (poller step 2) + `sendQueuedReplies` (step 5, ≤10 oldest-first, `claimForSend`, `reply_source` `auto`, queued failure table, gap wait injectable). `poller.ts`: per-account order expire → read → judge → send; watching-off skip unchanged. `rate_limited` from queued returns to `queued` with no pause (pause is ticket 08). Frontend untouched: Queued column already exists (ticket 02). Gates: typecheck clean, `test:social` 74/74, full backend 272/274 with only the 2 known base failures.
