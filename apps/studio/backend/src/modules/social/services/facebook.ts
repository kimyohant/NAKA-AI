/**
 * Facebook Graph API adapter (ticket 09).
 *
 * Ordering path per ticket 01 ("newest first"): comments are read with
 * `order=reverse_chronological&filter=stream`, so the polling round can stop
 * paging at the first stored comment. `isOwn` compares `from.id` with the
 * GET /me id stored at connect time as `platformAccountId` (it differs from
 * the id in the Page URL). Post ids are `{pageId}_{postId}` as returned by
 * the feed. No `refreshToken`: Page tokens do not expire.
 *
 * Injectable `fetch` + base URL so tests point at a local stub, never at
 * Facebook. Every failure is thrown as `SocialPlatformError`.
 */
import type {
  ConnectableAccount,
  Page,
  SocialAccountAuth,
  SocialCapabilities,
  SocialComment,
  SocialPlatformAdapter,
  SocialPost,
} from './types.js'
import { SocialPlatformError } from './types.js'
import { registerSocialAdapter } from './registry.js'

const DEFAULT_BASE_URL = 'https://graph.facebook.com'
const DEFAULT_VERSION = 'v26.0'
const DEFAULT_AUTH_BASE_URL = 'https://www.facebook.com'
const POSTS_LIMIT = 25
const COMMENTS_LIMIT = 50

const SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_read_user_content',
  'pages_manage_engagement',
]

export interface FacebookAdapterOptions {
  fetchFn?: typeof fetch
  baseUrl?: string
  version?: string
  authBaseUrl?: string
  appId?: string
  appSecret?: string
}

interface FacebookApiError {
  message?: string
  code?: number
  error_subcode?: number
  error_data?: Record<string, unknown>
}

/** Map a Graph API error object to SocialPlatformError (ticket 09 error table). */
export function mapFacebookError(
  err: FacebookApiError,
  retryAfterHeader?: string | null,
): SocialPlatformError {
  const code = err.code ?? 0
  const message = err.message ?? 'Facebook request failed'
  if (code === 190) return new SocialPlatformError('auth_expired', message)
  if (code === 32 || (code >= 80001 && code <= 80014)) {
    const raw = err.error_data?.['retry_after_sec'] ?? err.error_data?.['retry_after']
    const fromBody = typeof raw === 'number' ? raw : Number(raw)
    const fromHeader = retryAfterHeader != null ? Number(retryAfterHeader) : NaN
    const retryAfterSec = Number.isFinite(fromBody)
      ? fromBody
      : Number.isFinite(fromHeader)
        ? fromHeader
        : undefined
    return new SocialPlatformError(
      'rate_limited',
      message,
      retryAfterSec === undefined ? undefined : { retryAfterSec },
    )
  }
  if (code === 100 && (err.error_subcode === 33 || /does not exist|not found|deleted|missing/i.test(message))) {
    return new SocialPlatformError('not_found', message)
  }
  if (code === 368 || (code === 100 && /message|comment|text|spam|abusive|blocked|prohibit|invalid|too long/i.test(message))) {
    return new SocialPlatformError('rejected', message)
  }
  return new SocialPlatformError('unknown', message, { rawMessage: message })
}

export class FacebookAdapter implements SocialPlatformAdapter {
  platform = 'facebook'
  // Facebook comments allow ~8000 chars; the 300-char reply rule is enforced by the responder.
  capabilities: SocialCapabilities = { canReply: true, maxReplyChars: 8000, needsPublicCallback: true }

  private fetchFn: typeof fetch
  private baseUrl: string
  private version: string
  private authBaseUrl: string
  private appId?: string
  private appSecret?: string

  constructor(opts: FacebookAdapterOptions = {}) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
    this.version = opts.version ?? DEFAULT_VERSION
    this.authBaseUrl = (opts.authBaseUrl ?? DEFAULT_AUTH_BASE_URL).replace(/\/+$/, '')
    this.appId = opts.appId
    this.appSecret = opts.appSecret
  }

  private cfgAppId(): string {
    const id = this.appId ?? process.env['FACEBOOK_APP_ID']
    if (!id) throw new Error('FACEBOOK_APP_ID is not set')
    return id
  }

  private cfgAppSecret(): string {
    const secret = this.appSecret ?? process.env['FACEBOOK_APP_SECRET']
    if (!secret) throw new Error('FACEBOOK_APP_SECRET is not set')
    return secret
  }

  private async fbGet<T>(path: string, token: string, params: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.version}${path}`)
    if (token) url.searchParams.set('access_token', token)
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
    let res: Response
    try {
      res = await this.fetchFn(url.toString())
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      throw new SocialPlatformError('unknown', raw, { rawMessage: raw })
    }
    return this.readJson(res)
  }

  private async fbPost<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}/${this.version}${path}`)
    const body = new URLSearchParams({ ...params, access_token: token })
    let res: Response
    try {
      res = await this.fetchFn(url.toString(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      })
    } catch (e) {
      const raw = e instanceof Error ? e.message : String(e)
      throw new SocialPlatformError('unknown', raw, { rawMessage: raw })
    }
    return this.readJson(res)
  }

  private async readJson(res: Response): Promise<any> {
    let body: any = null
    try {
      body = await res.json()
    } catch {
      body = null
    }
    if (!res.ok || body?.error) {
      throw mapFacebookError(
        body?.error ?? { message: `Facebook request failed (HTTP ${res.status})` },
        res.headers?.get('retry-after'),
      )
    }
    return body
  }

  async listPosts(account: SocialAccountAuth, since: Date, cursor?: string): Promise<Page<SocialPost>> {
    const body = await this.fbGet<any>(`/${account.platformAccountId}/feed`, account.accessToken, {
      fields: 'id,message,link,created_time',
      since: Math.floor(since.getTime() / 1000),
      limit: POSTS_LIMIT,
      after: cursor,
    })
    const items: SocialPost[] = (body.data ?? []).map((p: any) => ({
      id: String(p.id),
      text: p.message ?? '',
      url: p.link,
      createdAt: new Date(p.created_time),
    }))
    return { items, nextCursor: body.paging?.next ? body.paging?.cursors?.after : undefined }
  }

  async listComments(account: SocialAccountAuth, postId: string, cursor?: string): Promise<Page<SocialComment>> {
    const body = await this.fbGet<any>(`/${postId}/comments`, account.accessToken, {
      order: 'reverse_chronological',
      filter: 'stream',
      fields: 'id,message,from{id,name},created_time,parent{id}',
      limit: COMMENTS_LIMIT,
      after: cursor,
    })
    const items: SocialComment[] = (body.data ?? []).map((c: any) => ({
      id: String(c.id),
      postId,
      text: c.message ?? '',
      authorId: c.from?.id,
      authorName: c.from?.name,
      createdAt: new Date(c.created_time),
      isOwn: c.from?.id != null && String(c.from.id) === account.platformAccountId,
      parentId: c.parent?.id,
    }))
    return { items, nextCursor: body.paging?.next ? body.paging?.cursors?.after : undefined }
  }

  async reply(account: SocialAccountAuth, comment: SocialComment, text: string): Promise<{ replyId: string }> {
    const body = await this.fbPost<any>(`/${comment.id}/comments`, account.accessToken, { message: text })
    return { replyId: String(body.id) }
  }

  getAuthUrl(redirectUri: string, state: string): string {
    const url = new URL(`${this.authBaseUrl}/${this.version}/dialog/oauth`)
    url.searchParams.set('client_id', this.cfgAppId())
    url.searchParams.set('redirect_uri', redirectUri)
    url.searchParams.set('state', state)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', SCOPES.join(','))
    return url.toString()
  }

  async exchangeCode(code: string, redirectUri: string): Promise<ConnectableAccount[]> {
    const tokenBody = await this.fbGet<any>('/oauth/access_token', '', {
      client_id: this.cfgAppId(),
      client_secret: this.cfgAppSecret(),
      redirect_uri: redirectUri,
      code,
    })
    // User token lives only in this call: one account per Page, each with its own Page token.
    const userToken = String(tokenBody.access_token)
    const pagesBody = await this.fbGet<any>('/me/accounts', userToken, {
      fields: 'id,name,access_token,picture{url}',
      limit: 100,
    })
    const out: ConnectableAccount[] = []
    for (const p of pagesBody.data ?? []) {
      const pageToken = String(p.access_token)
      let platformAccountId = String(p.id)
      try {
        // ponytail: one extra /me call per Page; the /me id (not the URL id) is what isOwn compares.
        const me = await this.fbGet<any>('/me', pageToken, { fields: 'id' })
        if (me?.id) platformAccountId = String(me.id)
      } catch {
        // keep the accounts-list id when /me fails
      }
      out.push({
        platformAccountId,
        name: String(p.name),
        avatarUrl: p.picture?.data?.url,
        tokens: { accessToken: pageToken },
      })
    }
    return out
  }
}

/** Production singleton, registered as `facebook` (lookup is case-insensitive). */
export const facebookAdapter = new FacebookAdapter()
registerSocialAdapter(facebookAdapter)
