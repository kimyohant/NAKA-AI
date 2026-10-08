/**
 * Comment filter — plain rules (spec: Comment filter).
 * Runs before any LLM call. A `new` comment matching a rule becomes
 * `skipped` with the rule name as the status note. Anything else stays
 * `new` for the LLM judge (ticket 04).
 */
import type { SocialComment } from './types.js'

export const SKIP_OWN = 'own comment'
export const SKIP_ALREADY_REPLIED = 'already replied on the Platform'
export const SKIP_NO_TEXT = 'no text to answer'
export const SKIP_VIEWER_TO_VIEWER = 'reply to another viewer'

/** @mentions are noise, stripped before the no-text check. */
const MENTION_RE = /@[\p{L}\p{N}_.]+/gu

/**
 * True when there is nothing to answer: after trimming, only emoji,
 * punctuation, @mentions, or no text. Digits and letters (any language)
 * count as content, so "555", "+1", "สนใจ" and "ราคา?" all pass.
 */
export function isNothingToAnswer(text: string | null | undefined): boolean {
  if (text == null) return true
  const withoutMentions = text.replace(MENTION_RE, '')
  return !/[\p{L}\p{N}]/u.test(withoutMentions)
}

export interface PlainRuleContext {
  /** platform ids of our own comments: fresh reads, stored own rows, our published replies */
  ownIds: Set<string>
  /** ids that already have one of our own comments under them */
  repliedIds: Set<string>
}

export interface PlainRuleInput {
  id: string
  text: string | null | undefined
  isOwn: boolean
  parentId?: string | null
}

/**
 * One rule check. Returns the status note when the comment is cut,
 * null when it passes every rule and stays `new`.
 * Order: own, already replied, no text, viewer-to-viewer.
 */
export function judgePlainRule(comment: PlainRuleInput, ctx: PlainRuleContext): string | null {
  if (comment.isOwn) return SKIP_OWN
  if (ctx.repliedIds.has(comment.id)) return SKIP_ALREADY_REPLIED
  if (isNothingToAnswer(comment.text)) return SKIP_NO_TEXT
  if (comment.parentId && !ctx.ownIds.has(comment.parentId)) return SKIP_VIEWER_TO_VIEWER
  return null
}

/** Adapter shape used by the poller: collects the own/replied id sets. */
export function collectPlainRuleContext(comments: SocialComment[], extraOwnIds: Iterable<string> = []): PlainRuleContext {
  const ownIds = new Set<string>(extraOwnIds)
  const repliedIds = new Set<string>()
  for (const c of comments) {
    if (c.isOwn) {
      ownIds.add(c.id)
      if (c.parentId) repliedIds.add(c.parentId)
    }
  }
  return { ownIds, repliedIds }
}
