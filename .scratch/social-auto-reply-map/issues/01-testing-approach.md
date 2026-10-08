# Testing approach

Type: grilling
Status: resolved

## Question

How do we test Social Auto Reply (Facebook only) without calling Facebook in every test? Decide:

- The fake `SocialPlatformAdapter`: what it can be told to do (return these Comments, fail with this `SocialPlatformError` kind, be slow), and where it is registered.
- The one end-to-end check: which path it walks (for example: fake Comment in, Polling round, Verdict, Draft, approve, `replied`), and whether the LLM in it is real or faked.
- Which pieces need unit tests by name. The plain rules of the comment filter are already on this list (see [Thai test set for the Verdict prompt](../decisions.md#thai-test-set-for-the-verdict-prompt)); the never-reply-twice guard and the backoff steps are candidates.
- The live-API check left open by [Polling schedule and rate limits](../decisions.md#polling-schedule-and-rate-limits): can Facebook return the newest Comments first? Decide who runs it, when, and against which Page, now that the Meta app exists.
- Where the tests live and how they run, following the existing `backend/tests/*.test.ts` files.

## Answer

Resolved 2026-10-08 by grilling.

### Fake adapter

- It lives in the test folder only: `backend/tests/helpers/fake-social-adapter.ts`. A test registers it under the platform name `fake`. Production code never contains it.
- It is scripted. The test gives it Posts and Comments, and a queue of "the next call fails with this `SocialPlatformError` kind". It records every Reply it was asked to send.
- It has no "slow" option. A stuck `sending` is tested by writing a row with the state `sending` into the database.

### Real Facebook adapter

Tested against a local HTTP stub (the same way as `backend/tests/ai-live.test.ts`), never against Facebook. The test covers:

- list Comments: one page plus a cursor;
- `isOwn` is set;
- send a Reply;
- Graph API errors become the right `SocialPlatformError` kind (expired token, rate limit, Comment deleted);
- OAuth: `getAuthUrl`, and `exchangeCode` returns one account per Page.

### End-to-end check

One test file, fake adapter, fake LLM (replace `mastra.getAgent`, as `ai-live.test.ts` does), temporary SQLite file. It runs in CI. Two paths:

1. Draft mode: Comment in, Polling round, Verdict `reply`, state `draft`, approve, state `replied`.
2. Auto mode: Comment in, Polling round, state `queued`, sent, state `replied`.

The real LLM is not in this test. It is measured by `npm run eval:verdict`.

### Unit tests by name

1. Plain rules of the comment filter (own, already replied, no text, viewer-to-viewer).
2. Never-reply-twice guard: two sends at the same time give one Reply; a stuck `sending` goes to `needs_human`.
3. Backoff steps: 15 minutes doubling to 1 hour, and reset after a good call.
4. Round limits: 30 read calls, 50 judged Comments, 10 sent Replies.
5. Reply rules: 300 characters, one emoji, no URL/@handle/hashtag, and a rule break is a retry.
6. Error kind mapping: `auth_expired` gives Reconnect needed, `rate_limited` gives Paused, and the other kinds.
7. Auto mode gate: only Verdict `reply` and Comments at most 24 hours old are published.
8. OAuth `state`: single use, expires after 10 minutes.

Numbers 2 and 7 matter most: they are the ones that stop a wrong or double Reply.

### Route test

One backend route test: the API never returns tokens.

### Frontend

No frontend tests (the repo has none today) and no new test tool. The spec carries a manual checklist for the Kanban board.

### Live-API check (newest Comments first)

- It is the **first implementation ticket**, done before the Facebook adapter is written.
- A human creates a company test Facebook Page as a step of that ticket (none exists today). The same Page is used later to try real Replies.
- The dev runs `backend/scripts/social-fb-order-check.ts` by hand, once. It takes a Page token from an env var and only reads.
- The result is written in the ticket. If Facebook cannot return newest first, the adapter keeps the cursor of the last page it read (already decided in Polling schedule and rate limits).
- The spec does not wait for this result.

### Where the tests live and how they run

- Files: `backend/tests/social-*.test.ts`, using `node:test`.
- New npm script in `backend/package.json`: `test:social` = `tsx --test tests/social-*.test.ts`.
- The same files are added to the list in `.github/workflows/ci.yml`.

### Terms

No new terms for `CONTEXT.md`. No ADR.
