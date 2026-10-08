---
id: 3
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: [2]
---

# 03: Plain rules: Comments become Skipped

Spec: `../spec.md` (sections "Comment filter" and "Comment lifecycle").

## What to build

Before any LLM call, plain rules cut the Comments that need no answer. After this ticket, such Comments show in the Skipped column of the board with the name of the rule.

A Polling round now has a judging step after the reading step. In this ticket the judging step runs only the plain rules. A `new` Comment becomes `skipped`, with the rule name in the status note, when:

1. It is our own Comment (`isOwn`).
2. The Social Account already replied to it on the Platform (one of our own Comments has it as parent).
3. There is nothing to answer: after trimming, only emoji, punctuation, @mentions, or no text.
4. A viewer is replying to another viewer (the parent Comment is not ours).

A Comment that passes every rule stays `new` for ticket 04.

Also "answered outside our app": when a Polling round reads one of the Page's own Comments whose parent is a Comment we already stored, that stored Comment becomes `skipped` with "already replied on the Platform". This applies only when the stored Comment is `new`, `draft`, `queued`, or `needs_human`. A `replied` Comment never changes.

Details that matter:

- Short text like "555", "+1", "สนใจ", "ราคา?" is not cut by the rules.
- A viewer replying under our Reply is not viewer-to-viewer. It stays `new`.
- A Reply we published ourselves (its Platform id is stored on a Comment row) must not count as "answered outside our app" for that same row.

## Acceptance criteria

- [x] Unit tests cover each of the four rules, with a case that is cut and a case that is not.
- [x] Tests show "555", "+1", "สนใจ", and "ราคา?" stay `new`.
- [x] A test shows emoji-only, punctuation-only, @mention-only, and empty Comments become `skipped`.
- [x] A test shows a viewer answering under our own Comment stays `new`.
- [x] A test with the fake adapter shows a stored `draft` Comment becomes `skipped`, "already replied on the Platform", when the Page's own answer arrives in a later round.
- [x] A test shows a `replied` Comment does not change when our own Reply is read back from the Platform.
- [x] The status note holds the rule name, and the Skipped column of the board shows it.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes

### 2026-10-08

Done. Plain-rule judging step after the reading step: `new` Comments
matching a rule become `skipped` with the rule name as the status note;
everything else stays `new` for ticket 04.

Changed files:
- Backend: `src/services/social/filter.ts` (new: pure `judgePlainRule`,
  `isNothingToAnswer` keeps any letter/digit so short Thai/interest text
  passes, `collectPlainRuleContext`; notes `own comment`,
  `already replied on the Platform`, `no text to answer`,
  `reply to another viewer`), `src/services/social/poller.ts` (keeps every
  comment the Platform returned this round, judges `new` rows, marks stored
  `new`/`draft`/`queued`/`needs_human` rows `skipped` when an own comment
  arrives under them; `replied` never changes; stored `replyPlatformId`
  excluded), `package.json` (`test:social` adds the new file),
  `.github/workflows/ci.yml` (new file in the test list).
- Tests: `tests/social-filter.test.ts` (10 tests: unit per rule cut/not-cut,
  short-text keep, noise cut, under-our-reply stays new, fake-adapter rounds
  for draft-to-skipped and replied-unchanged, board route shows the note).
- Frontend untouched: the board already renders `statusNote` on Skipped cards.

Gates: `npm run typecheck` clean; `npm run test:social` 25/25 pass; full
backend suite 215 pass / 1 fail (only the known base failure
"unsloth image test probe"; the other known failure
"server masks saved keys" passed this run).

Deviations: none. Rule 2 and "answered outside our app" share the note
"already replied on the Platform", as the ticket text uses that wording for
both.
