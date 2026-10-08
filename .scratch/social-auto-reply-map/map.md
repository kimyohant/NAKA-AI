# Wayfinder map: Social Auto Reply

Moved from GitHub on 2026-10-08 (was https://github.com/kimyohant/naka-drama-studio/issues/8). Open tickets live in `issues/`. The answers of tickets resolved on GitHub are copied in `decisions.md`.

## Destination

One spec plus implementation tickets for **Social Auto Reply on Facebook**, ready to hand to the opencode delegator. The feature reads Comments on Posts of connected Facebook Pages and replies with an LLM. This map plans only; it writes no production code.

## Notes

- Domain: backend is Hono + Drizzle (SQLite) + Mastra; frontend is Nuxt 3 SPA with plain CSS. See `CLAUDE.md`.
- Skills for every session: `grilling` + `domain-modeling` (terms go to root `CONTEXT.md`).
- The driving dev is a non-native English speaker: write simple, direct English. Ask grilling questions in Thai, with the choices in English (a., b., c.).
- Tracking is local markdown (see `docs/agents/issue-tracker.md`). The spec and the implementation tickets go to `.scratch/social-auto-reply/` (`spec.md` + `issues/`), which is what the opencode delegator reads. This folder (`social-auto-reply-map`) holds only the map and its decision tickets, so the two `issues/` folders do not mix.
- Existing code to follow: provider factory in `backend/src/services/adapters/registry.ts` + `types.ts`; LLM comment answering in `answerComment` (`backend/src/services/ai-live.ts`).
- **Facebook only (decided 2026-10-08).** The decisions below were made when TikTok was in scope. Where a decision talks about TikTok, skip that part: no TikTok adapter, no TikTok OAuth, no TikTok env vars, no TikTok tickets. The factory, the registry, and the capabilities (`canReply`, `maxReplyChars`, `needsPublicCallback`) stay as decided, so a Platform can be added later.
- **Left to the implementer** (no decision ticket, say so in the spec): how a Draft is edited inside a Kanban card (inline or dialog), how long columns behave, and the Thai/English UI strings and error messages.
- Settled while charting (not open for re-decision):
  - Comments on Posts only.
  - Reply mode is per connected account: draft (human approves) by default, full auto optional.
  - Polling for MVP (no webhooks). Accounts can be connected only on the server deployment, so in the MVP the feature works only there; on desktop `/social` shows an empty state.
  - New sidebar page `/social`.
  - Platforms sit behind a factory (adapter + registry) so more can be added later; adapters declare capabilities.
  - Accounts connect with OAuth login, many accounts per platform.
  - Official APIs only.
  - LLM context: post text + comment + a per-account brand profile (tone, FAQ, forbidden topics).
  - Filter: skip own comments, already-replied, spam/emoji-only. Negative or complaint comments always go to a human, even in auto mode. Reply in the language of the comment.
  - Watch all posts from the last N days (default 7), with a per-account on/off switch.
  - Reply is the only action in MVP.

## Decisions so far

<!-- one line per resolved ticket; the detail is behind the link -->

- [Facebook comment API facts](decisions.md#facebook-comment-api-facts): Graph API can list (`/{post-id}/comments`) and reply (`POST /{comment-id}/comments`); `pages_manage_engagement` needs App Review, and users outside our Meta app need Advanced Access + Business Verification; code exchange needs the app secret; loopback redirect is unconfirmed.
- [TikTok comment API facts](decisions.md#tiktok-comment-api-facts): kept as a record only, TikTok is now out of scope. Official reply is possible through the TikTok API for Business Accounts, but only with a company-owned app, an approved access form, and a public HTTPS callback.
- [Register Meta and TikTok developer apps](decisions.md#register-meta-and-tiktok-developer-apps): the Meta app exists (id `1412931736955991`, use case "Manage Pages") and `pages_manage_engagement` is at Standard Access ("ready for testing"), which is enough for people with a role on the app; no App Review sent; the TikTok app is not verified, so TikTok left the scope.
- [Jev facts for the comment filter](decisions.md#jev-facts-for-the-comment-filter): usable from Node (REST endpoint and `@typesafe-ai/sdk`), a `choice` question returns the decision with a confidence; Thai accuracy is not confirmed (English is primary), early access, US-hosted, no SLA, each deployment needs its own API key.
- [Social platform factory interface](decisions.md#social-platform-factory-interface): one `SocialPlatformAdapter` per platform in `backend/src/services/social/`, looked up with `getSocialAdapter(platform)`; the adapter makes its own HTTP calls, returns one page plus a cursor, sets `isOwn`, throws `SocialPlatformError` with a `kind`, and declares three capabilities (`canReply`, `maxReplyChars`, `needsPublicCallback`); OAuth methods sit on the same adapter.
- [Account connection with OAuth](decisions.md#account-connection-with-oauth): one hosted callback (`PUBLIC_BASE_URL` + `/api/v1/social/oauth/<platform>/callback`), server deployment only; app id and secret come from env vars; tokens are plain text in SQLite and never sent to the frontend; refresh happens before an adapter call when the token expires within 10 minutes; a dead token sets the account to "reconnect needed"; Facebook login shows a list of Pages to tick.
- [Comment filter and escalation rules](decisions.md#comment-filter-and-escalation-rules): plain rules first (own, already replied on the Platform, no text, viewer-to-viewer) then one LLM call that returns `{ verdict, reason, reply? }` with Verdict `reply`/`skip`/`human`/`unsure`; no Jev and no numeric threshold in the MVP; Needs human gets no Draft; LLM failure retries 3 polling rounds then goes to a human; Skipped is visible and can be brought back; auto mode publishes only `reply` Verdicts on Comments at most 24 hours old; the only per-account setting is "reply to praise".
- [Reply generation and brand profile](decisions.md#reply-generation-and-brand-profile): new Mastra agent `social_responder` built like `live_responder`, on the active text config; Brand Profile is five free fields (About, Tone, FAQ, Forbidden topics, default language); the LLM returns `{ verdict, reason, reply?, fallback? }`; a question not in the FAQ gets a Fallback Reply written by the LLM (no facts, invite to message us) that auto mode may publish, shown with a "not in FAQ" badge; Reply is at most 300 characters, one emoji, no URL/@handle/hashtag, and a rule break is a retry, not a cut; "help me draft" is the same agent with `mode: "draft"`.
- [Comment lifecycle and data model](decisions.md#comment-lifecycle-and-data-model): three tables (`social_accounts` with the Brand Profile and settings, `social_posts`, `social_comments` with the Reply on the same row); seven Comment states (`new`, `skipped`, `needs_human`, `draft`, `queued`, `sending`, `replied`); never-reply-twice by a unique key plus an atomic move to `sending`, and a stuck `sending` goes to a human, never a retry; send errors map by kind; changing the Reply Mode touches no stored Draft; no cleanup in the MVP.
- [Social inbox UI prototype](decisions.md#social-inbox-ui-prototype): the inbox is a Kanban board with one column per user-visible state and one card per Comment, all Social Accounts together with an account filter and a "not in FAQ" filter; Accounts and Brand Profile are separate pages linked from the inbox; the drawn empty, error, and token-expired states are accepted.
- [Polling schedule and rate limits](decisions.md#polling-schedule-and-rate-limits): one Polling round every 5 minutes from `services/social/poller.ts` (`setInterval` at boot); per Social Account per round at most 30 read calls, 50 judged Comments, and 10 sent Replies 3 seconds apart; page until a known Comment or 10 pages, no special catch-up; rate-limit backoff lives in `paused_until` + `backoff_step` on `social_accounts` (15 minutes doubling to 1 hour, no Redis); "answered outside our app" is seen for free on Facebook; no "check now" button.
- [Thai test set for the Verdict prompt](decisions.md#thai-test-set-for-the-verdict-prompt): a hand-written Verdict test set of about 100 Comments (70% Thai, 20% English, 10% mixed) with minimums per case type and one fake Brand Profile; `npm run eval:verdict` runs it 3 times on the active text config and commits a dated report; Auto mode is allowed at zero Dangerous errors in every run plus average accuracy of at least 85%; no code gate, and a new model or prompt means a new run; real Comments are added later, rewritten in our own words.

## Not yet specified

Nothing. The last open question is the ticket in `issues/`.

## Out of scope

- **TikTok, the whole Platform** (ruled out 2026-10-08): the TikTok developer app is not verified yet and Facebook ships first. This also drops the "read + draft, human copies the reply" fallback. The factory stays, so TikTok comes back as a new effort, starting from [TikTok comment API facts](decisions.md#tiktok-comment-api-facts).
- Live-stream comments (stays in AI Live).
- Posting through unofficial libraries or browser automation.
- Hide, delete, like, or private message actions.
- Product data from AI Seller as LLM context.
- Per-post selection of which posts to watch.
- Webhooks (later, after polling works).
- Connecting accounts from the desktop app: it needs a relay service that holds the app secret; the MVP is for our own company on the server deployment (decided in [Account connection with OAuth](decisions.md#account-connection-with-oauth)).
