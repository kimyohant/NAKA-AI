---
id: 5
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: [4]
---

# 05: A person acts on a Comment

Spec: `../spec.md` (sections "Comment lifecycle", "Never reply twice", "Send failure, by error kind", "API", "Frontend").

## What to build

The user works the board: approve or edit a Draft, write a Reply to a Needs human Comment, reject, close, or bring a Comment back. Sending publishes the Reply through the adapter, and a Comment never gets two Replies from us.

Card actions on the board, with a route behind each:

- **Draft card**: approve (send the stored text), edit then send, reject (to `skipped`, "rejected by user").
- **Needs human card**: write a Reply and send, "help me draft", "do not reply" (to `skipped`, "closed by user").
- **Skipped card**: bring back (to `needs_human`; it is not judged again).

Rules:

- `reply_source` is `approved` when the stored LLM text is sent unchanged, and `manual` when a person wrote or edited the text. Only the final text is stored.
- A Reply sent by a person must pass the adapter's `maxReplyChars`. The 300-character rule and the emoji and link rules are for LLM text only.
- "Help me draft" calls `social_responder` with `mode: "draft"`. It returns the text to the browser and fills the text box. It saves nothing and publishes nothing, and the stored Verdict does not change.
- Send is refused when the Social Account is not `connected`. The Draft stays visible.

Never reply twice:

1. Before the adapter call, one atomic update moves the row to `sending` and names the state it expects. Only the caller that changed the row may send.
2. On success the row becomes `replied`, with the Reply text, the Platform's reply id, and the time.
3. A row left in `sending` for more than 5 minutes is never retried. The first step of a Polling round moves it to `needs_human` with "send not confirmed, check on the Platform".

Send failure for a send by a person, by error kind:

| Kind | Result |
|---|---|
| `rate_limited` | Back to the state it came from; the error is shown |
| `auth_expired` | `draft`; the Social Account becomes Reconnect needed |
| `not_found` | `skipped`, "deleted on the Platform" |
| `rejected` | `needs_human`, with the Platform's message in the status note |
| `unknown` | Back to the state it came from; the error is shown |

The card shows a send failed note with "send again" and "do not reply".

How a Draft is edited inside a card (inline or dialog) is your choice. The UI strings are your choice.

## Acceptance criteria

- [x] A test with the fake adapter shows approve publishes the stored text once, and the Comment becomes `replied` with `reply_source` `approved` and the Platform reply id.
- [x] A test shows an edited Draft and a hand-written Reply are published with `reply_source` `manual`.
- [x] A test shows two sends of the same Comment at the same time give exactly one Reply at the fake adapter.
- [x] A test shows a `sending` row older than 5 minutes becomes `needs_human` with "send not confirmed, check on the Platform", and no Reply is sent for it.
- [x] Tests show reject, "do not reply", and bring back make the transitions and notes listed above.
- [x] A test shows a brought-back Comment is not judged again by the next Polling round.
- [x] Tests show each of the five error kinds gives the result in the table.
- [x] A test shows send is refused for a Social Account that is not `connected`.
- [x] A test shows "help me draft" returns a text, changes no row, and sends nothing.
- [x] A test shows an action on a Comment in the wrong state is refused (for example approve on a `replied` Comment).
- [x] The board shows the actions for each state, and a card moves to its new column after an action.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes (2026-10-08)

Done. New `backend/src/services/social/actions.ts` (`sendCommentAsPerson`,
`claimForSend`, `rejectDraft`, `closeComment`, `bringBackComment`,
`reclaimStuckSending`, `helpMeDraft`) + routes
`POST /comments/:id/{approve,send,reject,close,bring-back,help-draft}`;
poller reclaims stuck `sending` as its first step. Send failures store
`send failed: <msg>` so the card shows send-again / do-not-reply, except
`not_found` (skipped, "deleted on the Platform") and `rejected`
(needs_human with the Platform message); `auth_expired` goes to draft and
the account becomes reconnect_needed. Board cards: draft inline
approve/edit/reject, needs_human editor + help-me-draft + do-not-reply,
skipped bring-back. Gates: typecheck clean, `test:social` 58/58
(new `social-actions.test.ts` 12/12), frontend 173/173, full backend suite
clean except the known base failure "unsloth image test probe" (verified it
fails on the base commit too).
