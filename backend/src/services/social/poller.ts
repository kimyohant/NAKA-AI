/**
 * Social poller — one timer started at backend boot, one round every 5 minutes,
 * built like the generation queue sweep: setInterval, unref'd, running guard.
 * The first round runs right after boot. In this ticket a round does the
 * reading step plus the judging step: for each connected + watching account, list posts inside
 * watch_days, page each post's comments until an already-stored comment id,
 * and store new comments with state `new`.
 */
import { and, eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { now } from '../../utils/response.js'
import { SKIP_ALREADY_REPLIED, SKIP_OWN, collectPlainRuleContext, judgePlainRule } from './filter.js'
import { judgeNewComments } from './responder.js'
import { getSocialAdapter } from './registry.js'
import type { SocialAccountAuth, SocialComment } from './types.js'

export const SOCIAL_POLL_INTERVAL_MS = 5 * 60 * 1000
const MAX_READ_CALLS_PER_ACCOUNT = 30
const MAX_COMMENT_PAGES_PER_POST = 10

let pollRunning = false
let pollTimer: ReturnType<typeof setInterval> | null = null

export interface SocialPollResult {
  skipped: boolean
  accounts: number
  newComments: number
}

function toAuth(account: typeof schema.socialAccounts.$inferSelect): SocialAccountAuth {
  return {
    platformAccountId: account.platformAccountId,
    accessToken: account.accessToken ?? '',
    refreshToken: account.refreshToken ?? undefined,
  }
}

function paused(account: typeof schema.socialAccounts.$inferSelect): boolean {
  if (!account.pausedUntil) return false
  return Date.parse(account.pausedUntil) > Date.now()
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
): Promise<number> {
  const adapter = getSocialAdapter(account.platform)
  const auth = toAuth(account)
  const since = new Date(Date.now() - (account.watchDays ?? 7) * 86400_000)
  let readCalls = 0
  let stored = 0
  /** every comment the Platform returned this round, including already-known ones */
  const fresh: SocialComment[] = []

  const known = new Set(
    db.select({ platformCommentId: schema.socialComments.platformCommentId })
      .from(schema.socialComments)
      .where(eq(schema.socialComments.accountId, account.id))
      .all()
      .map(r => r.platformCommentId),
  )

  // Post list, newest first — follow cursors within the read budget.
  const posts: Array<{ id: string; text: string; url?: string; createdAt: Date }> = []
  let postCursor: string | undefined
  for (;;) {
    if (readCalls >= MAX_READ_CALLS_PER_ACCOUNT) break
    const page = await adapter.listPosts(auth, since, postCursor)
    readCalls++
    for (const p of page.items) {
      if (p.createdAt >= since) posts.push(p)
    }
    if (!page.nextCursor) break
    postCursor = page.nextCursor
  }

  const ts = now()
  for (const post of posts) {
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

  for (const post of posts) {
    if (readCalls >= MAX_READ_CALLS_PER_ACCOUNT) break
    const [postRow] = db.select({ id: schema.socialPosts.id })
      .from(schema.socialPosts)
      .where(and(eq(schema.socialPosts.accountId, account.id), eq(schema.socialPosts.platformPostId, post.id)))
      .all()
    let commentCursor: string | undefined
    for (let pageNo = 0; pageNo < MAX_COMMENT_PAGES_PER_POST; pageNo++) {
      if (readCalls >= MAX_READ_CALLS_PER_ACCOUNT) break
      const page = await adapter.listComments(auth, post.id, commentCursor)
      readCalls++
      fresh.push(...page.items)
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
  }

  judgeFreshComments(account.id, fresh)

  // Ticket 04: LLM judging step — remaining `new` comments get one verdict each.
  await judgeNewComments(account.id)

  db.update(schema.socialAccounts)
    .set({ lastPolledAt: now(), updatedAt: now() })
    .where(eq(schema.socialAccounts.id, account.id))
    .run()
  return stored
}

/** One polling round (reading step only). Callable directly from a test. */
export async function runSocialPollRound(): Promise<SocialPollResult> {
  if (pollRunning) return { skipped: true, accounts: 0, newComments: 0 }
  pollRunning = true
  try {
    const accounts = db.select().from(schema.socialAccounts).all()
    let newComments = 0
    let handled = 0
    for (const account of accounts) {
      if (account.status !== 'connected' || !account.watching || paused(account)) continue
      handled++
      try {
        newComments += await pollAccount(account)
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
