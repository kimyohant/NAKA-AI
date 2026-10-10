/**
 * Social platform adapter — one interface per Platform (spec: Social platform adapter).
 * Lives in its own social services folder, not with the AI generation adapters.
 */

export interface SocialCapabilities {
  canReply: boolean
  maxReplyChars: number
  needsPublicCallback: boolean
}

export interface Page<T> {
  items: T[]
  nextCursor?: string
}

export interface SocialAccountAuth {
  platformAccountId: string
  accessToken: string
  refreshToken?: string
}

export interface SocialTokens {
  accessToken: string
  refreshToken?: string
  expiresAt?: Date
}

export interface SocialPost {
  id: string
  text: string
  url?: string
  createdAt: Date
}

export interface SocialComment {
  id: string
  postId: string
  text: string
  authorId?: string
  authorName?: string
  createdAt: Date
  /** set by the adapter */
  isOwn: boolean
  /** needed by the plain rules (viewer-to-viewer, already replied) */
  parentId?: string
}

export interface ConnectableAccount {
  platformAccountId: string
  name: string
  avatarUrl?: string
  tokens: SocialTokens
}

export type SocialPlatformErrorKind =
  | 'auth_expired'
  | 'rate_limited'
  | 'not_found'
  | 'rejected'
  | 'unknown'

export class SocialPlatformError extends Error {
  kind: SocialPlatformErrorKind
  retryAfterSec?: number
  /** raw Platform message (kept on `unknown`) */
  rawMessage?: string

  constructor(kind: SocialPlatformErrorKind, message: string, opts?: { retryAfterSec?: number; rawMessage?: string }) {
    super(message)
    this.name = 'SocialPlatformError'
    this.kind = kind
    this.retryAfterSec = opts?.retryAfterSec
    this.rawMessage = opts?.rawMessage
  }
}

export interface SocialPlatformAdapter {
  platform: string
  capabilities: SocialCapabilities

  listPosts(account: SocialAccountAuth, since: Date, cursor?: string): Promise<Page<SocialPost>>
  listComments(account: SocialAccountAuth, postId: string, cursor?: string): Promise<Page<SocialComment>>
  reply(account: SocialAccountAuth, comment: SocialComment, text: string): Promise<{ replyId: string }>
  refreshToken?(account: SocialAccountAuth): Promise<SocialTokens>

  getAuthUrl(redirectUri: string, state: string): string
  exchangeCode(code: string, redirectUri: string): Promise<ConnectableAccount[]>
}
