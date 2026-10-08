/**
 * Social routes — /api/v1/social (Social Auto Reply).
 * Ticket 02: list comments for the board (filter by account and "not in FAQ")
 * and list accounts for the board filter (never returns tokens).
 * Ticket 07: account settings + brand profile (never returns tokens).
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, desc, eq, ne } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, now, success } from '../utils/response.js'

const app = new Hono()

async function run(c: Context, fn: () => Promise<unknown> | unknown) {
  try {
    return success(c, await fn())
  } catch (err: any) {
    return badRequest(c, err?.message || 'Social error', err?.errorCode)
  }
}

/** Accounts for the board filter and the Accounts page — never tokens, no disconnected rows. */
app.get('/accounts', c => run(c, () => {
  const rows = db.select({
    id: schema.socialAccounts.id,
    platform: schema.socialAccounts.platform,
    name: schema.socialAccounts.name,
    avatarUrl: schema.socialAccounts.avatarUrl,
    status: schema.socialAccounts.status,
    replyMode: schema.socialAccounts.replyMode,
    watching: schema.socialAccounts.watching,
    watchDays: schema.socialAccounts.watchDays,
    replyToPraise: schema.socialAccounts.replyToPraise,
    tokenExpiresAt: schema.socialAccounts.tokenExpiresAt,
    lastPolledAt: schema.socialAccounts.lastPolledAt,
    pausedUntil: schema.socialAccounts.pausedUntil,
  }).from(schema.socialAccounts).where(ne(schema.socialAccounts.status, 'disconnected')).all()
  return {
    items: rows.map(r => ({
      ...r,
      watching: !!r.watching,
      replyToPraise: !!r.replyToPraise,
    })),
  }
}))

function parseAccountId(c: Context): number {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new Error('Invalid account id')
  return id
}

function getAccountRow(id: number) {
  const [row] = db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)).all()
  if (!row) throw new Error('Social account not found')
  return row
}

/** Public account shape — named columns only, so tokens can never leak. */
function publicAccount(row: typeof schema.socialAccounts.$inferSelect) {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    avatarUrl: row.avatarUrl,
    status: row.status,
    replyMode: row.replyMode,
    watching: !!row.watching,
    watchDays: row.watchDays,
    replyToPraise: !!row.replyToPraise,
    tokenExpiresAt: row.tokenExpiresAt,
    lastPolledAt: row.lastPolledAt,
    pausedUntil: row.pausedUntil,
  }
}

function asBool(v: unknown, field: string): boolean {
  if (v === true || v === 1) return true
  if (v === false || v === 0) return false
  throw new Error(`Invalid ${field}`)
}

/** Update settings: reply_mode, watching, watch_days, reply_to_praise. */
app.patch('/accounts/:id/settings', c => run(c, async () => {
  const id = parseAccountId(c)
  getAccountRow(id)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  if (body.reply_mode !== undefined || body.replyMode !== undefined) {
    const v = body.reply_mode ?? body.replyMode
    if (v !== 'draft' && v !== 'auto') throw new Error('Invalid reply_mode')
    updates.replyMode = v
  }
  if (body.watching !== undefined) updates.watching = asBool(body.watching, 'watching')
  if (body.watch_days !== undefined || body.watchDays !== undefined) {
    const v = body.watch_days ?? body.watchDays
    if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 30) throw new Error('Invalid watch_days')
    updates.watchDays = v
  }
  if (body.reply_to_praise !== undefined || body.replyToPraise !== undefined) {
    updates.replyToPraise = asBool(body.reply_to_praise ?? body.replyToPraise, 'reply_to_praise')
  }
  if (!Object.keys(updates).length) throw new Error('No settings to update')
  db.update(schema.socialAccounts).set({ ...updates, updatedAt: now() } as any).where(eq(schema.socialAccounts.id, id)).run()
  return publicAccount(getAccountRow(id))
}))

export const BRAND_LIMITS = { about: 500, tone: 200, faq: 3000, forbidden: 500 } as const
const BRAND_LANGS = ['th', 'en'] as const

function publicBrand(row: typeof schema.socialAccounts.$inferSelect) {
  return {
    accountId: row.id,
    about: row.brandAbout ?? '',
    tone: row.brandTone ?? '',
    faq: row.brandFaq ?? '',
    forbidden: row.brandForbidden ?? '',
    defaultLanguage: row.defaultLanguage,
  }
}

/** Read the Brand Profile of one account. */
app.get('/accounts/:id/brand', c => run(c, () => publicBrand(getAccountRow(parseAccountId(c)))))

/** Update the Brand Profile. All text fields may be empty; lengths enforced. */
app.put('/accounts/:id/brand', c => run(c, async () => {
  const id = parseAccountId(c)
  getAccountRow(id)
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const updates: Record<string, unknown> = {}
  const fields = [
    ['about', 'brandAbout', BRAND_LIMITS.about, body.about ?? body.brandAbout],
    ['tone', 'brandTone', BRAND_LIMITS.tone, body.tone ?? body.brandTone],
    ['faq', 'brandFaq', BRAND_LIMITS.faq, body.faq ?? body.brandFaq],
    ['forbidden', 'brandForbidden', BRAND_LIMITS.forbidden, body.forbidden ?? body.brandForbidden],
  ] as const
  for (const [label, col, limit, v] of fields) {
    if (v === undefined) continue
    if (typeof v !== 'string') throw new Error(`Invalid ${label}`)
    if (v.length > limit) throw new Error(`Invalid ${label}: at most ${limit} characters`)
    updates[col] = v
  }
  const lang = body.default_language ?? body.defaultLanguage
  if (lang !== undefined) {
    if (typeof lang !== 'string' || !(BRAND_LANGS as readonly string[]).includes(lang)) {
      throw new Error('Invalid default_language')
    }
    updates.defaultLanguage = lang
  }
  if (!Object.keys(updates).length) throw new Error('No brand fields to update')
  db.update(schema.socialAccounts).set({ ...updates, updatedAt: now() } as any).where(eq(schema.socialAccounts.id, id)).run()
  return publicBrand(getAccountRow(id))
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
