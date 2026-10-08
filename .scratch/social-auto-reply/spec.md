# Spec: Social Auto Reply on Facebook

Status: ready-for-agent

Source: the wayfinder map at `.scratch/social-auto-reply-map/map.md` and its decisions (`decisions.md`, `issues/01-testing-approach.md`). Every decision below was made there. When this spec and a decision disagree, the decision wins and this spec has a bug.

Words with a capital letter (Platform, Social Account, Post, Comment, Reply, Draft, Verdict, ...) are defined in the root `CONTEXT.md`. Use them the same way in code, tickets, and UI.

## Problem Statement

Our company publishes Posts on several Facebook Pages. Viewers leave Comments on those Posts: questions about price and delivery, praise, spam, and sometimes complaints. Today a person has to open each Page, read every Comment, and type every Reply by hand. This is slow, Comments are missed, and questions that have a known answer wait for hours.

The team wants the easy Comments answered quickly and in the voice of the brand, without the risk that a machine answers a complaint, invents a price, or answers the same Comment twice.

## Solution

A new page, **Social**, in the app. The user Connects Facebook Pages with a Facebook login. Each Page becomes a Social Account with its own Brand Profile (who we are, how we talk, the facts we may state, the topics we never talk about).

Every 5 minutes the app reads new Comments on the recent Posts of each Watching Social Account. For each Comment it decides a Verdict: reply, skip, or send to a person. When the Verdict is `reply`, an LLM writes a short Reply in the language of the Comment.

- In **Draft mode** (the default) the Reply waits as a Draft. A person approves, edits, or rejects it.
- In **Auto mode** the app publishes the Reply by itself, but only for a `reply` Verdict on a Comment at most 24 hours old.

Complaints, sensitive topics, and Comments the LLM is not sure about always go to a person. The user works from one Kanban board that shows every Comment by state: Needs human, Draft, Queued, Replied, Skipped.

The MVP works only on the server deployment and only for Facebook. On the desktop app the Social page shows an empty state that says so.

## User Stories

### Connect

1. As a social media manager, I want a Social item in the sidebar, so that I can find the feature.
2. As a social media manager, I want to Connect Facebook Pages with a Facebook login button, so that I do not copy tokens by hand.
3. As a social media manager, I want to see the list of my Pages after login and tick the ones to Connect, so that only the Pages I choose are read.
4. As a social media manager, I want to Connect several Pages in one login, so that setup is fast.
5. As a social media manager, I want each Page to be its own Social Account, so that each one has its own settings and Brand Profile.
6. As a social media manager, I want the Connect button to be disabled with a message that says why when the server is not set up (no public address, or no Facebook app id and secret), so that I know what to ask the admin.
7. As a desktop app user, I want the Social page to tell me the feature works only on the server deployment, so that I do not look for a missing button.
8. As a social media manager, I want to see a warning badge and a Reconnect button when a Social Account is Reconnect needed, so that I can fix it.
9. As a social media manager, I want Reconnect to keep my Brand Profile, settings, history, and Drafts, so that I lose nothing.
10. As a social media manager, I want to Disconnect a Social Account, so that the app stops acting as that Page.
11. As a social media manager, I want old Comments and Replies to stay as history after Disconnect, so that I can still read them.
12. As a social media manager, I want a Social Account I Connect again after Disconnect to come back with its old Brand Profile and Drafts, so that I do not set it up twice.
13. As a server admin, I want the Facebook app id and secret to come from env vars, so that secrets are not in the database or the UI.
14. As a server admin, I want the API to never return a token, so that a token cannot leak through the browser.

### Brand Profile

15. As a social media manager, I want to write an About text for each Social Account, so that Replies know who we are and what we sell.
16. As a social media manager, I want to set the Tone, including the Thai ending word, so that Replies sound like our brand.
17. As a social media manager, I want to write an FAQ with prices, delivery, opening hours, and how to order, so that the LLM states only facts I gave it.
18. As a social media manager, I want to list forbidden topics, so that Comments about them always go to a person.
19. As a social media manager, I want to set a default language, so that Replies use it when the language of the Comment is not clear.
20. As a social media manager, I want to see the character limit of each field, so that I know how much I can write.
21. As a social media manager, I want the feature to work with an empty Brand Profile, so that I can start before I finish writing it.

### Reading and judging

22. As a social media manager, I want the app to read new Comments by itself every few minutes, so that I do not open Facebook to check.
23. As a social media manager, I want only Posts from the last N days (default 7) to be read, so that old Posts are left alone.
24. As a social media manager, I want a Watching switch per Social Account, so that I can stop the reading and the automatic sending for one Page.
25. As a social media manager, I want our own Comments to be Skipped, so that the app never answers itself.
26. As a social media manager, I want a Comment the Page already answered on Facebook to be Skipped, so that the viewer does not get two answers.
27. As a social media manager, I want Comments with only emoji, stickers, or @mentions to be Skipped, so that the board is not full of noise.
28. As a social media manager, I want a viewer answering another viewer to be Skipped, so that we do not step into their talk.
29. As a social media manager, I want a viewer who answers under our Reply to be judged as a new Comment, so that the talk can continue.
30. As a social media manager, I want short Comments like "สนใจ", "ราคา?", "555", and "+1" to reach the LLM, so that real buying interest is not thrown away.
31. As a social media manager, I want spam and ads to be Skipped, so that I do not read them.
32. As a social media manager, I want complaints, refund requests, angry Comments, and legal or health topics to be Needs human, so that a machine never answers them.
33. As a social media manager, I want a Comment that tries to give orders to the LLM to be Needs human, so that a viewer cannot control our Replies.
34. As a social media manager, I want the LLM to say "unsure" when in doubt, so that doubtful Comments reach a person.
35. As a social media manager, I want a "reply to praise" switch per Social Account, so that I choose if "สวยมาก ❤️" gets a Reply.
36. As a social media manager, I want a Comment the LLM could not judge after three tries to be Needs human with the note "could not judge", so that nothing is lost in silence.

### Replies

37. As a viewer, I want a Reply in the language I wrote in, so that I understand it.
38. As a social media manager, I want every Reply to be short (one or two sentences, at most 300 characters), so that it reads like a person wrote it.
39. As a social media manager, I want at most one emoji and no URL, @handle, or hashtag in a Reply, so that Facebook does not treat it as spam.
40. As a social media manager, I want a Reply to state no price or promise that is not in the FAQ, so that we never promise something false.
41. As a social media manager, I want a question whose answer is not in the FAQ to get a Fallback Reply that states no facts and invites the viewer to message us, so that the viewer still gets an answer.
42. As a social media manager, I want a Fallback Reply to never invent a LINE ID, phone number, or link, so that viewers are not sent to the wrong place.
43. As a social media manager, I want a "not in FAQ" badge and filter, so that I see which questions to add to the FAQ.
44. As a social media manager, I want a Reply that breaks a rule to be written again, never cut and published, so that half sentences are not published.

### Draft mode and Auto mode

45. As a social media manager, I want Draft mode to be the default, so that nothing is published before I trust the feature.
46. As a social media manager, I want to approve a Draft with one click, so that good Replies go out fast.
47. As a social media manager, I want to edit a Draft before I send it, so that I can fix small things.
48. As a social media manager, I want to reject a Draft, so that a bad Reply is never published.
49. As a social media manager, I want to switch one Social Account to Auto mode, so that easy Comments are answered without me.
50. As a social media manager, I want Auto mode to show a short note about what it will and will not send, so that I know the risk before I turn it on.
51. As a social media manager, I want Auto mode to publish only for a `reply` Verdict on a Comment at most 24 hours old, so that the app does not answer a pile of old Comments after a first Connect or a long stop.
52. As a social media manager, I want older `reply` Comments to become Drafts, so that I decide about them.
53. As a social media manager, I want changing the Reply Mode to leave waiting Drafts alone, so that turning on Auto mode does not publish a batch I did not read.
54. As a social media manager, I want to write my own Reply on a Needs human Comment, so that I can answer the hard ones from the same board.
55. As a social media manager, I want a "help me draft" button on a Needs human Comment, so that I get a first text to edit.
56. As a social media manager, I want "help me draft" to only fill the text box and never publish, so that I stay in control.
57. As a social media manager, I want to close a Needs human Comment with "do not reply", so that it leaves my to-do column.
58. As a social media manager, I want to bring back a Skipped Comment, so that I can answer one that was skipped by mistake.

### The board

59. As a social media manager, I want one Kanban board with a column per state (Needs human, Draft, Queued, Replied, Skipped), so that I see all the work at once.
60. As a social media manager, I want one card per Comment with the author, age, Comment text, Reply, badges, and the actions for its state, so that I can act without opening another page.
61. As a social media manager, I want all Social Accounts on one board with an account filter, so that I can work on one Page or all of them.
62. As a social media manager, I want to see why a Comment was Skipped or sent to me (rule name, LLM reason, or the error from Facebook), so that I trust the decision.
63. As a social media manager, I want links from the board to the Accounts page and the Brand Profile page, so that I can change settings quickly.
64. As a social media manager, I want clear empty and error states (no account yet, no Comments yet, load failed), so that I know what to do next.

### Safety and limits

65. As a social media manager, I want a Comment to never get two Replies from us, even when two people press send at the same time or the server restarts, so that we do not look broken.
66. As a social media manager, I want a send that was not confirmed to go to Needs human with "send not confirmed, check on the Platform", so that I check before I answer again.
67. As a social media manager, I want a Reply that Facebook rejected to go to Needs human with the message from Facebook, so that I can rewrite it.
68. As a social media manager, I want a Comment that was deleted on Facebook to be Skipped, so that it leaves my board.
69. As a social media manager, I want a Social Account that hits the Facebook rate limit to be Paused and to continue by itself, so that I do nothing and the other Pages keep working.
70. As a social media manager, I want to see "checked 3 minutes ago" and "paused until HH:MM" on the Accounts page, so that I know the app is alive.
71. As a social media manager, I want Drafts of a Reconnect needed Social Account to stay visible but not sendable, so that I understand why send is off.
72. As a team lead, I want a Verdict test set and a pass bar that a model must meet before we turn on Auto mode, so that we know the LLM does not answer complaints.
73. As a developer, I want Platforms behind one adapter interface with a registry, so that another Platform can be added later without changing the core.
74. As a developer, I want the feature to do nothing on a deployment with no Watching Social Account, so that the desktop app needs no switch to turn it off.

## Implementation Decisions

### Scope

- Facebook only. No TikTok adapter, OAuth, env vars, or tickets. The adapter interface, the registry, and the three capabilities stay, so a Platform can be added later.
- Official Graph API only. Comments on Posts only. Reply is the only action.
- Polling, no webhooks.
- Server deployment only. The people who Connect have a role on our Meta app, so Standard Access is enough and no App Review is sent.

### Modules

**Social platform adapter (new, backend).** One interface per Platform, in its own social services folder (not with the AI generation adapters). A registry looks an adapter up by Platform name, lowercases the name, and throws `Unsupported social platform: <name>` for an unknown one, the same shape as the image adapter lookup. The registry must let a test register an extra adapter.

The adapter makes its own HTTP calls and is built with an injectable `fetch` (default: global `fetch`). Interface, from the decision ticket:

```ts
export interface SocialPlatformAdapter {
  platform: string
  capabilities: SocialCapabilities

  listPosts(account: SocialAccountAuth, since: Date, cursor?: string): Promise<Page<SocialPost>>
  listComments(account: SocialAccountAuth, postId: string, cursor?: string): Promise<Page<SocialComment>>
  reply(account: SocialAccountAuth, comment: SocialComment, text: string): Promise<{ replyId: string }>
  refreshToken?(account: SocialAccountAuth): Promise<SocialTokens>   // Facebook has none

  getAuthUrl(redirectUri: string, state: string): string
  exchangeCode(code: string, redirectUri: string): Promise<ConnectableAccount[]>
}

export interface SocialCapabilities { canReply: boolean; maxReplyChars: number; needsPublicCallback: boolean }
export interface Page<T> { items: T[]; nextCursor?: string }   // cursor is opaque to the core

export interface SocialAccountAuth { platformAccountId: string; accessToken: string; refreshToken?: string }
export interface SocialTokens { accessToken: string; refreshToken?: string; expiresAt?: Date }
export interface SocialPost { id: string; text: string; url?: string; createdAt: Date }
export interface SocialComment {
  id: string; postId: string; text: string
  authorId?: string; authorName?: string
  createdAt: Date
  isOwn: boolean          // set by the adapter
  parentId?: string       // needed by the plain rules (viewer-to-viewer, already replied)
}
export interface ConnectableAccount { platformAccountId: string; name: string; avatarUrl?: string; tokens: SocialTokens }
```

- One call returns one page plus a cursor. The core does the looping.
- Every failure is thrown as `SocialPlatformError` with a `kind`: `auth_expired`, `rate_limited` (with `retryAfterSec` when the Platform gives it), `not_found`, `rejected`, `unknown` (keeps the raw Platform message).
- Only the three capabilities. Add another only when a real need appears.

**Facebook adapter (new).** Posts from the Page feed, Comments from the Post's comment stream (all Comments, including nested ones, each with its parent), Reply by posting under the Comment. `isOwn` is true when the author is the Page. Facebook error 190 maps to `auth_expired`; the Business Use Case rate-limit errors map to `rate_limited`. `exchangeCode` trades the code for a user token, lists the Pages, and returns one `ConnectableAccount` per Page with its own Page token; the user token is not stored. Permissions asked at login: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`. No `refreshToken` (Page tokens do not expire).

Whether Facebook can return the newest Comments first is not confirmed. The first implementation ticket checks it on the real API. If it cannot, the adapter keeps the cursor of the last page it read instead; the core does not change.

**Account connection (new, backend routes + in-memory state).**

- One hosted callback: `PUBLIC_BASE_URL` + `/api/v1/social/oauth/<platform>/callback`.
- App credentials from env vars `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET`. Never on the Settings page, never sent to the frontend.
- Start: the backend makes a random `state` (single use, 10 minutes, kept in memory) and returns the login URL.
- Callback: check `state`, call `exchangeCode`, keep the list of Pages with their tokens in server memory for 10 minutes, send the browser back to the Social pages. The user ticks Pages; the backend saves each as a Social Account. A server restart in that time means the user logs in again.
- A Social Account is matched by Platform + Platform account id. Reconnect and "Connect again after Disconnect" update the same row.
- The frontend can ask if Connect is possible and, when not, why (no `PUBLIC_BASE_URL`, or missing env vars).
- Disconnect deletes the local tokens and sets the status to Disconnected. (Decided: also call the Platform's revoke endpoint if it has one, and still delete the local tokens when that call fails.)
- No route ever returns a token. Routes return the status and the expiry time only.

**Reply agent (new Mastra agent `social_responder`).** Built like the existing live-comment responder agent: default prompt with the other default prompts, no tools, one step, one JSON user message, and the service parses the JSON answer. Model: the active text config from Settings. No per-account model.

- Input: Brand Profile, Post text (cut to 1000 characters), Comment text (cut to 500), our earlier Reply (only when the Comment is a viewer answering under our Reply), the "reply to praise" switch, and `mode` (`judge` or `draft`).
- Not sent: the viewer's name, other viewers' Comments, images, video.
- Output: `{ verdict, reason, reply?, fallback? }`. Verdict is `reply`, `skip`, `human`, or `unsure`. `reply` is present only when the Verdict is `reply`.
- The prompt treats the Comment text as data, never as instructions. When in doubt it chooses `unsure`. No numeric threshold. No Jev.
- Fallback Reply: a normal question whose answer is not in the Brand Profile still gets the Verdict `reply`, with a short line that states no facts and invites the viewer to message the Social Account, `fallback: true`, and a `reason` that says what is missing. It may name a contact channel only if the FAQ has it.
- Reply rules, checked in code after parsing: at most 300 characters and never more than the adapter's `maxReplyChars`; at most one emoji; no URL, @handle, or hashtag. A break counts as an LLM failure (retry). It is never cut and published.
- `mode: "draft"` ("help me draft"): the LLM always writes a `reply` and does not judge. The stored Verdict does not change. Nothing is saved until the person presses send.

**Comment filter (new).** Plain rules first, no LLM call, result Skipped with the rule name as the note:

1. The Comment is our own.
2. The Social Account already replied to it on the Platform.
3. Nothing to answer: after trimming, only emoji, punctuation, @mentions, or no text.
4. A viewer replying to another viewer (the parent is not ours).

Everything else gets one LLM call. One Verdict per Comment; an edited Comment is not judged again. LLM failure (error, timeout, output that does not parse, Reply rule break) is tried again in the next Polling round, up to 3 rounds, then Needs human with "could not judge".

**Comment lifecycle (new).** One `status` on the Comment, seven states: `new`, `skipped`, `needs_human`, `draft`, `queued`, `sending`, `replied`. No `failed` and no `approved`. The user sees five of them (Needs human, Draft, Queued, Replied, Skipped).

| From | To | Who |
|---|---|---|
| `new` | `skipped` / `needs_human` | Plain rule or LLM; 3 failed judging rounds give `needs_human` |
| `new` | `draft` | Verdict `reply` in Draft mode, or the Comment is older than 24 hours |
| `new` | `queued` | Verdict `reply` in Auto mode and the Comment is at most 24 hours old |
| `queued` | `sending` | Polling round |
| `queued` | `draft` | The Comment became older than 24 hours while waiting |
| `draft` / `needs_human` | `sending` | A person presses send |
| `draft` / `needs_human` | `skipped` | A person rejects the Draft ("rejected by user") or closes the Comment ("closed by user") |
| `sending` | `replied` | The Platform accepted the Reply |
| `skipped` | `needs_human` | A person brings it back (not judged again) |
| `new` / `draft` / `queued` / `needs_human` | `skipped` | The Page answered it on Facebook ("already replied on the Platform") |

- `verdict`, `reason`, and `fallback` are set once and never change.
- `reply_source`: `auto` (Auto mode published it), `approved` (LLM text, a person pressed send), `manual` (a person wrote or edited the text). Only the final text is stored.
- Praise with the "reply to praise" switch off becomes Skipped.
- Changing the Reply Mode touches no stored Comment.
- `replied` always means we published it.

**Never reply twice.**

1. Unique key on (account, Platform comment id).
2. Before the adapter call, one atomic update to `sending` that names the expected current state. Only the caller that changed the row may send.
3. A row left in `sending` for more than 5 minutes is never retried. It becomes `needs_human` with "send not confirmed, check on the Platform".

**Send failure, by error kind.**

| Kind | Result |
|---|---|
| `rate_limited` | Back to the state it came from; the Social Account is Paused |
| `auth_expired` | `draft`; the Social Account becomes Reconnect needed |
| `not_found` | `skipped`, "deleted on the Platform" |
| `rejected` | `needs_human`, with the Platform's message |
| `unknown` | From `queued`: back to `queued`, up to 3 rounds, then `needs_human`. Sent by a person: show the error and go back to the state it came from |

**Poller (new).** One timer started at backend boot, one Polling round every 5 minutes (a constant, not a setting), built like the existing generation queue sweep: `setInterval`, unref'd, with a "round is running" guard, no cron library. The first round runs right after boot. If the last round is still running, this round is skipped. Social Accounts are handled one after another. A Social Account is skipped when it is not `connected`, not Watching, or Paused.

Per Social Account, in this order:

1. Move `sending` rows older than 5 minutes to Needs human.
2. Move `queued` Comments older than 24 hours to Draft.
3. Read new Comments.
4. Judge `new` Comments.
5. Send `queued` Comments.

Limits per Social Account per round:

- At most 30 adapter read calls. The rest continue next round; the position is kept in memory, and after a restart reading starts again from the newest Post.
- The Post list is fetched once per hour, not every round. Every Post inside `watch_days` is read, newest first.
- Per Post: page until a Comment id we already stored, or 10 pages, then stop. No special catch-up logic.
- Judge at most 50 Comments, newest first, one at a time.
- Send at most 10 Replies, oldest first, 3 seconds apart.

Before an adapter call the core checks the token: if it expires within 10 minutes and the adapter has `refreshToken`, refresh first. (Facebook never needs this; the rule stays in the core for later Platforms.)

Errors while reading: `unknown` on one Post is logged and that Post is skipped; `auth_expired` sets Reconnect needed; `rate_limited` stops this Social Account for the round and pauses it.

Backoff: pause for `retryAfterSec` when the Platform gives it; otherwise 15 minutes, doubling each time, up to 1 hour. A round that finishes without a rate-limit error resets the step. Only that Social Account is Paused. State lives in SQLite, no Redis. No early slow-down from the Facebook usage header.

Watching off: the round skips the whole Social Account. Actions a person takes still work.

### Schema

Three new tables, added to the idempotent startup DDL and to the Drizzle table definitions. Each also has `id`, `created_at`, `updated_at` like the other tables.

- **`social_accounts`**: `platform`, `platform_account_id` (unique together), `name`, `avatar_url`, `status` (`connected` / `reconnect_needed` / `disconnected`), `access_token`, `refresh_token`, `token_expires_at`, `reply_mode` (`draft` / `auto`, default `draft`), `watching`, `watch_days` (default 7), `reply_to_praise` (default on), `brand_about`, `brand_tone`, `brand_faq`, `brand_forbidden`, `default_language` (default Thai), `paused_until`, `backoff_step`, `last_polled_at`.
- **`social_posts`**: `account_id`, `platform_post_id` (unique together), `text`, `url`, `posted_at`.
- **`social_comments`**: `account_id`, `post_id`, `platform_comment_id` (unique with `account_id`), `parent_platform_comment_id`, `text`, `author_id`, `author_name`, `commented_at`, `status`, `verdict`, `reason`, `fallback`, `judge_attempts`, `send_attempts`, `status_note`, `reply_text`, `reply_source`, `reply_platform_id`, `replied_at`.

No replies table and no brand profile table. Tokens are plain text, the same as the stored AI service API keys today. No cleanup in the MVP: stored rows stay, and a Draft on an old Post can still be sent.

Brand Profile limits, checked by the backend: About 500, Tone 200, FAQ 3000, Forbidden topics 500.

### API

All under the existing `/api/v1` mount, in a new social route group. The exact paths are for the implementer, except the OAuth callback above. The routes must cover:

- Connect: "can I Connect, and if not why", start login, callback, list the Pages waiting to be ticked, save the ticked Pages.
- Social Accounts: list (no tokens; with status, `last_polled_at`, `paused_until`), update settings (Reply Mode, Watching, watch days, reply to praise), read and update the Brand Profile, Disconnect.
- Comments: list for the board (filter by account and by "not in FAQ"), send (approve a Draft, send an edited Draft, send a hand-written Reply), reject a Draft, close with "do not reply", bring back a Skipped Comment, "help me draft".

Send goes through the same atomic guard as the poller. Send is refused when the Social Account is not `connected`.

### Frontend

- New sidebar item "Social" and three pages: the inbox at `/social`, an Accounts page, and a Brand Profile page. The inbox header links to the other two. Register the pages the way the app registers its other pages.
- Inbox: Kanban board, five columns. One card per Comment: Platform tag, author, age, Comment text, the Reply if there is one, the "not in FAQ" badge, the status note, and the actions for its state (Draft: approve / edit / reject; Needs human: send / help me draft / do not reply; Skipped: bring back). Header filters: account, "not in FAQ only".
- Accounts page: Connect button per Platform; one card per Social Account with status, Reply Mode switch, Watching, watch days, reply to praise, link to its Brand Profile, Disconnect, "checked N minutes ago", "paused until HH:MM". Auto mode shows a short note about what it will and will not send. After login, the list of Pages to tick.
- Brand Profile page: account picker and the five fields with their limits.
- Special states: desktop app (server only), no account yet, no Comments yet, load failed, token expired banner with Reconnect, send failed note with "send again" / "do not reply".
- Style: the default layout, the existing design tokens, and the existing button, tag, card, and input classes. No UI framework. All calls go through the existing API composable.
- Prototype for reference: https://claude.ai/artifact/Pp1EutRines7Pzdh2orRFe (layout D).

### Left to the implementer

- How a Draft is edited inside a card (inline or dialog).
- How long columns behave (scroll, paging, "load more").
- The Thai and English UI strings and error messages. The strings in the prototype are placeholders.
- The Facebook adapter's `maxReplyChars` value. The 300-character Reply rule is the limit that matters in practice.

### Config

- New env vars: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, with placeholders in the backend example env file and a line in the README env var section. `PUBLIC_BASE_URL` already exists.
- The Meta app exists (app id `1412931736955991`, use case "Manage Pages").

## Testing Decisions

A good test here checks behavior from the outside: a Comment goes in, and we look at the state of the Comment in the database, the Replies the Platform was asked to send, and what the routes return. It does not check which function called which, or the wording of the prompt.

### Seams

These were agreed in the Testing approach decision. Existing seams are used wherever one exists.

1. **The adapter interface** (new seam, the main one). A scripted fake adapter lives in the test helpers only and is registered under the Platform name `fake`. The test gives it Posts and Comments and a queue of "the next call fails with this error kind". It records every Reply it was asked to send. It has no "slow" option; a stuck `sending` is tested by writing a `sending` row into the database.
2. **The Mastra agent lookup** (existing seam). The LLM is replaced by swapping the agent getter, as the AI Live test does.
3. **`fetch` at the Facebook adapter** (existing pattern). The real Facebook adapter is tested against a local HTTP stub, never against Facebook.
4. **The HTTP routes** (existing seam), for the token test.

Each test file uses a temporary SQLite file through `SQLITE_PATH`, as the AI Live test does.

### What is tested

**End-to-end, one file, fake adapter + fake LLM, runs in CI.** Two paths:

1. Draft mode: Comment in, Polling round, Verdict `reply`, state `draft`, approve, state `replied`.
2. Auto mode: Comment in, Polling round, state `queued`, sent, state `replied`.

**Facebook adapter against the stub:** list Comments returns one page plus a cursor; `isOwn` is set; send a Reply; Graph API errors become the right error kind (expired token, rate limit, Comment deleted); `getAuthUrl`; `exchangeCode` returns one account per Page.

**Unit tests by name:**

1. Plain rules of the comment filter (own, already replied, no text, viewer-to-viewer).
2. Never-reply-twice guard: two sends at the same time give one Reply; a stuck `sending` goes to `needs_human`.
3. Backoff steps: 15 minutes doubling to 1 hour, and reset after a good round.
4. Round limits: 30 read calls, 50 judged Comments, 10 sent Replies.
5. Reply rules: 300 characters, one emoji, no URL / @handle / hashtag, and a rule break is a retry.
6. Error kind mapping: `auth_expired` gives Reconnect needed, `rate_limited` gives Paused, and the other kinds.
7. Auto mode gate: only Verdict `reply` and Comments at most 24 hours old are published.
8. OAuth `state`: single use, expires after 10 minutes.

Numbers 2 and 7 matter most. They are the ones that stop a wrong or double Reply.

**Route test:** the API never returns tokens.

### Where and how

- Files named `social-*.test.ts` in the backend test folder, using `node:test`.
- New backend npm script `test:social` that runs them with `tsx --test`.
- The same files are added to the test list in the CI workflow.
- Prior art: the AI Live test (HTTP stub, swapped agent getter, temporary SQLite file).

### The real LLM

Not in the test suite. It is measured by the Verdict test set:

- About 100 hand-written Comments (70% Thai, 20% English, 10% mixed), one fixed fake Brand Profile, stored as a JSON file. Minimums per case type are in the decision "Thai test set for the Verdict prompt".
- New backend npm script `eval:verdict`: runs the whole set 3 times on the active text config through `social_responder`, prints a table, and writes a dated report file that is committed.
- Per Comment it checks the outcome (`human` and `unsure` count as the same), the `fallback` flag, and the Reply rules.
- Pass bar for Auto mode: zero Dangerous errors in every run, and average accuracy of at least 85%. No code gate. A new model or a new prompt means a new run.
- Writing and labeling the Comments needs a Thai speaker. It is a human task (`ready-for-human`); the script is an agent task.

### Live-API check

The first implementation ticket, done before the Facebook adapter. A human creates a company test Facebook Page. The dev runs a small read-only script by hand, once, with a Page token from an env var, to see if Facebook can return the newest Comments first. The result is written in the ticket. The same Page is used later to try real Replies.

### Frontend

No frontend tests (the repo has none) and no new test tool. Manual checklist for the Kanban board, on the server deployment with the test Page:

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

## Out of Scope

- TikTok, the whole Platform, and with it the "read + draft, human copies the reply" fallback.
- Live-stream comments (they stay in AI Live).
- Unofficial libraries and browser automation.
- Hide, delete, like, and private message actions.
- Product data from AI Seller as LLM context.
- Choosing per Post which Posts to watch.
- Webhooks.
- Connecting accounts from the desktop app (needs a relay service that holds the app secret).
- App Review, Advanced Access, and Business Verification (needed only when someone outside our Meta app must Connect).
- Jev or any other classifier besides the LLM set in Settings.
- A per-account model, a numeric confidence threshold, an editable category list, a banned-word list, a fixed fallback text setting.
- A "check now" button, a polling history in the UI, a report page for "not in FAQ" questions.
- History of edits to a Draft, who approved a Reply, deleting a Social Account with all its data, cleanup of old rows.
- Token encryption (tokens are plain text, like the AI service keys today).
- Redis, a cron library, more than one backend process.
- Frontend automated tests.
- A code gate that blocks Auto mode until the Verdict test set passes.

## Further Notes

- **Order of work.** The live-API check is the first ticket. The Verdict test set (human) can be written in parallel with everything else; only turning on Auto mode on a real Page waits for it.
- **Do not turn on Auto mode on a real Page** until a committed `eval:verdict` report shows a pass for the model and prompt in use. Nothing in the code stops it; the team does.
- **Open facts to confirm during implementation** (they do not change the design):
  - `pages_show_list`, `pages_read_engagement`, and `pages_read_user_content` are added to the Meta app's use case. Only `pages_manage_engagement` was seen as "ready for testing".
  - Facebook returns the author of a Comment in a way that lets us compare it with the Page id (for `isOwn`). The id returned by our own Reply is also stored, so our Reply is known even without it.
  - The exact Facebook rate-limit numbers for a Page token.
  - Test accounts are not named yet. The first ticket creates the test Page.
- **TikTok text in `CONTEXT.md`.** The glossary still names TikTok in the definitions of Platform, Social Account, and Post. The words stay correct for a later Platform; the MVP code has Facebook only.
- **Desktop.** The poller starts on every deployment and does nothing when no Social Account is `connected` and Watching, so the desktop app needs no flag.
- **Privacy.** Comment text and Post text go to the LLM set in Settings. The viewer's name does not.
