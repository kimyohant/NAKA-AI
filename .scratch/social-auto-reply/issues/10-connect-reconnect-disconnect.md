---
id: 10
status: closed
labels: [ready-for-agent]
assignee: opencode
blocked_by: [7, 9]
---

# 10: Connect, Reconnect, Disconnect

Spec: `../spec.md` (sections "Account connection", "Frontend", "Config").

## What to build

The user Connects Facebook Pages with a Facebook login from the Accounts page, Reconnects one whose permission is gone, and Disconnects one they no longer want.

Flow:

1. The Accounts page asks the backend if Connect is possible for a Platform. It is not possible when `PUBLIC_BASE_URL` is not set, or when the app id or secret env var of that Platform is missing. The Connect button is then disabled, with a message that says why.
2. The user presses Connect. The backend makes a random `state` (single use, valid 10 minutes, kept in memory) and returns the login URL from the adapter's `getAuthUrl`. The redirect URI is `PUBLIC_BASE_URL` + `/api/v1/social/oauth/<platform>/callback`.
3. The Platform sends the browser back to the callback route. The backend checks the `state`, calls `exchangeCode`, keeps the list of connectable accounts with their tokens in server memory for 10 minutes, and sends the browser back to the Accounts page.
4. The Accounts page shows the list of Pages (name and avatar, never a token). The user ticks the ones to Connect. The backend saves each as a Social Account with the status `connected`.

Rules:

- A Social Account is matched by Platform + Platform account id. Connecting a Page that is already stored updates the same row (new tokens, status `connected`) and keeps the Brand Profile, settings, history, and Drafts. This is how Reconnect works, and how "Connect again after Disconnect" works.
- A new Social Account starts in Draft mode with Watching on.
- A wrong, used, or expired `state` is refused. The callback shows a clear error and saves nothing.
- If the server restarts while the list of Pages waits, the list is gone and the user logs in again.
- The pending list belongs to one login. A second login replaces nothing of another login's list.
- **Disconnect**: delete the stored tokens and set the status to Disconnected. Comments and Replies stay as history. The Facebook adapter has no revoke method, so no Platform call is made.
- **Reconnect**: a Reconnect needed Social Account shows a Reconnect button on the Accounts page and in the banner on the board. It runs the same login flow.
- No route returns a token.
- On the desktop app the Social pages show an empty state that says the feature works only on the server deployment. Use the "Connect is not possible" answer for this; do not add a new flag.

Also: add `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` to the README section about environment variables.

Tests use the fake adapter for the OAuth methods. No test calls Facebook.

## Acceptance criteria

- [x] A test shows "can Connect" is false with a reason when `PUBLIC_BASE_URL` is missing, and when the app id or secret is missing.
- [x] Unit tests show the `state` is single use and expires after 10 minutes.
- [x] A test shows the callback with a wrong `state` saves nothing.
- [x] A test shows the full flow with the fake adapter: start, callback, list of two accounts, tick one, one Social Account stored as `connected`.
- [x] A test shows the list of Pages returned to the browser contains no token.
- [x] A test shows the pending list is gone after 10 minutes.
- [x] A test shows Reconnect updates the same row and keeps the Brand Profile, settings, and Drafts.
- [x] A test shows Disconnect deletes the tokens, sets Disconnected, and keeps the Comments; a later Connect of the same Page brings the same row back.
- [x] A test shows a Disconnected Social Account is skipped by the Polling round.
- [x] The Accounts page has the Connect button (disabled with the reason when not possible), the list of Pages to tick, the Reconnect button, and Disconnect.
- [x] The token expired banner on the board has a Reconnect button.
- [x] The Social pages show the "server only" empty state when Connect is not possible and no Social Account exists.
- [x] The README lists the two new env vars.
- [x] `npm run typecheck` and `npm run test:social` pass in `backend/`.

## Notes

- 2026-10-08: Left open — blocked by ticket 09 (Facebook adapter, itself blocked by human ticket 01), which this ticket's Connect/Reconnect flow builds on. Starts once ticket 09 is merged. No code changes.
- 2026-10-08 opencode-delegation: not done, blocked by human ticket 01 (Facebook live check); relabeled ready-for-human
- 2026-10-08: Human ticket 01 is closed, so ticket 09 is unblocked. Relabeled ready-for-agent; still starts after ticket 09 (`blocked_by`).
- 2026-10-08 opencode (ticket/10-connect): done. Backend: new `backend/src/services/social/oauth.ts` (in-memory single-use 10-min state + per-login 10-min pending lists, can-connect reasons, hosted callback URL); routes in `backend/src/routes/social.ts` (can-connect, start, callback→302 to `/social/accounts?login=&platform=`, pending names+avatars only, save with Platform+id upsert, disconnect clears tokens→disconnected); fake adapter got scriptable `connectable`/`exchangeCalls` OAuth seam; new `backend/tests/social-connect.test.ts` (8 tests, all backend criteria incl. reconnect-keeps-data, disconnect-keeps-comments+same-row-back, disconnected-skipped poll, no-token sweep); `test:social` + CI list extended. Frontend: Accounts page Connect (disabled+reason), tick-list, per-account Reconnect/Disconnect, server-only empty state; board banner Reconnect button + server-only state; brand page server-only state; 15 new en/th strings. `npm run typecheck` pass, `npm run test:social` 104/104 pass, frontend `npm run build` pass. Deviations: none — poller already skipped non-connected accounts (added test only); README row already added by ticket 09, kept as-is.
