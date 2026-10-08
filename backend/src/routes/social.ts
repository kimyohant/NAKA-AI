/**
 * Social routes — /api/v1/social (Social Auto Reply).
 * Ticket 02: list comments for the board (filter by account and "not in FAQ")
 * and list accounts for the board filter (never returns tokens).
 * Ticket 07: account settings + brand profile (never returns tokens).
 * Ticket 10: connect / reconnect / disconnect via OAuth (never returns tokens).
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { and, desc, eq, ne } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { badRequest, now, success } from '../utils/response.js'
import {
  bringBackComment,
  closeComment,
  helpMeDraft,
  rejectDraft,
  sendCommentAsPerson,
} from '../services/social/actions.js'
import {
  canConnect,
  finishLogin,
  pendingPages,
  startLogin,
  takePending,
} from '../services/social/oauth.js'
import type { ConnectableAccount } from '../services/social/types.js'

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

/** Update settings: reply_mode, watching, watch_days, reply_to_praise. Accepts PATCH and PUT (frontend updateSettings uses PUT). */
const updateSettings = (c: Context) => run(c, async () => {
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
})
app.patch('/accounts/:id/settings', updateSettings)
app.put('/accounts/:id/settings', updateSettings)

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
type BoardCommentRow = typeof schema.socialComments.$inferSelect

function publicComment(
  r: BoardCommentRow,
  postText: Map<number, string | null>,
  platforms: Map<number, string>,
) {
  return {
    id: r.id,
    accountId: r.accountId,
    platform: platforms.get(r.accountId) ?? null,
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
  }
}

function boardCommentMaps(rows: BoardCommentRow[]) {
  const postIds = [...new Set(rows.map(r => r.postId).filter((v): v is number => v != null))]
  const postText = new Map<number, string | null>()
  for (const pid of postIds) {
    const [p] = db.select({ id: schema.socialPosts.id, text: schema.socialPosts.text })
      .from(schema.socialPosts).where(eq(schema.socialPosts.id, pid)).all()
    if (p) postText.set(p.id, p.text)
  }
  const platforms = new Map(
    db.select({ id: schema.socialAccounts.id, platform: schema.socialAccounts.platform })
      .from(schema.socialAccounts).all().map(a => [a.id, a.platform] as const),
  )
  return { postText, platforms }
}

function publicBoardComment(r: BoardCommentRow) {
  const { postText, platforms } = boardCommentMaps([r])
  return publicComment(r, postText, platforms)
}

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
  const { postText, platforms } = boardCommentMaps(rows)
  return {
    items: rows.map(r => publicComment(r, postText, platforms)),
  }
}))

function parseCommentId(c: Context): number {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id)) throw new Error('Invalid comment id')
  return id
}

/** Approve a Draft: send the stored LLM text unchanged (`approved`). */
app.post('/comments/:id/approve', c => run(c, async () => publicBoardComment(
  await sendCommentAsPerson(parseCommentId(c)),
)))

/** Send written or edited text (`manual`); without text, the stored text. From `draft` or `needs_human`. */
app.post('/comments/:id/send', c => run(c, async () => {
  const body = await c.req.json().catch(() => ({})) as { text?: unknown }
  if (body.text !== undefined && typeof body.text !== 'string') throw new Error('Invalid text')
  return publicBoardComment(await sendCommentAsPerson(parseCommentId(c), body.text))
}))

/** Reject a Draft to `skipped` ("rejected by user"). */
app.post('/comments/:id/reject', c => run(c, () => publicBoardComment(rejectDraft(parseCommentId(c)))))

/** "Do not reply": close a Needs human (or Draft) Comment to `skipped` ("closed by user"). */
app.post('/comments/:id/close', c => run(c, () => publicBoardComment(closeComment(parseCommentId(c)))))

/** Bring back a Skipped Comment to `needs_human` (not judged again). */
app.post('/comments/:id/bring-back', c => run(c, () => publicBoardComment(bringBackComment(parseCommentId(c)))))

/** "Help me draft": return LLM text for the editor; saves and publishes nothing. */
app.post('/comments/:id/help-draft', c => run(c, async () => ({
  text: await helpMeDraft(parseCommentId(c)),
})))

/* ---- Connect / Reconnect / Disconnect (ticket 10, never returns tokens) ---- */

/** "Can I Connect, and if not why" — also drives the desktop "server only" empty state. */
app.get('/oauth/:platform/can-connect', c => success(c, canConnect(c.req.param('platform'))))

/** Start login: random single-use 10-minute state, login URL from the adapter. */
app.post('/oauth/:platform/start', c => run(c, () => startLogin(c.req.param('platform'))))

/**
 * OAuth callback: validate the state, stash the connectable Pages in server
 * memory for 10 minutes, send the browser back to the Accounts page.
 * A wrong, used, or expired state is refused with a clear error and saves nothing.
 */
app.get('/oauth/:platform/callback', async c => {
  const platform = c.req.param('platform')
  try {
    const { loginId } = await finishLogin(platform, c.req.query('code') ?? '', c.req.query('state') ?? '')
    return c.redirect(`/social/accounts?login=${encodeURIComponent(loginId)}&platform=${encodeURIComponent(platform.toLowerCase())}`, 302)
  } catch (err: any) {
    return badRequest(c, err?.message || 'Login failed')
  }
})

/** Pages waiting to be ticked (this login only): names + avatars, never tokens. */
app.get('/oauth/:platform/pending', c => run(c, () => {
  const login = c.req.query('login') ?? ''
  if (!login) throw new Error('Missing login. Please log in again.')
  return { items: pendingPages(c.req.param('platform'), login) }
}))

/** Match a stored Social Account by Platform + Platform account id. */
function findAccountRow(platform: string, platformAccountId: string) {
  const [row] = db.select().from(schema.socialAccounts).where(and(
    eq(schema.socialAccounts.platform, platform),
    eq(schema.socialAccounts.platformAccountId, platformAccountId),
  )).all()
  return row
}

/**
 * Save the ticked Pages. An already-stored Page updates the same row (new
 * tokens, status `connected`) and keeps its Brand Profile, settings, history,
 * and Drafts — this is how Reconnect and "Connect again after Disconnect" work.
 * A new Page starts in Draft mode with Watching on (column defaults).
 */
function saveConnectableAccount(platform: string, item: ConnectableAccount) {
  const ts = now()
  const expiresAt = item.tokens.expiresAt instanceof Date ? item.tokens.expiresAt.toISOString() : null
  const existing = findAccountRow(platform, item.platformAccountId)
  if (existing) {
    db.update(schema.socialAccounts).set({
      name: item.name,
      avatarUrl: item.avatarUrl ?? null,
      status: 'connected',
      accessToken: item.tokens.accessToken,
      refreshToken: item.tokens.refreshToken ?? null,
      tokenExpiresAt: expiresAt,
      updatedAt: ts,
    } as any).where(eq(schema.socialAccounts.id, existing.id)).run()
    return publicAccount(getAccountRow(existing.id))
  }
  const res = db.insert(schema.socialAccounts).values({
    platform,
    platformAccountId: item.platformAccountId,
    name: item.name,
    avatarUrl: item.avatarUrl ?? null,
    status: 'connected',
    accessToken: item.tokens.accessToken,
    refreshToken: item.tokens.refreshToken ?? null,
    tokenExpiresAt: expiresAt,
    createdAt: ts,
    updatedAt: ts,
  } as any).run()
  return publicAccount(getAccountRow(Number((res as any).lastInsertRowid)))
}

app.post('/oauth/:platform/save', c => run(c, async () => {
  const platform = c.req.param('platform').toLowerCase()
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const login = typeof body.login === 'string' ? body.login : ''
  if (!login) throw new Error('Missing login. Please log in again.')
  const raw = body.platform_account_ids ?? body.platformAccountIds ?? body.ids
  const ids = Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : []
  if (!ids.length) throw new Error('No pages selected')
  const picked = takePending(platform, login, ids)
  if (!picked.length) throw new Error('No pages selected')
  return { items: picked.map(item => saveConnectableAccount(platform, item)) }
}))

/**
 * Disconnect: delete the stored tokens, status to Disconnected. Comments and
 * Replies stay as history. No Platform call (the Facebook adapter has no revoke).
 */
app.post('/accounts/:id/disconnect', c => run(c, () => {
  const id = parseAccountId(c)
  getAccountRow(id)
  db.update(schema.socialAccounts).set({
    accessToken: null,
    refreshToken: null,
    tokenExpiresAt: null,
    status: 'disconnected',
    updatedAt: now(),
  } as any).where(eq(schema.socialAccounts.id, id)).run()
  return publicAccount(getAccountRow(id))
}))

export default app
