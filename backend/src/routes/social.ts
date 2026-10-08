/**
 * Social routes — /api/v1/social (Social Auto Reply).
 * Ticket 02: list comments for the board (filter by account and "not in FAQ")
 * and list accounts for the board filter (never returns tokens).
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, success } from '../utils/response.js'

const app = new Hono()

async function run(c: Context, fn: () => Promise<unknown> | unknown) {
  try {
    return success(c, await fn())
  } catch (err: any) {
    return badRequest(c, err?.message || 'Social error', err?.errorCode)
  }
}

/** Accounts for the board filter — status and settings only, never tokens. */
app.get('/accounts', c => run(c, () => {
  const rows = db.select({
    id: schema.socialAccounts.id,
    platform: schema.socialAccounts.platform,
    name: schema.socialAccounts.name,
    status: schema.socialAccounts.status,
    watching: schema.socialAccounts.watching,
    lastPolledAt: schema.socialAccounts.lastPolledAt,
  }).from(schema.socialAccounts).all()
  return { items: rows }
}))

/**
 * Comments for the board: the comment, its post text, state, verdict, reason,
 * fallback flag, status note, and reply fields.
 * Query: ?account_id=<id>&fallback_only=1
 */
app.get('/comments', c => run(c, () => {
  const accountId = c.req.query('account_id')
  const fallbackOnly = c.req.query('fallback_only')
  const conds = []
  if (accountId) {
    const id = Number(accountId)
    if (!Number.isInteger(id)) throw new Error('Invalid account_id')
    conds.push(eq(schema.socialComments.accountId, id))
  }
  if (fallbackOnly === '1' || fallbackOnly === 'true') {
    conds.push(eq(schema.socialComments.fallback, true))
  }
  const rows = db.select().from(schema.socialComments)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.socialComments.commentedAt))
    .all()
  const postIds = [...new Set(rows.map(r => r.postId).filter((v): v is number => v != null))]
  const postText = new Map<number, string | null>()
  for (const pid of postIds) {
    const [p] = db.select({ id: schema.socialPosts.id, text: schema.socialPosts.text })
      .from(schema.socialPosts).where(eq(schema.socialPosts.id, pid)).all()
    if (p) postText.set(p.id, p.text)
  }
  const accounts = new Map(
    db.select({ id: schema.socialAccounts.id, platform: schema.socialAccounts.platform })
      .from(schema.socialAccounts).all().map(a => [a.id, a.platform] as const),
  )
  return {
    items: rows.map(r => ({
      id: r.id,
      accountId: r.accountId,
      platform: accounts.get(r.accountId) ?? null,
      postId: r.postId,
      postText: r.postId != null ? (postText.get(r.postId) ?? null) : null,
      platformCommentId: r.platformCommentId,
      text: r.text,
      authorName: r.authorName,
      commentedAt: r.commentedAt,
      status: r.status,
      verdict: r.verdict,
      reason: r.reason,
      fallback: !!r.fallback,
      statusNote: r.statusNote,
      replyText: r.replyText,
      replySource: r.replySource,
      repliedAt: r.repliedAt,
    })),
  }
}))

export default app
