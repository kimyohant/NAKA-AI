---
id: 2
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: []
---

# 02: Comments from a fake Platform show on `/social`

Spec: `../spec.md` (sections "Social platform adapter", "Schema", "Poller", "Frontend", "Testing Decisions").

## What to build

The first thin path through every layer. A test gives a fake Platform some Posts and Comments, a Polling round reads and stores them, and the user sees them as cards on a Kanban board at `/social`.

In scope:

- The three tables (`social_accounts`, `social_posts`, `social_comments`) with every column the spec lists, in the idempotent startup DDL and in the Drizzle definitions. Add all columns now, so later tickets do not change the schema.
- The `SocialPlatformAdapter` interface, the shared types, `SocialPlatformError` with its five kinds, and the registry with lookup by Platform name. Use the type shapes in the spec. A test must be able to register an extra adapter. No real Platform is registered in this ticket.
- The scripted fake adapter, in the test helpers only, registered as Platform `fake`. The test gives it Posts and Comments and a queue of "the next call fails with this error kind". It records every Reply it was asked to send.
- The poller: one timer started at backend boot, a round every 5 minutes, first round right after boot, with a "round is running" guard, built like the existing generation queue sweep. In this ticket a round does only the reading step: for each Social Account that is `connected` and Watching, list the Posts inside `watch_days`, page the Comments of each Post until a Comment id that is already stored, and store new Comments with the state `new`. The round can be called directly from a test.
- A route that lists Comments for the board, with filters for account and "not in FAQ". It returns the Comment, its Post text, its state, Verdict, reason, fallback flag, status note, and Reply fields.
- A "Social" item in the sidebar and the inbox page at `/social`: a Kanban board with five columns (Needs human, Draft, Queued, Replied, Skipped). One card per Comment: Platform tag, author, age, Comment text, the Reply if there is one, the "not in FAQ" badge, and the status note. No action buttons yet. Header: account filter, "not in FAQ only" filter, and links to the Accounts page and the Brand Profile page (the pages come in ticket 07).
- Empty and error states on the board: no account yet, no Comments yet, load failed.
- The backend npm script `test:social`, and the `social-*` test files added to the CI test list.

Follow the existing app style: default layout, existing design tokens and classes, the existing API composable, no UI framework. The UI strings are your choice (Thai or English, like the pages around it).

Comments in the state `new` are not shown in any column. That is expected until ticket 03 and 04.

## Notes

### 2026-10-08

Done. Thin path through every layer: fake `fake` adapter -> poll round ->
SQLite -> board route -> `/social` Kanban.

Changed files:
- Backend: `src/services/social/types.ts` (adapter interface, shared types,
  `SocialPlatformError` + 5 kinds), `src/services/social/registry.ts`
  (lowercased lookup, `Unsupported social platform: <name>`),
  `src/services/social/poller.ts` (5-min unref'd timer, first round at boot,
  running guard, reading step only), `src/routes/social.ts`
  (`GET /comments` with `account_id` + `fallback_only`, `GET /accounts`
  without tokens), `src/db/schema.ts` + `src/db/sqlite-schema.ts` (all three
  tables, all spec columns), `src/index.ts` (mount + poller start),
  `package.json` (`test:social`), `.github/workflows/ci.yml` (social files).
- Tests: `tests/helpers/fake-social-adapter.ts` (seedable posts/comments,
  fail queue, sent-reply log, page size 2), `tests/social-poll.test.ts`
  (10 tests), `tests/social-board.test.ts` (5 tests).
- Frontend: `app/pages/social.vue` (5-column board, 2 filters, links to
  `/social/accounts` + `/social/brand`, 3 empty/error states, `new` hidden),
  sidebar Social item, `socialAPI`, `social` locale keys (th/en),
  `tests/social-structure.test.mjs` (8 tests).

Gates: `npm run typecheck` clean; `npm run test:social` 15/15 pass; full
backend suite 204/206 (only the 2 known base-commit failures:
server-security-recovery EPERM cleanup, unsloth-image probe pattern);
frontend `node --test tests/*.test.mjs` 160/160 pass.

Deviations: seeding lives in a `seed accounts and fake platform data` test
(module-level seeding would break the empty-backend test); the guard test
also registers a `blocking` adapter; `GET /accounts` added (board filter
needs it, tokens never returned); paused accounts are skipped too, per the
spec Poller section (ticket 08 owns the rest).

## Acceptance criteria

- [x] The three tables are created at startup on an empty database, and startup can run twice without an error.
- [x] (`account_id`, `platform_comment_id`) is unique: a test shows that two Polling rounds over the same Comments store each Comment once.
- [x] A test with the fake adapter shows: a Polling round stores the Posts and Comments of a `connected`, Watching Social Account, with the state `new`.
- [x] A test shows a Social Account that is not `connected` or not Watching is not read.
- [x] A test shows paging stops at the first Comment that is already stored.
- [x] Looking up an unknown Platform throws `Unsupported social platform: <name>`.
- [x] The fake adapter exists only in the test folder. Production code does not import it.
- [x] The board route returns Comments filtered by account and by "not in FAQ", covered by a test.
- [x] `/social` opens from the sidebar and shows the five columns, the two filters, and the three empty and error states.
- [x] A round that starts while another is running is skipped, and a backend with no Social Account starts and runs rounds without errors.
- [x] Tests use a temporary SQLite file and `node:test`, like the AI Live test.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`, and CI runs the `social-*` test files.
