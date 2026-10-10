---
id: 13
status: open
labels: [ready-for-human]
assignee: null
blocked_by: [8, 10]
---

# 13: Manual check on the test Page

Spec: `../spec.md` (section "Testing Decisions", "Frontend").

## What to build

Nothing new. A person walks the whole feature on the server deployment with the company test Facebook Page from ticket 01, because the repo has no frontend tests and no test calls the real Facebook.

Set `PUBLIC_BASE_URL`, `FACEBOOK_APP_ID`, and `FACEBOOK_APP_SECRET` on the server first. The person who logs in must have a role on the Meta app.

Do not turn on Auto mode on a real company Page in this ticket. Use only the test Page. Auto mode on a real Page waits for the passing report of ticket 12.

Write every failed item in the Notes, and open a new ticket for each real bug.

## Acceptance criteria

- [ ] The sidebar shows Social; `/social` opens.
- [ ] With no `PUBLIC_BASE_URL` or no Facebook env vars, Connect is disabled and says why.
- [ ] Login shows the list of Pages; ticking two makes two Social Accounts.
- [ ] No account yet and no Comments yet show their empty states.
- [ ] A new Comment on the test Page shows up on the board within about 5 minutes.
- [ ] Each of the five columns shows the right cards; the account filter and the "not in FAQ only" filter work.
- [ ] Draft card: approve publishes the Reply on Facebook and the card moves to Replied.
- [ ] Draft card: edit, then send, publishes the edited text.
- [ ] Draft card: reject moves it to Skipped with "rejected by user".
- [ ] Needs human card: write a Reply and send; "help me draft" fills the box and publishes nothing; "do not reply" moves it to Skipped.
- [ ] Skipped card: shows the reason; "bring back" moves it to Needs human.
- [ ] A Fallback Reply shows the "not in FAQ" badge.
- [ ] Reply Mode switch: Auto shows the note; a new easy Comment is answered without a person; Drafts that already waited are still Drafts.
- [ ] Watching off: no new Comments arrive; sending a Draft by hand still works.
- [ ] Answer a Comment directly on Facebook: its card moves to Skipped, "already replied on the Platform".
- [ ] Reconnect needed (remove the app from the Page): banner and Reconnect button show; Drafts are visible but cannot be sent; Reconnect brings them back with the Brand Profile unchanged.
- [ ] Disconnect: the Social Account is gone from polling; old cards stay.
- [ ] Brand Profile: the five fields save; the limits are enforced.
- [ ] The Accounts page shows "checked N minutes ago".
- [ ] Load failed and send failed states show when the backend is stopped or the send fails.
- [ ] On the desktop app, `/social` shows the "server only" empty state.
- [ ] No response in the browser network tab contains an access token.
