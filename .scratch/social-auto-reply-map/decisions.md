# Decisions: Social Auto Reply

The full answers of the decision tickets that were resolved on GitHub before tracking moved to `.scratch/`. Copied on 2026-10-08. `map.md` holds the one-line index; this file holds the detail. Do not edit the copied answers.

---

# Facebook comment API facts

Type: research
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/9

## Question

What does the official Meta Graph API allow for Page post comments? Needed facts: how to list new comments on the posts of a Page (endpoints, paging, how to fetch only new ones), how to reply to a comment, required permissions and which need App Review or Business Verification, the OAuth login flow for getting a long-lived Page token (redirect URI rules, is a localhost/loopback redirect allowed, token lifetime and refresh), rate limits, and how to tell our own replies from other people's comments. Note webhook support briefly for later.

### Comment 1

##### Short answer

- List posts: `GET /{page-id}/feed` (Page token, `since`/`until`, `limit` max 100, cursor paging). List comments: `GET /{post-id}/comments?filter=stream` (all comments, chronological). No confirmed `since` on comments, so keep a seen-comment-id table.
- Reply: `POST /{comment-id}/comments` with `message`.
- Permissions: `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`, `pages_manage_engagement`. Standard Access is automatic but only for people with a role on our Meta app. For any other user we need Advanced Access = App Review + Business Verification.
- OAuth: authorization code flow; code exchange needs the app secret (server side). Redirect URI must exactly match a registered one and docs say HTTPS. Localhost/loopback is NOT mentioned in official docs; only secondary sources say http://localhost works in development. UNCONFIRMED, must test.
- Tokens: user token -> long-lived (~60 days) -> `GET /{user-id}/accounts` gives Page tokens that have no expiry date, but can be invalidated. On error 190, ask the user to reconnect.
- Rate limits: Page tokens use Business Use Case limits (headers `X-Business-Use-Case-Usage`; errors 32, 80001-80014; app level 200 x users per hour). Exact Page number not confirmed.
- Own replies: save the id returned by our reply POST; also skip comments where `from.id` == page id (the `from` detail is UNCONFIRMED).
- Webhooks: Page `feed` field, needs `pages_manage_metadata` and a public HTTPS URL. Later.

Full notes with source URLs and UNCONFIRMED marks: https://github.com/kimyohant/naka-drama-studio/blob/research/facebook-comment-api/docs/research/facebook-comment-api.md

---

# TikTok comment API facts

Type: research
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/10

## Question

Can an official TikTok API list and reply to comments on the own (organic) videos of an account? Check the TikTok API for Business (Business Accounts comment endpoints), the Display and Content Posting APIs, and any other official option. Needed facts: endpoints for list and reply, account type required, scopes, app review steps and typical wait, OAuth flow (redirect URI rules, loopback allowed?, token lifetime and refresh), rate limits. Give a clear verdict: is official reply possible for MVP, yes or no, and under which conditions.

### Comment 1

##### Verdict

**Official reply to organic video comments is possible for MVP: YES, but only through the TikTok API for Business "Accounts API", and only if: (1) the developer app owner is a company (individuals are not accepted), (2) TikTok approves the Accounts API access form and the app, and (3) the OAuth callback is a public HTTPS URL with no port (so the Electron app needs a hosted relay; no loopback).** Login Kit, Display API and Content Posting API have no comment scope.

##### Short answer

- List: `GET /open_api/v1.3/business/video/list/` (video ids), then `GET /business/comment/list/` (business_id, video_id, cursor, max_count max 30, sort by create_time; `owner` flag marks the owner's own comments).
- Reply: `POST /business/comment/reply/create/` (business_id, video_id, comment_id, text max 1,200 chars).
- Account: Accounts API supports Business and Personal accounts. The user logs in and approves; the app needs the "TikTok Accounts" permission. Token scopes include `comment.list` and `comment.list.manage` (exact endpoint mapping not confirmed).
- Review: developer profile (3 business days; company email + company website required), Accounts API Access Application Form (mandatory since 2026-03-20, wait time not published), app review (2-3 business days).
- OAuth: authorize at tiktok.com/v2/auth/authorize, auth_code (10 min, one use), exchange at `/tt_user/oauth2/token/` with client_secret.
- Redirect URI rules: must be `https://`, no port, no query, trailing `/`. So `http://localhost:PORT` is not allowed by the written rules (not tested live). Login Kit Desktop allows loopback, but it has no comment scopes.
- Tokens: access 1 day, refresh 1 year (`/tt_user/oauth2/refresh_token/`); then the user must re-authorize.
- Rate limits: 40 QPM per account per endpoint; per app total 600 QPM (Basic) to 1,000 QPM.
- Other: the system may hide repeated similar replies as spam. Webhook `comment.update` (within 5 min) needs a public URL, so polling stays for MVP. Only the first 500 comments of a video follow the sort order.
- Not confirmed: form review time, endpoint-to-scope mapping, live loopback test, personal-account behaviour in practice, how to raise the rate level.

Full findings with URLs: https://github.com/kimyohant/naka-drama-studio/blob/research/tiktok-comment-api/docs/research/tiktok-comment-api.md

---

# Register Meta and TikTok developer apps

Type: task
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/11

## Question

Neither developer app exists yet. Create a Meta developer app and a TikTok developer app, request the permissions/scopes the research names, and start app review. The answer records the app IDs, where the secrets are stored, the review status, and which test accounts can be used.

### Comment 1

Facebook: https://developers.facebook.com/apps/1412931736955991/dashboard/?business_id=1136695144047446

Tiktok: รอ verify app & domain

### Comment 2

Note from charting: the company email for the developer accounts does not exist yet; it will be created soon. TikTok requires a company-owned developer account (company-domain email and company website), so that comes first.

## Answer

Recorded 2026-10-08, after the move to `.scratch/`. Not on GitHub.

- **Meta app**: exists. App id `1412931736955991`, business id `1136695144047446`, use case "Manage Pages". Dashboard: https://developers.facebook.com/apps/1412931736955991/dashboard/?business_id=1136695144047446
- **Permissions**: `pages_manage_engagement`, `business_management`, and Page Mentions show "ready for testing" (Standard Access) with 0 API calls so far. Standard Access works only for people with a role on the app, which is all the MVP needs. `pages_show_list`, `pages_read_engagement`, and `pages_read_user_content` were not checked: confirm they are added to the use case.
- **App Review**: not sent. Not needed until someone outside our Meta app must connect a Page.
- **Secrets**: `FACEBOOK_APP_ID` and `FACEBOOK_APP_SECRET` in `backend/.env` (not in git). Placeholders are in `backend/.env.example`. The driving dev pastes the secret.
- **Test accounts**: not named yet.
- **TikTok app**: waiting for app and domain verification. TikTok was ruled out of scope on the map, so this no longer blocks anything.

---

# Social platform factory interface

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/12

## Question

What is the adapter contract every social platform implements, and how is it registered and looked up? Decide the methods (list comments, reply, token refresh...), the capability flags (for example canReply), the shared comment/post/account types, error and rate-limit signalling, and where it lives, following the shape of backend/src/services/adapters/registry.ts. Use the codebase-design skill.

### Comment 1

##### Resolution

One interface per platform, `SocialPlatformAdapter`, in a new folder `backend/src/services/social/`. The adapter makes its own HTTP calls and returns shared types. This is different from the image/video adapters (which only build requests), because Facebook and TikTok differ too much in paging, token placement, and error format to share one fetch loop.

###### Location and lookup

```
backend/src/services/social/
  types.ts      — interface, shared types, SocialPlatformError
  registry.ts   — socialAdapters record + getSocialAdapter(platform)
  facebook.ts
  tiktok.ts
```

`getSocialAdapter(platform)` lowercases the name and throws `Unsupported social platform: <name>` when it is unknown, same shape as `getImageAdapter`. Not placed in `services/adapters/`; that folder is for AI generation providers.

###### Interface

```ts
export interface SocialPlatformAdapter {
  platform: string                       // 'facebook' | 'tiktok'
  capabilities: SocialCapabilities

  listPosts(account: SocialAccountAuth, since: Date, cursor?: string): Promise<Page<SocialPost>>
  listComments(account: SocialAccountAuth, postId: string, cursor?: string): Promise<Page<SocialComment>>
  reply(account: SocialAccountAuth, comment: SocialComment, text: string): Promise<{ replyId: string }>

  /** Optional. Facebook Page tokens do not expire; TikTok access tokens last 1 day. */
  refreshToken?(account: SocialAccountAuth): Promise<SocialTokens>

  // OAuth: getAuthUrl(...) and exchangeCode(...) live on this same adapter.
  // Their exact signatures are decided in "Account connection with OAuth".
}

export interface SocialCapabilities {
  canReply: boolean            // false => "read + draft, human copies the reply"
  maxReplyChars: number        // TikTok 1200
  needsPublicCallback: boolean // TikTok true (no loopback redirect)
}

export interface Page<T> { items: T[]; nextCursor?: string }   // cursor is opaque to the core
```

Each adapter is built with an injectable `fetch` (default: global `fetch`), so tests pass a fake and no network is needed.

###### Shared types

```ts
export interface SocialAccountAuth {   // what the adapter needs to act as a Social Account
  platformAccountId: string            // Facebook Page id / TikTok business_id
  accessToken: string
  refreshToken?: string
}
export interface SocialTokens { accessToken: string; refreshToken?: string; expiresAt?: Date }

export interface SocialPost    { id: string; text: string; url?: string; createdAt: Date }
export interface SocialComment {
  id: string; postId: string; text: string
  authorId?: string; authorName?: string
  createdAt: Date
  isOwn: boolean                       // set by the adapter
}
```

`reply` takes the whole `SocialComment` (not only its id) because TikTok needs `video_id` together with `comment_id`.

###### Rules of the interface

- **Paging**: one call returns one page plus `nextCursor`. The core loops and stops at the first comment id it already knows, then removes duplicates by platform comment id. This protects rate limit (TikTok: 40 calls per minute per account).
- **Own comments**: the adapter sets `isOwn` (TikTok `owner` flag; Facebook `from.id` equals the Page id). The filter only reads the flag. The core also saves the `replyId` returned by `reply` and skips it.
- **Errors**: every failure is thrown as `SocialPlatformError` with a `kind`:
  - `auth_expired` — mark the Social Account "reconnect needed" (Facebook error 190, TikTok refresh token dead)
  - `rate_limited` — has `retryAfterSec`; delay the next poll
  - `not_found` — the Post or Comment was deleted
  - `rejected` — the platform refused the reply text (too long, spam, policy)
  - `unknown` — anything else; keeps the raw platform message
- **Capabilities**: only the three flags above. Add another only when a real need appears.
- **Token refresh**: the core decides *when* (before expiry); the adapter knows *how*. No `refreshToken` method means the token does not need refreshing.

###### Terms

Added to root `CONTEXT.md`: **Platform**, **Social Account**, **Post**, **Comment**, **Reply**.

###### Left to other tickets

- OAuth method signatures and where app credentials (client id/secret) come from → **Account connection with OAuth**.
- Stored columns for accounts, posts, comments → **Comment lifecycle and data model**.
- When and how often the core calls the adapter → **Polling schedule and rate limits**.

---

# Account connection with OAuth

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/13

## Question

How does a user connect a Facebook Page or TikTok account with a login button, on both the desktop app and the server deployment? Decide the redirect strategy (loopback vs hosted callback), where the app ID and secret come from (Settings page vs bundled), token storage and refresh, and what the user sees when a token expires or is revoked.

### Comment 1

##### Resolution

One OAuth flow for both platforms, on the server deployment only. The desktop app cannot connect accounts in the MVP.

###### Decisions

1. **Who connects**: only our own company, with our own Pages and TikTok accounts. The people are roles on our Meta app, so Advanced Access and Business Verification are not needed for the MVP.
2. **Redirect**: one hosted callback, the same for Facebook and TikTok: `PUBLIC_BASE_URL` + `/api/v1/social/oauth/<platform>/callback`. No loopback redirect and no relay service.
3. **App credentials**: env vars on the server: `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`, `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET`. Not on the Settings page, not bundled. The secret never goes to the frontend.
4. **Connect button**: disabled, with a message that says why, when `PUBLIC_BASE_URL` is not set or the env vars of that platform are missing.
5. **Facebook Pages**: after login the user sees a list of Pages and ticks the ones to connect. Each Page becomes one Social Account. TikTok login gives one account and connects at once.
6. **Token storage**: plain text in SQLite, the same as `ai_service_configs.api_key` today. The API never returns tokens; it returns only the status and the expiry time.
7. **Refresh**: before every adapter call, the core checks the token. If it expires within 10 minutes, the core calls `refreshToken` first. No separate timer. Facebook Page tokens do not expire, so the Facebook adapter has no `refreshToken`.
8. **Expired or revoked token**: the Social Account gets the status **reconnect needed** (on `SocialPlatformError` kind `auth_expired`, or a failed refresh). Polling and auto reply stop for that account only. `/social` shows a warning badge and a **Reconnect** button. Reconnect runs the same login flow and updates the same Social Account, matched by platform + platform account id, so the brand profile, settings, and drafts are kept. Drafts stay visible but cannot be sent until the account is connected again.
9. **Disconnect**: delete the tokens and call the platform's revoke endpoint if it has one (if that call fails, still delete the local tokens). Comments and Replies stay as history, and the account gets the status **disconnected**.

###### OAuth methods on `SocialPlatformAdapter`

```ts
getAuthUrl(redirectUri: string, state: string): string
exchangeCode(code: string, redirectUri: string): Promise<ConnectableAccount[]>

export interface ConnectableAccount {
  platformAccountId: string   // Facebook Page id / TikTok business_id
  name: string
  avatarUrl?: string
  tokens: SocialTokens
}
```

`exchangeCode` returns many accounts for Facebook (one per Page, each with its own Page token) and one for TikTok. The Facebook user token is used only inside `exchangeCode` and is not stored.

###### Flow

1. The frontend asks the backend to start a connection for a platform. The backend makes a random `state` (single use, 10 minutes), keeps it in memory, and returns `getAuthUrl(...)`.
2. The browser goes to the platform and comes back to the callback route. The backend checks `state` and calls `exchangeCode`.
3. TikTok: the account is saved, and the browser is sent to `/social`.
4. Facebook: the list of Pages (with tokens) is kept in server memory for 10 minutes, and the browser is sent to `/social`, which shows the list. The user ticks Pages and the backend saves them. If the server restarts in this time, the user logs in again.

###### Social Account status

`connected`, `reconnect needed`, `disconnected`.

###### Consequence

The desktop app has its own database and cannot connect accounts, so in the MVP **Social Auto Reply works only on the server deployment**. On desktop, `/social` shows an empty state with a message. Connecting from desktop (needs a relay) is ruled out of scope on the map.

###### Terms

Added to root `CONTEXT.md`: **Connect**, **Reconnect needed**, **Disconnected**.

###### Left to other tickets

- Stored columns for the Social Account (status, tokens, expiry) → **Comment lifecycle and data model**.
- The Page list, the disabled Connect button, the desktop empty state, the reconnect badge → **Social inbox UI prototype**.
- The exact scopes to request are in **Facebook comment API facts** and **TikTok comment API facts**.

---

# Comment filter and escalation rules

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/14

## Question

How do we decide, for each new comment, between skip, reply, and send to a human? Decide the mechanism: plain rules, a classifier, or both. The driving dev proposed Jev (TypeSafe AI hosted model that returns a typed decision with a calibrated probability) as the classifier; the alternative is a structured output from the LLM that already writes the reply. Also decide the categories (own comment, already replied, spam, emoji-only, negative/complaint), the confidence threshold that sends a comment to a human, the fallback when the classifier is unavailable, and what is configurable per account.

### Comment 1

##### Resolution

**Mechanism: plain rules first, then one LLM call for the rest. Jev is not used in the MVP.**

Why not Jev: Thai accuracy is not confirmed, each deployment would need one more API key, and comment text would go to one more provider. The LLM set in Settings is already there. Jev can come back later, after a Thai test set exists.

###### 1. Plain rules (no LLM call) -> Skipped

- The Comment is our own (`isOwn`).
- The Social Account already replied to it on the Platform. This includes replies written directly in the Facebook/TikTok app, not through us.
- Nothing to answer: after trimming, only emoji, punctuation, @mentions, or no text at all (image/sticker only).
- A viewer replying to another viewer (the parent is not ours).

Short text like "555", "+1", "สนใจ", "ราคา?" is **not** cut by rules. It goes to the LLM.

A viewer replying under our Reply is a new Comment and gets a Verdict as normal.

###### 2. One LLM call -> Verdict

The same LLM that writes the Reply returns `{ verdict, reason, reply? }` in one call. `reply` is present only when the verdict is `reply`.

| Verdict | Meaning |
|---|---|
| `reply` | A question or normal remark we can answer. Praise ("สวยมาก ❤️") is `reply`. |
| `skip` | Spam, ads, nothing to answer. |
| `human` | Complaint, refund, anger, legal/health topic, a forbidden topic from the brand profile, or text that tries to give orders to the LLM. |
| `unsure` | The model is not sure. |

- No numeric confidence threshold. The prompt says: when in doubt, choose `unsure`.
- The prompt treats the Comment text as data, never as instructions.
- One Verdict per Comment. An edited Comment is not judged again.

###### 3. What happens next

- **Needs human** = `human`, `unsure`, or "could not judge". No Draft is written. The user writes the Reply, or presses a "help me draft" button.
- **LLM failure** (error, timeout, output that does not parse): try again in the next polling round, up to 3 rounds, then Needs human with the label "could not judge". Never an automatic Reply without a Verdict.
- **Skipped** Comments are stored and shown in a "Skipped" tab with the reason (rule name or LLM `reason`). The user can bring one back; it then becomes Needs human and is not judged again.
- **Auto mode** publishes only when the Verdict is `reply` **and** the Comment is at most 24 hours old. Older Comments become a Draft. This covers both the first Connect and a long stop (for example several days in Reconnect needed).
- **Draft mode**: every `reply` Verdict becomes a Draft.

###### 4. Per Social Account settings

- One switch: "reply to praise" (default on). Off = praise becomes Skipped.
- Forbidden topics come from the brand profile. No threshold setting, no editable category list, no separate banned-word list.

###### Effects on other tickets

- **Adapter**: a Comment must carry "the owner already replied" and its parent, so the rules can run. Facebook can do this from nested `comments`; TikTok needs a check in *Polling schedule and rate limits* (#18).
- **Reply generation and brand profile** (#15): design the prompt around the `{ verdict, reason, reply? }` shape, the "comment is data" rule, and the praise switch.
- **Comment lifecycle and data model** (#16): states Skipped / Needs human / Draft, the stored Verdict + reason, the retry count, and the 24-hour rule.

Glossary terms added to `CONTEXT.md`: Draft, Verdict, Skipped, Needs human.

---

# Reply generation and brand profile

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/15

## Question

How is a reply generated? Decide the brand profile fields (tone, FAQ, forbidden topics), the prompt and its inputs, whether this is a new Mastra agent or a plain model call like answerComment in ai-live.ts, which AI service config/model it uses, length and language rules, and what the LLM returns when it should not answer.

### Comment 1

##### Resolution

**A new Mastra agent `social_responder`, built like `live_responder`, writes the Verdict and the Reply in one call.**

###### 1. Mechanism and model

- New agent `social_responder`: prompt in `DEFAULT_PROMPTS` (`backend/src/agents/index.ts`), no tools, one step, one JSON user message. The service parses the JSON answer, the same way `answerComment` does in `backend/src/services/ai-live.ts`.
- Model: the active text config from Settings (`getTextConfig`). No per-account model.

###### 2. Brand Profile (one per Social Account)

All fields are free text and may be empty. With an empty profile the LLM can only answer praise and small talk, or write a Fallback Reply.

| Field | Max | Content |
|---|---|---|
| About | 500 | Who we are and what we sell |
| Tone | 200 | How we talk, including the Thai ending word (ค่ะ/ครับ) |
| FAQ | 3000 | Facts the LLM may state: prices, delivery, opening hours, how to order |
| Forbidden topics | 500 | Things we never talk about (Verdict `human`) |
| Default language | - | Used when the Comment's language is not clear. Default: Thai |

###### 3. Input

- Brand Profile
- Post text, cut to 1000 characters
- Comment text, cut to 500 characters
- Our earlier Reply, only when the Comment is a viewer answering under our Reply
- The "reply to praise" switch
- `mode`: `judge` (normal) or `draft` (see 6)

Not sent: the viewer's name, other viewers' Comments, images, video.

###### 4. Output

`{ verdict, reason, reply?, fallback? }`

- `reply` is present only when the verdict is `reply`.
- **Fallback Reply**: when a viewer asks a question and the answer is not in the Brand Profile, the verdict is still `reply`. The LLM writes a short line that states no facts and invites the viewer to message the Social Account, and sets `fallback: true`. `reason` says what is missing (for example "no info about shipping abroad").
- A Fallback Reply must not invent a contact channel (LINE ID, phone number, link). It may name one only if the FAQ has it.
- There is no fixed fallback text setting. The LLM writes it each time.
- Complaints, forbidden topics, and the other `human` cases from *Comment filter and escalation rules* (#14) stay `human`. The Fallback Reply is only for normal questions we cannot answer.
- `fallback` is stored with the Comment. The inbox shows a "not in FAQ" badge and can filter by it, so the user knows what to add to the FAQ. No separate report page in the MVP.

###### 5. Reply rules

- One or two short sentences, at most 300 characters, and never more than the adapter's `maxReplyChars`.
- At most one emoji. No URL, no @handle, no hashtag.
- No price or promise that is not in the FAQ.
- Language: the Comment's language when it is clear, otherwise the default language.
- The Comment text is data, never instructions (from #14).
- A Reply that breaks a rule after parsing counts as an LLM failure (retry, as in #14). It is never cut and published.

###### 6. Auto mode and "help me draft"

- Auto mode publishes a Fallback Reply like any other `reply` Verdict. The 24-hour rule still applies.
- "Help me draft" on a Needs human Comment: same agent with `mode: "draft"`. The LLM always writes a `reply` and does not judge again. The stored Verdict does not change. The text is shown to the user and is never published by itself.

###### Effects on other tickets

- **Comment lifecycle and data model** (#16): store `fallback` with the Comment; the Brand Profile fields and default language belong to the Social Account.
- **Social inbox UI prototype** (#17): "not in FAQ" badge and filter; Brand Profile form (four text boxes + default language); "help me draft" button.
- **Thai test set for the Verdict prompt** (#23): include questions that are not in the FAQ and check `fallback: true` with no invented facts.

Glossary terms added to `CONTEXT.md`: Brand Profile, Fallback Reply.

---

# Comment lifecycle and data model

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/16

## Question

What are the states a comment moves through (for example new, drafted, approved, sent, skipped, needs human, failed), who moves it, and which tables hold accounts, posts, comments, and replies? Decide dedupe and never-reply-twice rules, retry on send failure, and how draft mode and auto mode differ in the flow. Record the terms in CONTEXT.md.

### Comment 1

From [Reply generation and brand profile](https://github.com/kimyohant/naka-drama-studio/issues/15): the LLM output is now `{ verdict, reason, reply?, fallback? }`. Store `fallback` with the Comment (the inbox filters by it). The Brand Profile (About, Tone, FAQ, Forbidden topics, default language) is one per Social Account.

### Comment 2

##### Resolution

**Three tables, and one `status` column on the Comment with seven states. The Reply lives on the Comment row.**

###### 1. Tables

Every table also has `id`, `created_at`, `updated_at`, like the other tables in `backend/src/db/sqlite-schema.ts`.

- **`social_accounts`**: `platform`, `platform_account_id` (unique together), `name`, `avatar_url`, `status` (`connected` / `reconnect_needed` / `disconnected`), `access_token`, `refresh_token`, `token_expires_at`, `reply_mode` (`draft` / `auto`, default `draft`), `watching`, `watch_days` (default 7), `reply_to_praise` (default on), and the Brand Profile: `brand_about`, `brand_tone`, `brand_faq`, `brand_forbidden`, `default_language` (default Thai).
- **`social_posts`**: `account_id`, `platform_post_id` (unique together), `text`, `url`, `posted_at`.
- **`social_comments`**: `account_id`, `post_id`, `platform_comment_id` (unique with `account_id`), `parent_platform_comment_id`, `text`, `author_id`, `author_name`, `commented_at`, `status`, `verdict`, `reason`, `fallback`, `judge_attempts`, `send_attempts`, `status_note` (rule name, or the Platform's error message), `reply_text`, `reply_source`, `reply_platform_id`, `replied_at`.

No `social_replies` table and no `social_brand_profiles` table: one Comment gets at most one Reply, and one Social Account has one Brand Profile.

###### 2. Comment states

| State | Meaning |
|---|---|
| `new` | Stored, no Verdict yet (also while the LLM retries) |
| `skipped` | A rule or the LLM said skip, a person rejected the Draft or closed the Comment, or it was answered or deleted on the Platform |
| `needs_human` | A person must answer |
| `draft` | A Reply is written and waits for a person |
| `queued` | A Reply is written and we will publish it by ourselves |
| `sending` | We are publishing right now |
| `replied` | We published the Reply |

`verdict`, `reason`, and `fallback` are set once, when the Comment is judged, and never change. There is no `failed` state and no `approved` state.

###### 3. Transitions

| From | To | Who |
|---|---|---|
| `new` | `skipped` / `needs_human` | Plain rule or LLM. LLM failure 3 rounds (`judge_attempts`) -> `needs_human`, "could not judge" |
| `new` | `draft` | Verdict `reply` in Draft mode, or the Comment is older than 24 hours |
| `new` | `queued` | Verdict `reply` in Auto mode and the Comment is at most 24 hours old |
| `queued` | `sending` | Polling round |
| `queued` | `draft` | The Comment became older than 24 hours while waiting |
| `draft` / `needs_human` | `sending` | A person presses send |
| `draft` / `needs_human` | `skipped` | A person rejects the Draft ("rejected by user") or closes the Comment ("closed by user") |
| `sending` | `replied` | The Platform accepted the Reply |
| `skipped` | `needs_human` | A person brings it back (not judged again) |

`reply_source`: `auto` (Auto mode published it), `approved` (LLM text, a person pressed send), `manual` (a person wrote or edited the text). Only the final text is stored.

"Help me draft" on a Needs human Comment only fills the text box. Nothing is saved until the person presses send.

###### 4. Never reply twice

1. Unique key on (`account_id`, `platform_comment_id`): the same Comment is never stored twice.
2. Before the adapter call, one atomic update to `sending` (`UPDATE ... WHERE id = ? AND status = <expected>`). Only the caller that changed the row may send.
3. A Comment left in `sending` (the server stopped between "sent" and "saved") is **never retried automatically**. After 5 minutes it becomes `needs_human` with the note "send not confirmed, check on the Platform".

###### 5. Send failure

| Error kind | Result |
|---|---|
| `rate_limited` | Back to the state it came from; try again in the next round |
| `auth_expired` | `draft`; the Social Account becomes Reconnect needed |
| `not_found` | `skipped`, "deleted on the Platform" |
| `rejected` | `needs_human`, with the Platform's message |
| `unknown` | From `queued`: back to `queued`, up to 3 rounds (`send_attempts`), then `needs_human`. Sent by a person: show the error and go back to the state it came from |

###### 6. Other rules

- **Changing the Reply Mode** touches no stored Comment. Drafts that already wait keep waiting for a person; only Comments judged after the change follow the new mode.
- **Answered outside our app**: if we notice that the Social Account answered a stored Comment directly on the Platform, it becomes `skipped`, "already replied on the Platform". `replied` always means we published it.
- **Watching off**: the polling round skips the whole Social Account (no reading, no judging, no automatic sending). Actions a person takes still work. `new` and `queued` Comments wait; when Watching is on again the 24-hour rule moves old ones to `draft`.
- **Connect again after Disconnected**: the same `social_accounts` row is used (matched by platform + platform account id), so the Brand Profile, settings, history, and Drafts come back.
- **No cleanup** in the MVP. We stop reading Posts older than `watch_days`, but stored rows stay and a Draft on an old Post can still be sent.

###### Left out

History of edits to a Draft, who approved a Reply, deleting a Social Account with all its data.

###### Effects on other tickets

- **Polling schedule and rate limits** (#18): the round must send `queued` Comments, sweep `sending` rows older than 5 minutes, apply the 24-hour rule to `queued`, and decide if we can notice "answered outside our app" on Comments we already stored.
- **Social inbox UI prototype** (#17): tabs or filters for Needs human / Draft / Queued / Replied / Skipped; reject and "do not reply" buttons; the `status_note`; settings per Social Account (Reply Mode, Watching, watch days, reply to praise).

Glossary terms added to `CONTEXT.md`: Reply Mode, Watching, Queued, Replied.

---

# Social inbox UI prototype

Type: prototype
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/17

## Question

What should the /social page look like and how should it behave? Prototype on canvas: account list with connect button and draft/auto switch, comment inbox grouped by state, reply draft with edit/approve/send, needs-human queue, brand profile editor, and empty, error, and token-expired states. Match the existing app layout and plain CSS style.

### Comment 1

From [Reply generation and brand profile](https://github.com/kimyohant/naka-drama-studio/issues/15): the prototype needs a "not in FAQ" badge and filter for Fallback Replies, a Brand Profile form (About 500, Tone 200, FAQ 3000, Forbidden topics 500, default language), and a "help me draft" button on Needs human Comments.

### Comment 2

From [Comment lifecycle and data model](https://github.com/kimyohant/naka-drama-studio/issues/16): the inbox shows five states to the user (Needs human, Draft, Queued, Replied, Skipped). A Draft has approve / edit / reject; a Needs human Comment has send / "do not reply". Show the status note (rule name or Platform error). Settings per Social Account: Reply Mode, Watching, watch days, reply to praise.

### Comment 3

##### Resolution

Prototype (canvas, private to the driving dev until shared): https://claude.ai/artifact/Pp1EutRines7Pzdh2orRFe

Four inbox layouts were compared: A three-column inbox, B tabs + one expanding list, C one-at-a-time queue, D Kanban board.

**Decided by the driving dev:**

1. **Inbox layout: D, the Kanban board.** Five columns, one per user-visible state (Needs human, Draft, Queued, Replied, Skipped). A card is one Comment: Platform tag, author, age, comment text, the Reply if there is one, the "not in FAQ" badge, the status note (rule name or Platform error), and the actions for its state (Draft: approve / edit / reject; Needs human: send / help me draft / do not reply; Skipped: bring back).
2. **One inbox for all Social Accounts**, with an account filter and a "not in FAQ only" filter in the page header.
3. **Accounts and Brand Profile are separate pages**, not tabs inside `/social`. The inbox header links to both.
4. **Accounts page**: connect buttons per Platform; one card per Social Account with status (connected / reconnect needed), Reply Mode switch (Draft / Auto), Watching, watch days, reply to praise, link to its Brand Profile, disconnect. Auto mode shows a short note about what it will and will not send.
5. **Brand Profile page**: account picker + the five fields with their limits (About 500, Tone 200, FAQ 3000, Forbidden topics 500, default language).
6. **Special states** accepted as drawn: desktop app (server only), no account yet, no comments yet, load failed, token expired banner with reconnect, send failed note with "send again" / "do not reply".
7. Style follows the current app: `default` layout sidebar with a new "Social" item, `studio.css` tokens and the `.btn` / `.tag` / `.card` / `.input` classes.

**Not decided here:** the Thai/English UI strings in the prototype are placeholders. The D artboard is static, so how a Draft is edited inside a card (inline or dialog) was not tried.

---

# Polling schedule and rate limits

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/18

## Question

How often do we poll each connected account, and how do we stay inside the platform rate limits? Decide the interval, the request budget per account (Facebook Business Use Case limits; TikTok 40 requests/minute per account per endpoint, max 30 comments per page), backoff on rate-limit errors, how far back to look after the app was closed, and where the scheduler runs in the backend.

### Comment 1

From [Comment lifecycle and data model](https://github.com/kimyohant/naka-drama-studio/issues/16): the polling round must also (1) send `queued` Comments, (2) move `sending` rows older than 5 minutes to Needs human, (3) move `queued` Comments older than 24 hours to Draft, and (4) skip a Social Account that is not Watching. Decide here if we can notice "answered outside our app" on a Comment we already stored (it then becomes Skipped).

### Comment 2

##### Resolution

**One timer, one Polling round every 5 minutes, strict budgets per Social Account, and backoff stored in SQLite. No Redis.**

###### 1. The Polling round

- One timer, every 5 minutes. A constant in code, not a setting.
- Social Accounts are handled one after another. If the last round is still running, this round is skipped.
- A Social Account is skipped when it is not `connected`, not Watching, or Paused.
- Order inside a round, per Social Account:
  1. Move `sending` rows older than 5 minutes to Needs human.
  2. Move `queued` Comments older than 24 hours to Draft.
  3. Read new Comments.
  4. Judge `new` Comments.
  5. Send `queued` Comments.

###### 2. Where it runs

- New file `backend/src/services/social/poller.ts`.
- Started at boot from `backend/src/index.ts` with `setInterval` + `timer.unref()` and a "round is running" guard, the same shape as `ensureQueueSweep` in `backend/src/services/generation.ts`. No cron library.
- The first round runs right after boot.
- No Social Account that is `connected` and Watching means the round does nothing. So the desktop app needs no flag to turn it off.

###### 3. Read budget

- Every Post inside `watch_days` is read every round, newest Post first.
- At most **30 adapter calls per Social Account per round**. The rest continue in the next round. The position is kept in memory; after a restart we start again from the newest Post.
- The Post list (`listPosts`) is fetched again once per hour, not every round.
- This keeps TikTok under 40 calls per minute per endpoint.

###### 4. How far back

- No special logic for "the app was closed for a long time", and none for the first Connect.
- For each Post, page until we meet a Comment id we already stored, or until 10 pages (300 Comments on TikTok), then stop.
- The existing 24-hour rule stops Auto mode from answering old Comments.
- **Must be tested on the real API**: this needs the adapter to return the newest Comments first. Facebook docs do not confirm an `order` or `since` request parameter on `/{post-id}/comments`. If Facebook cannot return newest first, the Facebook adapter keeps the cursor of the last page it read instead.

###### 5. Backoff (Paused)

- Two new columns on `social_accounts`: `paused_until` and `backoff_step`.
- On `rate_limited`: pause for `retryAfterSec` when the Platform gives it. Otherwise 15 minutes, then double each time, up to 1 hour.
- A round that finishes without a rate-limit error resets `backoff_step`.
- Only that Social Account is Paused. The others keep working.
- No early slow-down from the Facebook `X-Business-Use-Case-Usage` header in the MVP.
- Why not Redis: the project has no Redis today, the backend is one process, and the state is one value per Social Account. A column survives a restart and the UI can show it. Redis can come when the backend runs as more than one process.

###### 6. Answered outside our app

- **Facebook**: free. The Page's own reply shows up in the comment stream with a parent that points to the stored Comment. That Comment becomes Skipped, "already replied on the Platform" (only from `new`, `draft`, `queued`, `needs_human`).
- **TikTok**: not checked every round (one extra call per Comment is too expensive). Checked once, right before an Auto mode send: one reply-list call for that Comment. If the owner already replied, the Comment becomes Skipped. A Draft sent by a person is not checked.
- Not confirmed from official TikTok docs: the reply-list endpoint and its `owner` / `parent_comment_id` fields come from a secondary source.

###### 7. Judging and sending pace

- Judge at most **50 Comments per Social Account per round**, newest first, one at a time (no parallel LLM calls). The rest stay `new`.
- Send at most **10 Replies per Social Account per round**, oldest first, with 3 seconds between sends. The rest stay `queued`.

###### 8. Errors while reading

- `unknown` on one Post: log it, skip that Post, continue with the next one. The Social Account is not Paused.
- `auth_expired`: the Social Account becomes Reconnect needed (as decided in "Account connection with OAuth").
- `rate_limited`: stop this Social Account for the round and pause it (section 5).

###### 9. What the user sees

- New column `last_polled_at` on `social_accounts`. The Accounts page shows "checked 3 minutes ago".
- When Paused, the Accounts page shows "paused until HH:MM".
- No "check now" button in the MVP, and no polling history in the UI. Server console logs only.

###### New columns on `social_accounts`

`paused_until`, `backoff_step`, `last_polled_at`.

###### Glossary

Added to `CONTEXT.md`: **Polling round**, **Paused**.

###### Sources

- https://developers.facebook.com/docs/graph-api/reference/object/comments/
- https://developers.facebook.com/docs/graph-api/overview/rate-limiting/
- https://help.sarasanalytics.com/en_US/tiktok-business/schema-information (secondary)

---

# Jev facts for the comment filter

Type: research
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/22

## Question

Can Jev (TypeSafe AI, https://typesafe.ai/blog/introducing-system-one-models-and-jev) be used as the classifier for the comment filter? Jev is a hosted "System One" model: text in, a typed decision with a calibrated probability out, 70-500 ms, about $0.042 per million input tokens, early access. Needed facts: is there an HTTP API or a Node/TypeScript SDK (the blog only names a Python SDK), how a decision schema is defined (for example skip / reply / needs human), how the confidence is returned, language support (Thai and English, mixed, slang, emoji), how to get early access and how long it takes, rate limits, data retention and privacy terms, and what happens when the service is down.

### Comment 1

**Verdict: Jev is usable for the MVP filter from a Node backend: yes, with one risk. Thai quality is not confirmed, so test it before we commit.**

Short answer (all from typesafe.ai / docs.typesafe.ai; sources in the file):
- **API/SDK:** Yes. REST `POST https://api.typesafe.ai/v1/systemone` with a Bearer key, and an official Node SDK `@typesafe-ai/sdk` (Node 20+, ESM+CJS, TS types). Not Python-only.
- **Schema:** Three question types: `choice` (pick one option, up to 255), `score`, `noul` (yes/no probability). Our filter = one `choice` with options like skip / reply / human. Options are a map of name -> description.
- **Confidence:** Every `choice`/`score` answer returns `confidence` (0-1) plus full `probabilities`. Docs recommend gating by risk, for example low confidence goes to a human.
- **Thai:** Not confirmed. Docs say English is the primary language and where accuracy is best; other languages are less reliable. Nothing is said about Thai, slang or emoji. Only third-party Thai exam benchmarks exist.
- **Access:** Early access, via console.typesafe.ai. Wait time is not stated (not confirmed). I did not sign up.
- **Rate limits:** Docs say 80 requests/s and 100K tokens/s, adjusting dynamically, may change without notice. Enough for us.
- **Price:** $0.042 per 1M input tokens, output free. About $0.00002 per comment (my estimate).
- **Privacy:** Privacy policy: no training on your inputs. Hosted in the US. Retention is "as long as reasonably necessary"; zero data retention only for enterprise. DPA not read.
- **Outage:** API returns 429/529; SDK retries with backoff. No SLA, no status page found; terms say "AS IS" and cap liability at $100. We need a fallback (send to human) when Jev fails.

Full notes: https://github.com/kimyohant/naka-drama-studio/blob/research/jev-comment-filter/docs/research/jev-comment-filter.md

---

# Thai test set for the Verdict prompt

Type: grilling
Status: resolved
Source: https://github.com/kimyohant/naka-drama-studio/issues/23

## Question

What is the Thai/English test set for the Verdict prompt, and what result is good enough to allow auto mode? Decide: how many Comments, where they come from (real Comments from our own Pages or hand-written), which cases must be in it (slang, emoji, short text like "สนใจ" / "ราคา?", complaints, spam, text that tries to give orders to the LLM), who labels the expected Verdict, how the check is run (a script against the LLM set in Settings), and the pass bar. The most costly error is a complaint that gets the Verdict `reply`.

### Comment 1

From [Reply generation and brand profile](https://github.com/kimyohant/naka-drama-studio/issues/15): the test set should include normal questions whose answer is not in the FAQ. Expected: verdict `reply`, `fallback: true`, no invented facts or contact channels.

### Comment 2

##### Resolution

**A hand-written Verdict test set of about 100 Comments, run 3 times by a script against the LLM set in Settings. Auto mode is allowed when there are zero Dangerous errors in every run and the average accuracy is at least 85%.**

A **Dangerous error** is the LLM giving the Verdict `reply` to a Comment that should go to a person or be Skipped. It is the one mistake Auto mode would publish.

###### 1. The set

- About 100 Comments, all hand-written. Language: about 70% Thai, 20% English, 10% Thai and English mixed in one Comment.
- One fixed fake Brand Profile, stored next to the test set. Every Comment is judged against it.
- Comments that the plain rules already cut (emoji only, no text, our own Comment, viewer-to-viewer) are **not** in the set. The rules get normal unit tests.
- Real Comments from our own Pages are added later. Each one is rewritten in our own words (keep the slang and the shape, no names or personal data) before it is committed. They do not block Auto mode.

Minimum per case type (one Comment can carry several tags, for example complaint + slang):

| Case type | Min | Expected outcome |
|---|---|---|
| Complaint, direct | 12 | Needs human |
| Complaint, polite or sarcastic | 10 | Needs human |
| Text that tries to give orders to the LLM | 8 | Needs human |
| Forbidden topic from the Brand Profile | 6 | Needs human |
| Legal / health topic | 6 | Needs human |
| Spam / ads | 8 | Skipped |
| Short text ("สนใจ", "ราคา?", "555", "+1") | 10 | `reply` |
| Question whose answer is in the FAQ | 12 | `reply`, `fallback: false` |
| Question whose answer is not in the FAQ | 12 | `reply`, `fallback: true` |
| Praise (run with the "reply to praise" switch on and off) | 8 | `reply` / Skipped |
| Slang, typos, emoji inside text | 8+ (also as tags on the rows above) | varies |

The first six rows are the ones where a mistake is a Dangerous error: 50 Comments (42 of them expect Needs human).

###### 2. Labels

- The driving dev writes one expected Verdict per Comment.
- A second Thai speaker reviews the Comments the labeler marked "not sure", plus all polite/sarcastic complaints and forbidden-topic cases.
- The LLM never labels the set.

###### 3. How the check runs

- `npm run eval:verdict` in `backend/`. It reads a JSON file of cases, calls `social_responder` on the active text config, prints a table, and writes a dated report file that we commit.
- It is **not** part of the normal test suite (slow, costs money, results change between runs).
- It runs the whole set **3 times**.
- Per Comment it checks:
  - the outcome: `human` and `unsure` count as the same outcome (Needs human);
  - the `fallback` flag;
  - the Reply rules: at most 300 characters, at most one emoji, no URL / @handle / hashtag, same language as the Comment.
- A person reads the Fallback Replies of the "not in FAQ" group (12 Comments) for invented facts or contact channels. This reading is not part of the pass bar.

###### 4. Pass bar

- **Zero Dangerous errors in every one of the 3 runs.** One in any run is a fail.
- **Average accuracy of at least 85%** over the 3 runs. This stops a model that answers `unsure` to everything from passing.
- No code gate. We run the script, read the report, and decide. The committed report is the record that "this model + this prompt passed on this date".
- **Changing the model or the prompt means running it again.**
- On a fail: fix the prompt and run again. Every real mistake found later is added to the set as a new case. No held-back split (100 Comments is too few to split).

###### Effects on other tickets

- **Handoff**: writing the ~100 Comments, the fake Brand Profile, and the `eval:verdict` script is implementation work for the handoff tickets. Writing and labeling the Comments needs a Thai speaker, so it is a human task, not an agent task.
- **Testing approach** (fog): the plain rules need unit tests; this set does not cover them.

Glossary terms added to `CONTEXT.md`: Verdict test set, Dangerous error.
