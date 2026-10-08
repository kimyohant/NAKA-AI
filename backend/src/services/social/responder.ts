/**
 * Social responder — LLM verdict + draft reply (spec: Reply agent).
 * Built like the live-comment responder: one Mastra agent `social_responder`,
 * default prompt, no tools, one step, one JSON user message; this service
 * parses the JSON answer and checks the reply rules in code.
 * In this ticket every `reply` verdict becomes a Draft (auto mode is ticket 06).
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { mastra } from '../../mastra/index.js'
import { now } from '../../utils/response.js'
import { getSocialAdapter } from './registry.js'

export const SOCIAL_RESPONDER_AGENT = 'social_responder'
/** judge at most 50 comments per account per round, newest first, one at a time */
export const MAX_JUDGE_PER_ACCOUNT = 50
export const MAX_JUDGE_ATTEMPTS = 3
export const COULD_NOT_JUDGE = 'could not judge'
export const POST_TEXT_LIMIT = 1000
export const COMMENT_TEXT_LIMIT = 500
export const MAX_REPLY_CHARS = 300
const LLM_TIMEOUT_MS = 60_000

export type SocialVerdict = 'reply' | 'skip' | 'human' | 'unsure'
export type SocialJudgeMode = 'judge' | 'draft'

export interface SocialJudgeOutput {
  verdict: SocialVerdict
  reason: string
  reply?: string
  fallback?: boolean
}

export interface SocialJudgePayload {
  mode: SocialJudgeMode
  brand: { about: string; tone: string; faq: string; forbidden: string; defaultLanguage: string }
  post: string
  comment: string
  /** only when the comment answers under our own reply */
  earlierReply?: string
  replyToPraise: boolean
}

type AccountRow = typeof schema.socialAccounts.$inferSelect
type CommentRow = typeof schema.socialComments.$inferSelect

/** Build the agent input. The viewer's name is never sent. */
export function buildJudgePayload(
  account: AccountRow,
  postText: string | null | undefined,
  commentText: string | null | undefined,
  opts: { mode?: SocialJudgeMode; earlierReply?: string } = {},
): SocialJudgePayload {
  const payload: SocialJudgePayload = {
    mode: opts.mode ?? 'judge',
    brand: {
      about: account.brandAbout ?? '',
      tone: account.brandTone ?? '',
      faq: account.brandFaq ?? '',
      forbidden: account.brandForbidden ?? '',
      defaultLanguage: account.defaultLanguage ?? 'th',
    },
    post: String(postText ?? '').slice(0, POST_TEXT_LIMIT),
    comment: String(commentText ?? '').slice(0, COMMENT_TEXT_LIMIT),
    replyToPraise: !!account.replyToPraise,
  }
  if (opts.earlierReply) payload.earlierReply = opts.earlierReply
  return payload
}

const EMOJI_RE = /\p{Extended_Pictographic}/gu
const URL_RE = /https?:\/\/|www\./i
const HANDLE_RE = /(^|[\s])@[\p{L}\p{N}_.]+/u
const HASHTAG_RE = /(^|[\s])#[\p{L}\p{N}_]+/u

/**
 * Reply rules, checked in code after parsing (spec: Replies).
 * Returns the violation, or null when the reply may be stored.
 * A break is an LLM failure — the reply is never cut.
 */
export function checkReplyRules(text: string, maxReplyChars: number): string | null {
  const len = [...text].length
  if (len > MAX_REPLY_CHARS) return `reply too long (${len} > ${MAX_REPLY_CHARS})`
  if (len > maxReplyChars) return `reply too long for platform (${len} > ${maxReplyChars})`
  if ((text.match(EMOJI_RE) ?? []).length > 1) return 'reply has more than one emoji'
  if (URL_RE.test(text)) return 'reply has a URL'
  if (HANDLE_RE.test(text)) return 'reply has an @handle'
  if (HASHTAG_RE.test(text)) return 'reply has a hashtag'
  return null
}

/** First JSON object in the LLM text (tolerates code fences / prose around it). */
export function parseJudgeOutput(text: string): SocialJudgeOutput {
  const t = String(text || '').replace(/```(?:json)?/gi, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in reply')
  const parsed = JSON.parse(t.slice(start, end + 1))
  if (!['reply', 'skip', 'human', 'unsure'].includes(parsed?.verdict)) {
    throw new Error(`bad verdict: ${String(parsed?.verdict)}`)
  }
  return {
    verdict: parsed.verdict,
    reason: String(parsed?.reason ?? '').slice(0, 500),
    reply: parsed?.reply == null ? undefined : String(parsed.reply),
    fallback: !!parsed?.fallback,
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('social responder timed out')), ms)
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer)) as Promise<T>
}

/** One LLM call: send the payload, parse the answer, enforce the reply rules. */
export async function requestVerdict(
  payload: SocialJudgePayload,
  maxReplyChars: number,
): Promise<SocialJudgeOutput> {
  const agent: any = mastra.getAgent(SOCIAL_RESPONDER_AGENT)
  if (!agent) throw new Error(`${SOCIAL_RESPONDER_AGENT} agent unavailable`)
  const result: any = await withTimeout(
    agent.generate([{ role: 'user', content: JSON.stringify(payload) }], { maxSteps: 1 }),
    LLM_TIMEOUT_MS,
  )
  const parsed = parseJudgeOutput(String(result?.text || ''))
  if (parsed.verdict === 'reply') {
    const reply = (parsed.reply ?? '').trim()
    if (!reply) throw new Error('reply verdict without reply text')
    const violation = checkReplyRules(reply, maxReplyChars)
    if (violation) throw new Error(violation)
    parsed.reply = reply
  }
  return parsed
}

/**
 * "Help me draft" input for ticket 05: mode `draft` always writes a reply
 * and never judges. The stored verdict does not change; nothing is saved here.
 */
export async function requestDraftReply(
  account: AccountRow,
  postText: string | null | undefined,
  commentText: string | null | undefined,
  earlierReply?: string,
): Promise<string> {
  const maxReplyChars = getSocialAdapter(account.platform).capabilities.maxReplyChars
  const out = await requestVerdict(
    buildJudgePayload(account, postText, commentText, { mode: 'draft', earlierReply }),
    maxReplyChars,
  )
  if (!out.reply?.trim()) throw new Error('draft without reply text')
  const violation = checkReplyRules(out.reply.trim(), maxReplyChars)
  if (violation) throw new Error(violation)
  return out.reply.trim()
}

/** Our own comment/reply texts by platform id: parents a viewer answered under. */
function ownTexts(rows: CommentRow[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.statusNote === 'own comment' && r.platformCommentId && r.text) {
      map.set(r.platformCommentId, r.text)
    }
    if (r.replyPlatformId && r.replyText) map.set(r.replyPlatformId, r.replyText)
  }
  return map
}

function applyVerdict(row: CommentRow, out: SocialJudgeOutput, ts: string): void {
  const base = {
    verdict: out.verdict,
    reason: out.reason || null,
    fallback: out.verdict === 'reply' ? !!out.fallback : false,
    updatedAt: ts,
  }
  if (out.verdict === 'reply') {
    db.update(schema.socialComments).set({
      ...base, status: 'draft', statusNote: null, replyText: out.reply!,
    }).where(eq(schema.socialComments.id, row.id)).run()
  } else if (out.verdict === 'skip') {
    db.update(schema.socialComments).set({
      ...base, status: 'skipped', statusNote: out.reason || null, replyText: null,
    }).where(eq(schema.socialComments.id, row.id)).run()
  } else {
    db.update(schema.socialComments).set({
      ...base, status: 'needs_human', statusNote: out.reason || null, replyText: null,
    }).where(eq(schema.socialComments.id, row.id)).run()
  }
}

function applyFailure(row: CommentRow, ts: string): void {
  const attempts = (row.judgeAttempts ?? 0) + 1
  if (attempts >= MAX_JUDGE_ATTEMPTS) {
    db.update(schema.socialComments).set({
      status: 'needs_human', statusNote: COULD_NOT_JUDGE,
      replyText: null, judgeAttempts: attempts, updatedAt: ts,
    }).where(eq(schema.socialComments.id, row.id)).run()
  } else {
    db.update(schema.socialComments).set({ judgeAttempts: attempts, updatedAt: ts })
      .where(eq(schema.socialComments.id, row.id)).run()
  }
}

/**
 * Judging step of the polling round (ticket 04): after the plain rules, judge
 * the remaining `new` comments without a verdict, newest first, one at a time,
 * at most 50 per account per round. A comment that already has a verdict is
 * never judged again. LLM failure keeps the comment `new` for the next round;
 * after 3 failed rounds it becomes `needs_human` with "could not judge".
 */
export async function judgeNewComments(accountId: number): Promise<{ judged: number }> {
  const [account] = db.select().from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.id, accountId)).all()
  if (!account) return { judged: 0 }
  let maxReplyChars: number
  try {
    maxReplyChars = getSocialAdapter(account.platform).capabilities.maxReplyChars
  } catch {
    return { judged: 0 }
  }

  const rows = db.select().from(schema.socialComments).where(
    and(
      eq(schema.socialComments.accountId, accountId),
      eq(schema.socialComments.status, 'new'),
      isNull(schema.socialComments.verdict),
    ),
  ).orderBy(desc(schema.socialComments.commentedAt)).limit(MAX_JUDGE_PER_ACCOUNT).all()
  if (!rows.length) return { judged: 0 }

  const allRows = db.select().from(schema.socialComments)
    .where(eq(schema.socialComments.accountId, accountId)).all()
  const own = ownTexts(allRows)
  const postText = new Map<number, string | null>()
  for (const r of rows) {
    if (r.postId == null || postText.has(r.postId)) continue
    const [p] = db.select({ id: schema.socialPosts.id, text: schema.socialPosts.text })
      .from(schema.socialPosts).where(eq(schema.socialPosts.id, r.postId)).all()
    postText.set(r.postId, p?.text ?? null)
  }

  let judged = 0
  for (const row of rows) {
    const ts = now()
    try {
      const parentId = row.parentPlatformCommentId
      const out = await requestVerdict(
        buildJudgePayload(account, row.postId != null ? postText.get(row.postId) : null, row.text, {
          earlierReply: parentId && own.has(parentId) ? own.get(parentId) : undefined,
        }),
        maxReplyChars,
      )
      applyVerdict(row, out, ts)
      judged++
    } catch (err) {
      console.error(`Social judge failed for comment ${row.id}:`, (err as Error)?.message)
      applyFailure(row, ts)
    }
  }
  return { judged }
}
