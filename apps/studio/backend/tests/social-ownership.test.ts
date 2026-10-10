/**
 * Social Auto Reply per member (core/auth/ownership.ts kinds socialAccount / socialComment).
 * A Social Account belongs to the member who connected it; its Comments follow it. Another member
 * cannot list, open, change or take over that Page, and cannot use that member's login.
 * Members are injected the way requireSession does it (c.set('user')), like tests/ownership.test.ts.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-owner-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')
process.env.PUBLIC_BASE_URL = 'https://app.example.test'

const { Hono } = await import('hono')
const { eq } = await import('drizzle-orm')
const { ownership } = await import('../src/core/auth/ownership.js')
const { db, schema } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const { default: social } = await import('../src/modules/social/routes/social.js')
const { registerSocialAdapter } = await import('../src/modules/social/services/registry.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')

const fake = new FakeSocialAdapter()
registerSocialAdapter(fake)

type Member = { id: string; name: string; email: null; admin: boolean }
const members: Record<string, Member> = {
  a: { id: 'u-a', name: 'A', email: null, admin: false },
  b: { id: 'u-b', name: 'B', email: null, admin: false },
  admin: { id: 'u-admin', name: 'Admin', email: null, admin: true },
}

const app = new Hono()
app.use('/api/v1/*', async (c, next) => {
  c.set('user' as never, members[c.req.header('X-As') || 'a'] as never)
  return next()
})
app.use('/api/v1/*', ownership)
const api = new Hono()
api.route('/social', social)
app.route('/api/v1', api)

const call = async (as: string, method: string, url: string, body?: unknown) => {
  const res = await app.request(`/api/v1/social${url}`, {
    method,
    headers: { 'X-As': as, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, location: res.headers.get('location') ?? '', json: res.status === 302 ? null : await res.json() as any }
}
const ids = (list: any[]) => list.map(r => r.id)

/** Start login and come back from the Platform as `as`; returns the login id. */
async function login(as: string, pageIds: string[], callbackAs = as): Promise<string> {
  fake.connectable = pageIds.map(id => ({ platformAccountId: id, name: `Page ${id}`, tokens: { accessToken: `tok-${id}` } }))
  const started = await call(as, 'POST', '/oauth/fake/start', {})
  assert.equal(started.status, 200, JSON.stringify(started.json))
  const back = await call(callbackAs, 'GET', `/oauth/fake/callback?code=c&state=${started.json.data.state}`)
  if (back.status !== 302) throw new Error(back.json.message)
  return new URL(back.location, 'https://x.test').searchParams.get('login')!
}

async function connect(as: string, pageId: string): Promise<number> {
  const saved = await call(as, 'POST', '/oauth/fake/save', { login: await login(as, [pageId]), ids: [pageId] })
  assert.equal(saved.status, 200, JSON.stringify(saved.json))
  return saved.json.data.items[0].id
}

let accountA = 0
let accountB = 0
let commentA = 0

test('a connected Page belongs to the member who connected it', async () => {
  accountA = await connect('a', 'page-a')
  accountB = await connect('b', 'page-b')
  const [row] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountA))
  assert.equal(row.ownerUserId, 'u-a')

  assert.deepEqual(ids((await call('a', 'GET', '/accounts')).json.data.items), [accountA])
  assert.deepEqual(ids((await call('b', 'GET', '/accounts')).json.data.items), [accountB])
  // an admin lists their own and legacy rows, like every other menu
  assert.deepEqual(ids((await call('admin', 'GET', '/accounts')).json.data.items), [])
})

test('the board lists only comments of the member\'s own Pages', async () => {
  const ts = now()
  const [c] = await db.insert(schema.socialComments).values({
    accountId: accountA, platformCommentId: 'c-a', text: 'How much?', commentedAt: ts,
    status: 'draft', verdict: 'reply', replyText: 'Hi.', createdAt: ts, updatedAt: ts,
  }).returning()
  commentA = c.id

  assert.deepEqual(ids((await call('a', 'GET', '/comments')).json.data.items), [commentA])
  assert.deepEqual(ids((await call('b', 'GET', '/comments')).json.data.items), [])
  // naming the other member's account in the filter gives nothing either
  assert.deepEqual(ids((await call('b', 'GET', `/comments?account_id=${accountA}`)).json.data.items), [])
})

test('another member cannot open, change or act on the Page and its comments', async () => {
  for (const [method, url, body] of [
    ['GET', `/accounts/${accountA}/brand`],
    ['PUT', `/accounts/${accountA}/brand`, { about: 'taken' }],
    ['PUT', `/accounts/${accountA}/settings`, { reply_mode: 'auto' }],
    ['POST', `/accounts/${accountA}/disconnect`],
    ['POST', `/comments/${commentA}/approve`],
    ['POST', `/comments/${commentA}/send`, { text: 'hello from B' }],
    ['POST', `/comments/${commentA}/reject`],
    ['POST', `/comments/${commentA}/close`],
    ['POST', `/comments/${commentA}/help-draft`],
  ] as Array<[string, string, unknown?]>) {
    const res = await call('b', method, url, body)
    assert.equal(res.status, 404, `${method} ${url}`)
    assert.equal(res.json.errorCode, 'E_FORBIDDEN_OWNER', `${method} ${url}`)
  }
  assert.equal(fake.sentReplies.length, 0)
  const [account] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountA))
  assert.equal(account.status, 'connected')
  assert.equal(account.replyMode, 'draft')
  const [comment] = await db.select().from(schema.socialComments).where(eq(schema.socialComments.id, commentA))
  assert.equal(comment.status, 'draft')

  // the owner and an admin can
  assert.equal((await call('a', 'GET', `/accounts/${accountA}/brand`)).status, 200)
  assert.equal((await call('admin', 'GET', `/accounts/${accountA}/brand`)).status, 200)
})

test('a Page already connected by another member cannot be taken over', async () => {
  const loginId = await login('b', ['page-a', 'page-b2'])
  const res = await call('b', 'POST', '/oauth/fake/save', { login: loginId, ids: ['page-a', 'page-b2'] })
  assert.equal(res.status, 400)
  assert.match(res.json.message, /already connected by another member/)
  const [row] = await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, accountA))
  assert.equal(row.ownerUserId, 'u-a')
  assert.equal(row.accessToken, 'tok-page-a') // A's token is untouched
  // nothing of that save was stored, and the login is still usable for B's own Page
  const own = await call('b', 'POST', '/oauth/fake/save', { login: loginId, ids: ['page-b2'] })
  assert.equal(own.status, 200, JSON.stringify(own.json))
  assert.equal((await call('b', 'GET', '/accounts')).json.data.items.length, 2)
})

test('a login cannot be finished or used by another member', async () => {
  await assert.rejects(() => login('a', ['page-a3'], 'b'), /Invalid login state/)

  const loginId = await login('a', ['page-a3'])
  const pending = await call('b', 'GET', `/oauth/fake/pending?login=${loginId}`)
  assert.equal(pending.status, 400)
  const stolen = await call('b', 'POST', '/oauth/fake/save', { login: loginId, ids: ['page-a3'] })
  assert.equal(stolen.status, 400)
  assert.match(stolen.json.message, /Login session not found/)

  const mine = await call('a', 'POST', '/oauth/fake/save', { login: loginId, ids: ['page-a3'] })
  assert.equal(mine.status, 200, JSON.stringify(mine.json))
})
