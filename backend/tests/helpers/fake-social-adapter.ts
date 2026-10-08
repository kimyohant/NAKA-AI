/**
 * Scripted fake SocialPlatformAdapter for tests only.
 * Registered as platform `fake`. Production code must never import this file.
 */
import type {
  ConnectableAccount,
  Page,
  SocialAccountAuth,
  SocialCapabilities,
  SocialComment,
  SocialPlatformAdapter,
  SocialPlatformErrorKind,
  SocialPost,
  SocialTokens,
} from '../../src/services/social/types.js'
import { SocialPlatformError } from '../../src/services/social/types.js'

export class FakeSocialAdapter implements SocialPlatformAdapter {
  platform = 'fake'
  capabilities: SocialCapabilities = { canReply: true, maxReplyChars: 300, needsPublicCallback: false }

  posts: SocialPost[] = []
  commentsByPost = new Map<string, SocialComment[]>()
  /** kinds to throw on the next calls, in order */
  failQueue: Array<{ kind: SocialPlatformErrorKind; retryAfterSec?: number }> = []
  /** per-post comment failures, in order (checked before the shared queue) */
  commentFailures = new Map<string, Array<{ kind: SocialPlatformErrorKind; retryAfterSec?: number }>>()
  sentReplies: Array<{ account: SocialAccountAuth; comment: SocialComment; text: string }> = []
  listPostsCalls = 0
  listCommentsCalls = 0
  refreshTokenCalls = 0
  /** when true, the next refreshToken call fails */
  failRefresh = false
  /** small page size so tests exercise paging */
  pageSize = 2

  seedPosts(posts: SocialPost[]): void {
    this.posts = [...posts].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
  }

  seedComments(postId: string, comments: SocialComment[]): void {
    this.commentsByPost.set(
      postId,
      [...comments].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    )
  }

  /** unshift one comment to the front (newest) of a post */
  prependComment(postId: string, comment: SocialComment): void {
    this.seedComments(postId, [comment, ...(this.commentsByPost.get(postId) ?? [])])
  }

  failNext(kind: SocialPlatformErrorKind, retryAfterSec?: number): void {
    this.failQueue.push({ kind, retryAfterSec })
  }

  /** Fail the next `listComments` calls for one post only. */
  failCommentsFor(postId: string, kind: SocialPlatformErrorKind, retryAfterSec?: number): void {
    const q = this.commentFailures.get(postId) ?? []
    q.push({ kind, retryAfterSec })
    this.commentFailures.set(postId, q)
  }

  private maybeFail(postId?: string): void {
    if (postId) {
      const q = this.commentFailures.get(postId)
      const next = q?.shift()
      if (next) {
        throw new SocialPlatformError(next.kind, `fake ${next.kind}`, {
          retryAfterSec: next.retryAfterSec,
          rawMessage: `fake ${next.kind}`,
        })
      }
    }
    const item = this.failQueue.shift()
    if (item) {
      throw new SocialPlatformError(item.kind, `fake ${item.kind}`, {
        retryAfterSec: item.retryAfterSec,
      })
    }
  }

  private page<T>(items: T[], cursor?: string): Page<T> {
    const offset = cursor ? Number(cursor) : 0
    const slice = items.slice(offset, offset + this.pageSize)
    const next = offset + this.pageSize < items.length ? String(offset + this.pageSize) : undefined
    return { items: slice, nextCursor: next }
  }

  async listPosts(_account: SocialAccountAuth, since: Date, cursor?: string): Promise<Page<SocialPost>> {
    this.maybeFail()
    this.listPostsCalls++
    return this.page(this.posts.filter(p => p.createdAt >= since), cursor)
  }

  async listComments(_account: SocialAccountAuth, postId: string, cursor?: string): Promise<Page<SocialComment>> {
    this.maybeFail(postId)
    this.listCommentsCalls++
    return this.page(this.commentsByPost.get(postId) ?? [], cursor)
  }

  async reply(account: SocialAccountAuth, comment: SocialComment, text: string): Promise<{ replyId: string }> {
    this.maybeFail()
    this.sentReplies.push({ account, comment, text })
    return { replyId: `fake-reply-${this.sentReplies.length}` }
  }

  getAuthUrl(_redirectUri: string, _state: string): string {
    return 'https://fake.example/auth'
  }

  async exchangeCode(_code: string, _redirectUri: string): Promise<ConnectableAccount[]> {
    return []
  }

  async refreshToken(_account: SocialAccountAuth): Promise<SocialTokens> {
    this.refreshTokenCalls++
    if (this.failRefresh) {
      this.failRefresh = false
      throw new SocialPlatformError('auth_expired', 'fake refresh failed')
    }
    return { accessToken: 'fake-refreshed' }
  }
}
