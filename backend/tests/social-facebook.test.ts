/**
 * Social Auto Reply ticket 09 — Facebook adapter against a local HTTP stub.
 * Temp SQLite via SQLITE_PATH, node:test. Covers: listPosts paging, listComments
 * paging + parent id + newest-first params, isOwn, reply, error mapping,
 * getAuthUrl, exchangeCode (one account per Page, no user token), registry
 * lookup. Never touches a real Facebook address: every request hits 127.0.0.1.
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, after } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-fb-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')
process.env.FACEBOOK_APP_ID = 'test-app-id-123'
process.env.FACEBOOK_APP_SECRET = 'test-app-secret-abc'

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const { FacebookAdapter } = await import('../src/services/social/facebook.js')
const { getSocialAdapter } = await import('../src/services/social/registry.js')
const { SocialPlatformError } = await import('../src/services/social/types.js')

const PAGE_ID = 'me-page-id-1'
const POST_ID = `${PAGE_ID}_post-1`
const VIEWER_ID = 'viewer-9'
const PAGE_TOKEN = 'PAGE-TOKEN-1'
const USER_TOKEN = 'USER-TOKEN-SECRET'

const seen: Array<{ method: string; url: string; body: string }> = []
let injected: { prefix: string; status: number; payload: unknown } | null = null

const stub = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => (body += d))
  req.on('end', () => {
    seen.push({ method: req.method!, url: req.url!, body })
    const json = (code: number, data: unknown) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(data))
    }
    const u = new URL(req.url!, 'http://stub')
    if (injected && u.pathname.startsWith(injected.prefix)) {
      const payload = injected.payload
      injected = null // one-shot
      return json(400, payload)
    }
    if (u.pathname === '/vTest/oauth/access_token') return json(200, { access_token: USER_TOKEN, token_type: 'bearer' })
    if (u.pathname === '/vTest/me/accounts') {
      return json(200, {
        data: [
          { id: 'page-1', name: 'Page One', access_token: 'PAGE-TOKEN-1', picture: { data: { url: 'http://img/a.png' } } },
          { id: 'page-2', name: 'Page Two', access_token: 'PAGE-TOKEN-2' },
        ],
      })
    }
    if (u.pathname === '/vTest/me') {
      const token = u.searchParams.get('access_token')
      return json(200, { id: token === 'PAGE-TOKEN-2' ? 'me-page-id-2' : PAGE_ID })
    }
    if (u.pathname === `/vTest/${PAGE_ID}/feed`) {
      if (u.searchParams.get('after') === 'cursor-p2') {
        return json(200, { data: [{ id: `${PAGE_ID}_post-3`, message: 'Third', created_time: '2026-10-07T10:00:00+0000' }] })
      }
      return json(200, {
        data: [
          { id: `${PAGE_ID}_post-2`, message: 'Second', link: 'https://fb/post-2', created_time: '2026-10-07T12:00:00+0000' },
          { id: `${PAGE_ID}_post-1`, message: 'First', created_time: '2026-10-07T11:00:00+0000' },
        ],
        paging: { cursors: { after: 'cursor-p2' }, next: 'https://stub/next' },
      })
    }
    if (u.pathname === `/vTest/${POST_ID}/comments`) {
      if (u.searchParams.get('after') === 'cursor-c2') {
        return json(200, {
          data: [
            { id: 'c-old', message: 'Old one', from: { id: VIEWER_ID, name: 'Viewer' }, created_time: '2026-10-07T09:00:00+0000' },
          ],
        })
      }
      return json(200, {
        data: [
          { id: 'c-new', message: 'New question?', from: { id: VIEWER_ID, name: 'Viewer' }, created_time: '2026-10-07T12:00:00+0000' },
          { id: 'c-own', message: 'Our answer', from: { id: PAGE_ID, name: 'Page One' }, created_time: '2026-10-07T11:30:00+0000', parent: { id: 'c-new' } },
        ],
        paging: { cursors: { after: 'cursor-c2' }, next: 'https://stub/next' },
      })
    }
    if (u.pathname === '/vTest/c-new/comments' && req.method === 'POST') {
      const params = new URLSearchParams(body)
      return json(200, { id: params.get('message') ? 'reply-1' : 'reply-empty' })
    }
    json(404, { error: { message: 'stub: no such route', code: 1 } })
  })
})
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()))
const port = (stub.address() as any).port
after(() => stub.close())

const adapter = new FacebookAdapter({ baseUrl: `http://127.0.0.1:${port}`, version: 'vTest' })
const auth = { platformAccountId: PAGE_ID, accessToken: PAGE_TOKEN }

function fail(status: number, payload: unknown): void {
  injected = { prefix: '/vTest', status, payload }
}

async function assertKind(fn: () => Promise<unknown>, kind: string): Promise<SocialPlatformError> {
  try {
    await fn()
  } catch (e) {
    assert.ok(e instanceof SocialPlatformError, `expected SocialPlatformError, got ${e}`)
    assert.equal(e.kind, kind)
    return e
  }
  assert.fail(`expected ${kind} error`)
}

test('listPosts returns one page plus a cursor, and passes the cursor on the next call', async () => {
  const since = new Date('2026-10-01T00:00:00Z')
  const p1 = await adapter.listPosts(auth, since)
  assert.equal(p1.items.length, 2)
  assert.equal(p1.items[0].id, `${PAGE_ID}_post-2`)
  assert.equal(p1.items[0].url, 'https://fb/post-2')
  assert.ok(p1.items[0].createdAt instanceof Date)
  assert.equal(p1.nextCursor, 'cursor-p2')
  const p2 = await adapter.listPosts(auth, since, p1.nextCursor)
  assert.equal(p2.items.length, 1)
  assert.equal(p2.items[0].id, `${PAGE_ID}_post-3`)
  assert.equal(p2.nextCursor, undefined)
  const lastFeedCall = seen.filter(s => s.url.includes('/feed')).pop()!
  assert.ok(lastFeedCall.url.includes('after=cursor-p2'), lastFeedCall.url)
})

test('listComments returns one page plus a cursor, with the parent id of a nested comment', async () => {
  const p1 = await adapter.listComments(auth, POST_ID)
  assert.equal(p1.items.length, 2)
  assert.equal(p1.items[0].postId, POST_ID)
  const nested = p1.items.find(c => c.id === 'c-own')!
  assert.equal(nested.parentId, 'c-new')
  assert.equal(p1.items[0].parentId, undefined)
  assert.equal(p1.nextCursor, 'cursor-c2')
  const p2 = await adapter.listComments(auth, POST_ID, p1.nextCursor)
  assert.equal(p2.items.length, 1)
  assert.equal(p2.nextCursor, undefined)
  const call = seen.find(s => s.url.includes('/comments') && s.method === 'GET' && s.url.includes(POST_ID))!
  assert.ok(call.url.includes('order=reverse_chronological'), call.url)
  assert.ok(call.url.includes('filter=stream'), call.url)
})

test('isOwn is true for a comment written by the Page and false for a viewer', async () => {
  const p1 = await adapter.listComments(auth, POST_ID)
  const own = p1.items.find(c => c.id === 'c-own')!
  const viewer = p1.items.find(c => c.id === 'c-new')!
  assert.equal(own.isOwn, true)
  assert.equal(own.authorId, PAGE_ID)
  assert.equal(viewer.isOwn, false)
  assert.equal(viewer.authorId, VIEWER_ID)
})

test('reply posts the text under the right comment and returns the reply id', async () => {
  const before = seen.length
  const r = await adapter.reply(auth, { id: 'c-new', postId: POST_ID, text: 'Q', createdAt: new Date(), isOwn: false }, 'Thanks kha!')
  assert.equal(r.replyId, 'reply-1')
  const call = seen.slice(before).find(s => s.method === 'POST')!
  assert.ok(call.url.includes('/vTest/c-new/comments'), call.url)
  assert.ok(new URLSearchParams(call.body).get('message')?.includes('Thanks'), call.body)
})

test('error mapping: expired token to auth_expired', async () => {
  fail(400, { error: { message: 'Invalid OAuth access token.', code: 190, error_subcode: 460 } })
  await assertKind(() => adapter.listPosts(auth, new Date()), 'auth_expired')
})

test('error mapping: rate limit to rate_limited with retryAfterSec when given', async () => {
  fail(400, { error: { message: '(#32) Page request limit reached', code: 32 } })
  const e1 = await assertKind(() => adapter.listComments(auth, POST_ID), 'rate_limited')
  assert.equal(e1.retryAfterSec, undefined)
  fail(400, { error: { message: '(#80004) Business use case limit', code: 80004, error_data: { retry_after_sec: 420 } } })
  const e2 = await assertKind(() => adapter.listComments(auth, POST_ID), 'rate_limited')
  assert.equal(e2.retryAfterSec, 420)
})

test('error mapping: deleted comment to not_found, refused text to rejected, other to unknown with raw message', async () => {
  fail(400, { error: { message: '(#100) This comment does not exist or has been deleted', code: 100, error_subcode: 33 } })
  await assertKind(() => adapter.listComments(auth, POST_ID), 'not_found')
  fail(400, { error: { message: '(#368) The action attempted has been deemed abusive', code: 368 } })
  await assertKind(
    () => adapter.reply(auth, { id: 'c-new', postId: POST_ID, text: 'Q', createdAt: new Date(), isOwn: false }, 'spammy'),
    'rejected',
  )
  fail(400, { error: { message: '(#1) An unknown error occurred, please try again', code: 1 } })
  const e = await assertKind(() => adapter.listPosts(auth, new Date()), 'unknown')
  assert.ok(e.rawMessage?.includes('An unknown error occurred'), e.rawMessage)
})

test('getAuthUrl contains the app id, redirect URI, state, and the four permissions', () => {
  const redirectUri = 'https://app.example.com/api/v1/social/oauth/facebook/callback'
  const url = adapter.getAuthUrl(redirectUri, 'state-xyz')
  assert.ok(url.includes('test-app-id-123'), url)
  assert.ok(url.includes(encodeURIComponent(redirectUri)), url)
  assert.ok(url.includes('state-xyz'), url)
  for (const scope of ['pages_show_list', 'pages_read_engagement', 'pages_read_user_content', 'pages_manage_engagement']) {
    assert.ok(url.includes(scope), `missing ${scope}: ${url}`)
  }
})

test('exchangeCode returns one account per Page with its own Page token, without the user token', async () => {
  const accounts = await adapter.exchangeCode('code-123', 'https://app.example.com/cb')
  assert.equal(accounts.length, 2)
  assert.equal(accounts[0].platformAccountId, PAGE_ID) // GET /me id stored at connect time
  assert.equal(accounts[0].name, 'Page One')
  assert.equal(accounts[0].tokens.accessToken, 'PAGE-TOKEN-1')
  assert.equal(accounts[1].platformAccountId, 'me-page-id-2')
  assert.equal(accounts[1].tokens.accessToken, 'PAGE-TOKEN-2')
  assert.ok(!JSON.stringify(accounts).includes(USER_TOKEN), 'user token leaked')
})

test('registry returns the adapter for facebook, also in another letter case', () => {
  assert.equal(getSocialAdapter('facebook').platform, 'facebook')
  assert.equal(getSocialAdapter('FaceBook').platform, 'facebook')
})

test('no request leaves the local stub', () => {
  assert.ok(seen.length > 0)
  for (const s of seen) {
    assert.ok(s.url.startsWith('/vTest/'), s.url)
  }
})
