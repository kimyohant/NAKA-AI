---
id: 7
status: open
labels: [ready-for-agent]
assignee: null
blocked_by: [2]
---

# 07: Accounts page and Brand Profile page

Spec: `../spec.md` (sections "API", "Frontend", "Schema").

## What to build

The user sees every Social Account, changes its settings, and writes its Brand Profile. Connecting a new Social Account comes in ticket 10; in this ticket the Accounts page shows the Social Accounts that are already stored.

Routes:

- List Social Accounts: name, avatar, Platform, status, settings, token expiry time, `last_polled_at`, `paused_until`. Never a token.
- Update the settings of one Social Account: Reply Mode (`draft` / `auto`), Watching, watch days, reply to praise.
- Read and update the Brand Profile of one Social Account: About, Tone, FAQ, Forbidden topics, default language.

No route in the social route group may return an access token or a refresh token.

Brand Profile limits, checked by the backend: About 500, Tone 200, FAQ 3000, Forbidden topics 500 characters. All fields may be empty. The default language is Thai.

Pages, both linked from the inbox header:

- **Accounts page**: one card per Social Account with its status (connected / reconnect needed), the Reply Mode switch, Watching, watch days, reply to praise, and a link to its Brand Profile. Auto mode shows a short note about what it will and will not send: only `reply` Verdicts, only Comments at most 24 hours old, never complaints or Comments the LLM is unsure about. Empty state when there is no Social Account.
- **Brand Profile page**: an account picker and the five fields, each with its limit shown.

Disconnected Social Accounts are not shown as cards.

Follow the existing app style: default layout, existing design tokens and classes, the existing API composable. Register the pages the way the app registers its other pages. The UI strings are your choice.

## Acceptance criteria

- [ ] A route test shows that no social route response contains an access token or a refresh token, for a Social Account that has both stored.
- [ ] A test shows the settings update saves Reply Mode, Watching, watch days, and reply to praise, and refuses values that are not valid.
- [ ] A test shows the Brand Profile saves and reads back the five fields.
- [ ] A test shows each Brand Profile limit is enforced by the backend.
- [ ] A test shows a new Social Account defaults to Draft mode, watch days 7, reply to praise on, and default language Thai.
- [ ] The Accounts page shows a card per Social Account with the four settings, and saves a change.
- [ ] Turning on Auto mode shows the note about what it will and will not send.
- [ ] The Brand Profile page shows the five fields with their limits, for the picked Social Account.
- [ ] The links in the inbox header open the two pages.
- [ ] `npm run typecheck` and `npm run test:social` pass in `backend/`.
