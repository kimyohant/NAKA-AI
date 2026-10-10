/**
 * Social person actions (ticket 05) — what a person does with a Comment on
 * the board: approve or edit a Draft, write a Reply on a Needs human Comment,
 * reject, close ("do not reply"), bring back a Skipped Comment, "help me draft".
 *
 * Sending publishes through the adapter with the never-reply-twice guard:
 * one atomic update to `sending` names the expected state, and only the
 * caller that changed the row may send. `reply_source` is `approved` for
 * stored LLM text sent unchanged, `manual` when a person wrote or edited it.
 * Hand-written text must only fit the adapter's `maxReplyChars` (the
 * 300-character / emoji / link rules are for LLM text only).
 */
import { and, eq, inArray, lt } from 'drizzle-orm'
import { db, schema } from '../../../core/db/index.js'
import { now } from '../../../core/http/response.js'
import { getSocialAdapter } from './registry.js'
import { requestDraftReply } from './responder.js'
import {
  ensureFreshToken,
  markReconnectNeeded,
  pauseAccount,
  toAuth,
} from './limits.js'
import { SocialPlatformError, type SocialComment } from './types.js'

export const SEND_STUCK_MS = 5 * 60 * 1000
export const STUCK_NOTE = 'send not confirmed, check on the Platform'
export const REJECTED_NOTE = 'rejected by user'
export const CLOSED_NOTE = 'closed by user'
export const DELETED_NOTE = 'deleted on the Platform'

/** Note stored when a person-triggered send fails but the card stays to retry. */
export function sendFailedNote(message: string): string {
  return `send failed: ${message}`
}

export function isSendFailedNote(note: string | null | undefined): boolean {
  return !!note && note.startsWith('send failed:')
}

type CommentRow = typeof schema.socialComments.$inferSelect
type AccountRow = typeof schema.socialAccounts.$inferSelect

async function getCommentRow(id: number): Promise<CommentRow> {
  const [row] = await db.select().from(schema.socialComments)
    .where(eq(schema.socialComments.id, id))
  if (!row) throw new Error('Comment not found')
  return row
}

async function getAccountRow(id: number): Promise<AccountRow> {
  const [row] = await db.select().from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, id))
  if (!row) throw new Error('Social account not found')
  return row
}

function toAdapterComment(row: CommentRow): SocialComment {
  return {
    id: row.platformCommentId,
    postId: '',
    text: row.text ?? '',
    authorId: row.authorId ?? undefined,
    authorName: row.authorName ?? undefined,
    createdAt: row.commentedAt ? new Date(row.commentedAt) : new Date(),
    isOwn: false,
  }
}

/**
 * Move a Comment to another state only when it is in one of the expected
 * states — one statement, so a move by a person and a send claim cannot both
 * win on the same row. Throws naming the state the row is really in.
 */
async function moveComment(id: number, expected: string[], set: Partial<CommentRow>, verb: string): Promise<CommentRow> {
  const [row] = await db.update(schema.socialComments).set({ ...set, updatedAt: now() })
    .where(and(eq(schema.socialComments.id, id), inArray(schema.socialComments.status, expected)))
    .returning()
  if (row) return row
  throw new Error(`Cannot ${verb} a comment in state ${(await getCommentRow(id)).status}`)
}

/**
 * Atomic claim: move the row to `sending` only when it is in one of the
 * expected states. Returns the claimed row. Throws when another caller
 * already claimed it (wrong state), so two sends give exactly one Reply.
 */
export function claimForSend(id: number, expected: string[]): Promise<CommentRow> {
  return moveComment(id, expected, { status: 'sending' }, 'send')
}

/** Send-failure table for a send by a person (ticket 05). */
async function handlePersonSendFailure(commentId: number, accountId: number, from: string, err: unknown): Promise<void> {
  const ts = now()
  const kind = err instanceof SocialPlatformError ? err.kind : 'unknown'
  const message = err instanceof Error ? err.message : 'send failed'
  if (kind === 'not_found') {
    await db.update(schema.socialComments).set({ status: 'skipped', statusNote: DELETED_NOTE, updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    return
  }
  if (kind === 'auth_expired') {
    await db.update(schema.socialComments).set({ status: 'draft', statusNote: sendFailedNote(message), updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    await db.update(schema.socialAccounts).set({ status: 'reconnect_needed', updatedAt: ts })
      .where(eq(schema.socialAccounts.id, accountId))
    return
  }
  if (kind === 'rejected') {
    await db.update(schema.socialComments).set({ status: 'needs_human', statusNote: message, updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    return
  }
  if (kind === 'rate_limited') {
    // A `rate_limited` send pauses the account (ticket 08); the card stays to retry.
    await pauseAccount(accountId, err instanceof SocialPlatformError ? err.retryAfterSec : undefined)
  }
  // rate_limited and unknown: back to the state it came from, error shown.
  await db.update(schema.socialComments).set({ status: from, statusNote: sendFailedNote(message), updatedAt: ts })
    .where(eq(schema.socialComments.id, commentId))
}

/**
 * A person sends a Comment: approve the stored Draft text (no `text` given,
 * `reply_source` `approved`) or send written/edited text (`reply_source`
 * `manual`). From `draft` or `needs_human` only. Refused when the Social
 * Account is not `connected`. Throws on failure after moving the row per
 * the error-kind table above.
 */
export async function sendCommentAsPerson(commentId: number, text?: string): Promise<CommentRow> {
  const current = await getCommentRow(commentId)
  const account = await getAccountRow(current.accountId)
  if (account.status !== 'connected') {
    throw new Error('Social account is not connected')
  }
  if (current.status !== 'draft' && current.status !== 'needs_human') {
    throw new Error(`Cannot send a comment in state ${current.status}`)
  }
  const from = current.status
  const adapter = getSocialAdapter(account.platform)
  let finalText: string
  let source: 'approved' | 'manual'
  if (text !== undefined) {
    finalText = text.trim()
    if (!finalText) throw new Error('Reply text is empty')
    const len = [...finalText].length
    if (len > adapter.capabilities.maxReplyChars) {
      throw new Error(`Reply too long for the platform (${len} > ${adapter.capabilities.maxReplyChars})`)
    }
    source = 'manual'
  } else {
    if (!current.replyText?.trim()) throw new Error('No draft text to send')
    finalText = current.replyText
    source = 'approved'
  }

  await claimForSend(commentId, [from])
  try {
    const fresh = await ensureFreshToken(account, adapter)
    if (!fresh.ok) throw new SocialPlatformError('auth_expired', 'token refresh failed')
    const { replyId } = await adapter.reply(fresh.auth, toAdapterComment(current), finalText)
    const ts = now()
    await db.update(schema.socialComments).set({
      status: 'replied',
      statusNote: null,
      replyText: finalText,
      replySource: source,
      replyPlatformId: replyId,
      repliedAt: ts,
      updatedAt: ts,
    }).where(eq(schema.socialComments.id, commentId))
  } catch (err) {
    await handlePersonSendFailure(commentId, account.id, from, err)
    throw err
  }
  return await getCommentRow(commentId)
}

/** Reject a Draft: to `skipped` with "rejected by user". */
export function rejectDraft(commentId: number): Promise<CommentRow> {
  return moveComment(commentId, ['draft'], { status: 'skipped', statusNote: REJECTED_NOTE }, 'reject')
}

/** "Do not reply": close a Needs human (or send-failed Draft) Comment to `skipped`. */
export function closeComment(commentId: number): Promise<CommentRow> {
  return moveComment(commentId, ['needs_human', 'draft'], { status: 'skipped', statusNote: CLOSED_NOTE }, 'close')
}

/** Bring back a Skipped Comment to `needs_human`. The verdict stays, so it is not judged again. */
export function bringBackComment(commentId: number): Promise<CommentRow> {
  return moveComment(commentId, ['skipped'], { status: 'needs_human' }, 'bring back')
}

/**
 * First step of a polling round: a row left in `sending` for more than
 * 5 minutes is never retried — it becomes `needs_human` so a person checks
 * the Platform before answering again.
 */
export async function reclaimStuckSending(nowMs: number = Date.now()): Promise<number> {
  const cutoff = new Date(nowMs - SEND_STUCK_MS).toISOString()
  const stuck = await db.update(schema.socialComments)
    .set({ status: 'needs_human', statusNote: STUCK_NOTE, updatedAt: now() })
    .where(and(eq(schema.socialComments.status, 'sending'), lt(schema.socialComments.updatedAt, cutoff)))
    .returning({ id: schema.socialComments.id })
  return stuck.length
}

/**
 * "Help me draft": ask `social_responder` with `mode: "draft"`. Returns the
 * text only — saves nothing, publishes nothing, verdict unchanged.
 */
export async function helpMeDraft(commentId: number): Promise<string> {
  const current = await getCommentRow(commentId)
  if (current.status !== 'needs_human' && current.status !== 'draft') {
    throw new Error(`Cannot draft for a comment in state ${current.status}`)
  }
  const account = await getAccountRow(current.accountId)
  let postText: string | null = null
  if (current.postId != null) {
    const [p] = await db.select({ text: schema.socialPosts.text }).from(schema.socialPosts)
      .where(eq(schema.socialPosts.id, current.postId))
    postText = p?.text ?? null
  }
  return requestDraftReply(account, postText, current.text)
}

// --- Auto mode (ticket 06) ---

export const MAX_AUTO_SEND_PER_ROUND = 10
export const MAX_AUTO_SEND_ATTEMPTS = 3
export const AUTO_SEND_GAP_MS = 3000
/** A `queued` comment older than this while waiting becomes a `draft`. */
export const QUEUED_MAX_AGE_MS = 24 * 3600_000

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

/**
 * Poller step 2: `queued` rows older than 24 hours become `draft` so a person
 * decides about them. The verdict and reply text stay, so the draft is
 * sendable. Returns the number of rows moved.
 */
export async function expireQueuedComments(accountId: number, nowMs: number = Date.now()): Promise<number> {
  const rows = await db.select({
    id: schema.socialComments.id,
    commentedAt: schema.socialComments.commentedAt,
  }).from(schema.socialComments)
    .where(and(
      eq(schema.socialComments.accountId, accountId),
      eq(schema.socialComments.status, 'queued'),
    ))
  const stale = rows.filter(r => {
    if (!r.commentedAt) return false
    const t = Date.parse(r.commentedAt)
    return !Number.isNaN(t) && nowMs - t > QUEUED_MAX_AGE_MS
  })
  if (!stale.length) return 0
  const ts = now()
  await db.update(schema.socialComments).set({ status: 'draft', updatedAt: ts })
    .where(and(
      eq(schema.socialComments.accountId, accountId),
      eq(schema.socialComments.status, 'queued'),
      inArray(schema.socialComments.id, stale.map(r => r.id)),
    ))
  return stale.length
}

/** Send-failure table for a `queued` auto send (ticket 06, spec error table). Returns the kind. */
async function handleQueuedSendFailure(commentId: number, accountId: number, err: unknown): Promise<string> {
  const ts = now()
  const kind = err instanceof SocialPlatformError ? err.kind : 'unknown'
  const message = err instanceof Error ? err.message : 'send failed'
  if (kind === 'not_found') {
    await db.update(schema.socialComments).set({ status: 'skipped', statusNote: DELETED_NOTE, updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    return kind
  }
  if (kind === 'auth_expired') {
    await db.update(schema.socialComments).set({ status: 'draft', statusNote: sendFailedNote(message), updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    await markReconnectNeeded(accountId)
    return kind
  }
  if (kind === 'rejected') {
    await db.update(schema.socialComments).set({ status: 'needs_human', statusNote: message, updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    return kind
  }
  if (kind === 'rate_limited') {
    // Back to `queued` for the next round, and the account is paused (ticket 08).
    await pauseAccount(accountId, err instanceof SocialPlatformError ? err.retryAfterSec : undefined)
    await db.update(schema.socialComments).set({ status: 'queued', updatedAt: ts })
      .where(eq(schema.socialComments.id, commentId))
    return kind
  }
  // unknown: back to `queued`, up to 3 rounds, then `needs_human`.
  const [current] = await db.select({ sendAttempts: schema.socialComments.sendAttempts })
    .from(schema.socialComments).where(eq(schema.socialComments.id, commentId))
  const attempts = (current?.sendAttempts ?? 0) + 1
  if (attempts >= MAX_AUTO_SEND_ATTEMPTS) {
    await db.update(schema.socialComments).set({
      status: 'needs_human', statusNote: sendFailedNote(message),
      sendAttempts: attempts, updatedAt: ts,
    }).where(eq(schema.socialComments.id, commentId))
  } else {
    await db.update(schema.socialComments).set({
      status: 'queued', statusNote: sendFailedNote(message),
      sendAttempts: attempts, updatedAt: ts,
    }).where(eq(schema.socialComments.id, commentId))
  }
  return kind
}

/**
 * Poller step 5: publish `queued` comments, oldest first, at most 10 per
 * account per round, 3 seconds apart. Uses the same atomic claim as a send by
 * a person, so a concurrent person send gives exactly one reply.
 * `reply_source` is `auto`. The gap wait is injectable so tests stay fast.
 */
export async function sendQueuedReplies(
  accountId: number,
  opts: { waitBetweenSends?: () => Promise<void> } = {},
): Promise<{ sent: number; rateLimited: boolean }> {
  const wait = opts.waitBetweenSends ?? (() => sleep(AUTO_SEND_GAP_MS))
  const [account] = await db.select().from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, accountId))
  if (!account) return { sent: 0, rateLimited: false }
  const rows = await db.select().from(schema.socialComments).where(
    and(
      eq(schema.socialComments.accountId, accountId),
      eq(schema.socialComments.status, 'queued'),
    ),
  ).orderBy(schema.socialComments.commentedAt).limit(MAX_AUTO_SEND_PER_ROUND)
  if (!rows.length) return { sent: 0, rateLimited: false }
  const adapter = getSocialAdapter(account.platform)
  const fresh = await ensureFreshToken(account, adapter)
  if (!fresh.ok) return { sent: 0, rateLimited: false }
  const auth = fresh.auth
  let sent = 0
  let rateLimited = false
  let attempted = 0
  for (const row of rows) {
    if (!row.replyText?.trim()) continue
    if (attempted > 0) await wait()
    attempted++
    let claimed: CommentRow
    try {
      claimed = await claimForSend(row.id, ['queued'])
    } catch {
      continue // a person claimed it first — their send wins
    }
    try {
      const { replyId } = await adapter.reply(auth, toAdapterComment(claimed), claimed.replyText!)
      const ts = now()
      await db.update(schema.socialComments).set({
        status: 'replied',
        statusNote: null,
        replySource: 'auto',
        replyPlatformId: replyId,
        repliedAt: ts,
        updatedAt: ts,
      }).where(eq(schema.socialComments.id, row.id))
      sent++
    } catch (err) {
      const kind = await handleQueuedSendFailure(row.id, account.id, err)
      if (kind === 'rate_limited') {
        rateLimited = true
        break // the platform said slow down — no more sends this round
      }
      if (kind === 'auth_expired') break // the account is dead until reconnect
    }
  }
  return { sent, rateLimited }
}
