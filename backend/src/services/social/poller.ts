/**
 * Social poller — one timer started at backend boot, one round every 5 minutes,
 * built like the generation queue sweep: setInterval, unref'd, running guard.
 * The first round runs right after boot. Per connected + watching account:
 * (1) stuck sending reclaim runs once globally first, then per account
 * (2) queued older than 24h to draft, (3) read new comments, (4) judge them,
 * (5) send queued replies.
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { now } from '../../utils/response.js'
import { reclaimStuckSending, expireQueuedComments, sendQueuedReplies } from './actions.js'
import { SKIP_ALREADY_REPLIED, SKIP_OWN, collectPlainRuleContext, judgePlainRule } from './filter.js'
import { judgeNewComments } from './responder.js'
import { getSocialAdapter } from './registry.js'
import {
  MAX_COMMENT_PAGES_PER_POST,
  MAX_READ_CALLS_PER_ACCOUNT,
  POSTS_CACHE_TTL_MS,
  ensureFreshToken,
  isPaused,
  markReconnectNeeded,
  pauseAccount,
  resetBackoff,
  setLastPolled,
} from './limits.js'
import { SocialPlatformError, type SocialComment, type SocialPost } from './types.js'

export const SOCIAL_POLL_INTERVAL_MS = 5 * 60 * 1000

let pollRunning = false
let pollTimer: ReturnType<typeof setInterval> | null = null

export interface SocialPollResult {
  skipped: boolean
  accounts: number
  newComments: number
}

/**
 * In-memory read position per account (ticket 08): the cached post list
 * (refreshed once per hour) plus where comment reading stopped when the
 * 30-call budget ran out. The next round continues there. A restart clears
 * this map, so reading starts again from the newest post.
 */
interface AccountReadState {
  posts: SocialPost[]
  fetchedAt: number
  nextPostIdx: number
}

const readState = new Map<number, AccountReadState>()

/** Test hook: forget cached post lists and resume positions (simulates a restart). */
export function __resetSocialPollerState(): void {
  readState.clear()
}

/**
 * Judging step — plain rules only (ticket 03, no LLM call).
 * `new` rows matching a rule become `skipped` with the rule name.
 * An own comment read back whose parent is a stored row in
 * `new`/`draft`/`queued`/`needs_human` marks that row `skipped`
 * ("answered outside our app"). `replied` rows never change, and our own
 * published reply (stored `replyPlatformId`) never counts for its own row.
 */
function judgeFreshComments(accountId: number, fresh: SocialComment[]): void {
  const rows = db.select().from(schema.socialComments)
    .where(eq(schema.socialComments.accountId, accountId)).all()
  if (!rows.length) return

  const extraOwnIds = new Set<string>()
  for (const r of rows) {
    if (r.statusNote === SKIP_OWN && r.platformCommentId) extraOwnIds.add(r.platformCommentId)
    if (r.replyPlatformId) extraOwnIds.add(r.replyPlatformId)
  }
  const ctx = collectPlainRuleContext(fresh, extraOwnIds)
  const freshById = new Map(fresh.map(c => [c.id, c] as const))

  const ts = now()
  const markSkipped = (row: typeof rows[number], note: string) => {
    db.update(schema.socialComments)
      .set({ status: 'skipped', statusNote: note, updatedAt: ts })
      .where(eq(schema.socialComments.id, row.id)).run()
  }

  for (const row of rows) {
    if (row.status !== 'new') continue
    const note = judgePlainRule({
      id: row.platformCommentId,
      text: row.text,
      isOwn: freshById.get(row.platformCommentId)?.isOwn ?? false,
      parentId: row.parentPlatformCommentId ?? freshById.get(row.platformCommentId)?.parentId,
    }, ctx)
    if (note) markSkipped(row, note)
  }

  const byPlatformId = new Map(rows.map(r => [r.platformCommentId, r] as const))
  for (const c of fresh) {
    if (!c.isOwn || !c.parentId) continue
    const target = byPlatformId.get(c.parentId)
    if (!target || target.status === 'replied' || target.status === 'skipped') continue
    if (target.status !== 'new' && target.status !== 'draft'
      && target.status !== 'queued' && target.status !== 'needs_human') continue
    if (target.replyPlatformId && target.replyPlatformId === c.id) continue
    markSkipped(target, SKIP_ALREADY_REPLIED)
  }
}

async function pollAccount(
  account: typeof schema.socialAccounts.$inferSelect,
  opts: { waitBetweenSends?: () => Promise<void> } = {},
): Promise<number> {
  const adapter = getSocialAdapter(account.platform)

  // Token refresh before any adapter call (no-op unless expiring <10min).
  const fresh = await ensureFreshToken(account, adapter)
  if (!fresh.ok) {
    setLastPolled(account.id)
    return 0
  }
  const auth = fresh.auth

  const since = new Date(Date.now() - (account.watchDays ?? 7) * 86400_000)
  let readCalls = 0
  let stored = 0
  /** every comment the Platform returned this round, including already-known ones */
  const freshComments: SocialComment[] = []

  // Step 2: queued comments that aged past 24h become drafts, never auto-sent.
  expireQueuedComments(account.id)

  const finish = (): number => {
    setLastPolled(account.id)
    return stored
  }

  // Post list: fetched once per hour, newest post first. The rest of the
  // budget stays for comments; the next round reuses the cache.
  let state = readState.get(account.id)
  if (!state || Date.now() - state.fetchedAt >= POSTS_CACHE_TTL_MS) {
    const posts: SocialPost[] = []
    let postCursor: string | undefined
    for (;;) {
      if (readCalls >= MAX_READ_CALLS_PER_ACCOUNT) break
      let page
      try {
        page = await adapter.listPosts(auth, since, postCursor)
      } catch (err) {
        readCalls++
        if (err instanceof SocialPlatformError && err.kind === 'auth_expired') {
          markReconnectNeeded(account.id)
          return finish()
        }
        if (err instanceof SocialPlatformError && err.kind === 'rate_limited') {
          pauseAccount(account.id, err.retryAfterSec)
          return finish()
        }
        console.error(`Social poll: post list failed for account ${account.id}:`, (err as Error)?.message)
        break
      }
      readCalls++
      for (const p of page.items) {
        if (p.createdAt >= since) posts.push(p)
      }
      if (!page.nextCursor) break
      postCursor = page.nextCursor
    }
    posts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    state = { posts, fetchedAt: Date.now(), nextPostIdx: 0 }
    readState.set(account.id, state)
  }

  const known = new Set(
    db.select({ platformCommentId: schema.socialComments.platformCommentId })
      .from(schema.socialComments)
      .where(eq(schema.socialComments.accountId, account.id))
      .all()
      .map(r => r.platformCommentId),
  )

  const ts = now()
  for (const post of state.posts) {
    db.insert(schema.socialPosts).values({
      accountId: account.id,
      platformPostId: post.id,
      text: post.text,
      url: post.url ?? null,
      postedAt: post.createdAt.toISOString(),
      createdAt: ts,
      updatedAt: ts,
    }).onConflictDoNothing({ target: [schema.socialPosts.accountId, schema.socialPosts.platformPostId] }).run()
  }

  // Comment reading resumes where the last round stopped (budget ran out).
  let idx = state.nextPostIdx < state.posts.length ? state.nextPostIdx : 0
  for (; idx < state.posts.length; idx++) {
    if (readCalls >= MAX_READ_CALLS_PER_ACCOUNT) break
    const post = state.posts[idx]
    const [postRow] = db.select({ id: schema.socialPosts.id })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.accountId, account.id), eq(schema.socialPosts.platformPostId, post.id)))
      .all()
    let commentCursor: string | undefined
    let postDone = true
    for (let pageNo = 0; pageNo < MAX_COMMENT_PAGES_PER_POST; pageNo++) {
      if (readCalls >= MAX_READ_CALLS_PER_ACCOUNT) {
        postDone = false
        break
      }
      let page
      try {
        page = await adapter.listComments(auth, post.id, commentCursor)
      } catch (err) {
        readCalls++
        if (err instanceof SocialPlatformError && err.kind === 'auth_expired') {
          state.nextPostIdx = idx
          markReconnectNeeded(account.id)
          return finish()
        }
        if (err instanceof SocialPlatformError && err.kind === 'rate_limited') {
          state.nextPostIdx = idx
          pauseAccount(account.id, err.retryAfterSec)
          return finish()
        }
        // `unknown` on one post: log it, skip that post, keep the others.
        console.error(`Social poll: comments failed for post ${post.id}:`, (err as Error)?.message)
        break
      }
      readCalls++
      freshComments.push(...page.items)
      let stop = false
      for (const c of page.items) {
        if (known.has(c.id)) {
          stop = true
          break
        }
        const cts = now()
        db.insert(schema.socialComments).values({
          accountId: account.id,
          postId: postRow?.id ?? null,
          platformCommentId: c.id,
          parentPlatformCommentId: c.parentId ?? null,
          text: c.text,
          authorId: c.authorId ?? null,
          authorName: c.authorName ?? null,
          commentedAt: c.createdAt.toISOString(),
          status: 'new',
          createdAt: cts,
          updatedAt: cts,
        }).onConflictDoNothing({ target: [schema.socialComments.accountId, schema.socialComments.platformCommentId] }).run()
        known.add(c.id)
        stored++
      }
      if (stop || !page.nextCursor) break
      commentCursor = page.nextCursor
    }
    if (!postDone) break
  }
  state.nextPostIdx = idx >= state.posts.length ? 0 : idx

  judgeFreshComments(account.id, freshComments)

  // Step 4: LLM judging — remaining `new` comments get one verdict each.
  // A `reply` verdict queues in Auto mode (comment at most 24h old).
  await judgeNewComments(account.id)

  // Step 5: send queued replies, oldest first, at most 10, 3 seconds apart.
  // A rate-limited send already paused the account — stop the round.
  const sendRes = await sendQueuedReplies(account.id, { waitBetweenSends: opts.waitBetweenSends })
  if (sendRes.rateLimited) return finish()

  // A round that finishes without a rate-limit error resets the step.
  resetBackoff(account.id)
  return finish()
}

/** One polling round. Callable directly from a test; the send gap wait is injectable. */
export async function runSocialPollRound(
  opts: { waitBetweenSends?: () => Promise<void> } = {},
): Promise<SocialPollResult> {
  if (pollRunning) return { skipped: true, accounts: 0, newComments: 0 }
  pollRunning = true
  try {
    // First step: stuck `sending` rows are never retried — to `needs_human`.
    reclaimStuckSending()
    const accounts = db.select().from(schema.socialAccounts).all()
    let newComments = 0
    let handled = 0
    for (const account of accounts) {
      if (account.status !== 'connected' || !account.watching || isPaused(account)) continue
      handled++
      try {
        newComments += await pollAccount(account, opts)
      } catch (err) {
        console.error(`Social poll failed for account ${account.id}:`, (err as Error)?.message)
      }
    }
    return { skipped: false, accounts: handled, newComments }
  } finally {
    pollRunning = false
  }
}

/** Test helper: observe the running guard. */
export function isSocialPollRunning(): boolean {
  return pollRunning
}

export function startSocialPoller(): void {
  if (pollTimer) return
  void runSocialPollRound().catch(err => console.error('Social poll round failed:', err?.message))
  pollTimer = setInterval(() => {
    void runSocialPollRound().catch(err => console.error('Social poll round failed:', err?.message))
  }, SOCIAL_POLL_INTERVAL_MS)
  pollTimer.unref?.()
}

export function stopSocialPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}
