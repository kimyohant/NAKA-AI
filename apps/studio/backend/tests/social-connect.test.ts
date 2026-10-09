/**
 * Social Auto Reply ticket 10 — Connect, Reconnect, Disconnect.
 * Temp SQLite, node:test, fake `fake` adapter only (no Facebook calls).
 * Covers: can-connect reasons, state single-use + 10-min expiry, wrong-state
 * callback saves nothing, full flow (start/callback/tick/save), no token in
 * any response, pending 10-min expiry, reconnect-keeps-data (same row),
 * disconnect-keeps-comments + reconnect-same-row, disconnected-skipped poll.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-10-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')
process.env.PUBLIC_BASE_URL = 'https://app.example.test'

const { db, schema } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const { default: social } = await import('../src/modules/social/routes/social.js')
const { registerSocialAdapter } = await import('../src/modules/social/services/registry.js')
const oauth = await import('../src/modules/social/services/oauth.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')
const poller = await import('../src/modules/social/services/poller.js')

const fake = new FakeSocialAdapter()
registerSocialAdapter(fake)

const TOKEN_SECRETS: string[] = []

function pageToken(id: string): string {
  const tok = `tok-secret-${id}-${Math.random().toString(36).slice(2)}`
  TOKEN_SECRETS.push(tok)
  return tok
}

async function get(route: string) {
  const res = await social.request(route)
  return { status: res.status, headers: res.headers, json: (await res.json()) as any }
}

async function post(route: string, body?: unknown) {
  const res = await social.request(route, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, headers: res.headers, json: (await res.json()) as any }
}

function assertNoTokens(value: unknown, where: string): void {
  const raw = JSON.stringify(value)
  for (const key of ['accessToken', 'refreshToken', 'access_token', 'refresh_token']) {
    assert.ok(!raw.includes(`"${key}"`), `${where} contains key ${key}`)
  }
  for (const secret of TOKEN_SECRETS) {
    assert.ok(!raw.includes(secret), `${where} leaks a token`)
  }
}

async function accountCount(): Promise<number> {
  return (await db.select().from(schema.socialAccounts)).length
}

/** Full login flow through the HTTP routes; returns the login id. */
async function loginAs(pages: Array<{ id: string; name: string }>): Promise<string> {
  fake.connectable = pages.map(p => ({
    platformAccountId: p.id,
    name: p.name,
    avatarUrl: `https://img.example/${p.id}.png`,
    tokens: { accessToken: pageToken(p.id) },
  }))
  fake.exchangeCalls = []
  const started = await post('/oauth/fake/start', {})
  assert.equal(started.status, 200, JSON.stringify(started.json))
  const { url, state } = started.json.data
  assert.ok(typeof url === 'string' && url.includes(encodeURIComponent(state)))
  const cbRes = await social.request(`/oauth/fake/callback?code=code-${Date.now()}&state=${encodeURIComponent(state)}`)
  assert.equal(cbRes.status, 302, await cbRes.text())
  const location = cbRes.headers.get('location') ?? ''
  assert.match(location, /^\/social\/accounts\?login=[0-9a-f]+&platform=fake$/)
  return new URL(location, 'https://x.test').searchParams.get('login')!
}

test('can-connect is false with a reason when PUBLIC_BASE_URL or app credentials are missing', async () => {
  const savedBase = process.env.PUBLIC_BASE_URL
  const savedId = process.env.FACEBOOK_APP_ID
  const savedSecret = process.env.FACEBOOK_APP_SECRET
  try {
    delete process.env.PUBLIC_BASE_URL
    const noBase = await get('/oauth/fake/can-connect')
    assert.equal(noBase.json.data.can, false)
    assert.ok(noBase.json.data.reason, 'missing reason')
    const startBlocked = await post('/oauth/fake/start', {})
    assert.equal(startBlocked.status, 400)

    process.env.PUBLIC_BASE_URL = 'https://app.example.test'
    delete process.env.FACEBOOK_APP_ID
    delete process.env.FACEBOOK_APP_SECRET
    const noId = await get('/oauth/facebook/can-connect')
    assert.equal(noId.json.data.can, false)
    assert.match(noId.json.data.reason, /FACEBOOK_APP_ID/)

    process.env.FACEBOOK_APP_ID = 'test-app-id'
    const noSecret = await get('/oauth/facebook/can-connect')
    assert.equal(noSecret.json.data.can, false)
    assert.match(noSecret.json.data.reason, /FACEBOOK_APP_SECRET/)

    process.env.FACEBOOK_APP_SECRET = 'test-app-secret'
    const okFb = await get('/oauth/facebook/can-connect')
    assert.equal(okFb.json.data.can, true)
    const okFake = await get('/oauth/fake/can-connect')
    assert.equal(okFake.json.data.can, true)
    assertNoTokens(okFake.json, 'can-connect')
  } finally {
    if (savedBase === undefined) delete process.env.PUBLIC_BASE_URL
    else process.env.PUBLIC_BASE_URL = savedBase
    if (savedId === undefined) delete process.env.FACEBOOK_APP_ID
    else process.env.FACEBOOK_APP_ID = savedId
    if (savedSecret === undefined) delete process.env.FACEBOOK_APP_SECRET
    else process.env.FACEBOOK_APP_SECRET = savedSecret
  }
})

test('oauth state is single use and expires after 10 minutes', async () => {
  assert.equal(oauth.OAUTH_STATE_TTL_MS, 10 * 60 * 1000)
  assert.equal(oauth.OAUTH_PENDING_TTL_MS, 10 * 60 * 1000)
  oauth.__clearOAuthStores()

  const before = await accountCount()
  const { url, state } = oauth.startLogin('fake')
  assert.ok(url.includes(encodeURIComponent(oauth.callbackUrl('fake'))), url)
  assert.ok(url.includes(encodeURIComponent(state)))

  const first = await oauth.finishLogin('fake', 'code-1', state)
  assert.ok(first.loginId)
  await assert.rejects(oauth.finishLogin('fake', 'code-1', state), /Invalid login state/)
  await assert.rejects(oauth.finishLogin('fake', 'code-1', 'no-such-state'), /Invalid login state/)

  const retry = oauth.startLogin('fake')
  oauth.__expireOAuthState(retry.state)
  await assert.rejects(oauth.finishLogin('fake', 'code-2', retry.state), /expired/)
  assert.equal(await accountCount(), before, 'state checks must save nothing')
  oauth.__clearOAuthStores()
})

test('callback with a wrong state saves nothing and shows a clear error', async () => {
  oauth.__clearOAuthStores()
  const before = await accountCount()
  const res = await get('/oauth/fake/callback?code=code-x&state=wrong-state')
  assert.equal(res.status, 400)
  assert.ok(typeof res.json.message === 'string' && res.json.message.length > 0)
  assert.equal(await accountCount(), before)
  const pending = await get('/oauth/fake/pending?login=wrong-state')
  assert.equal(pending.status, 400)
})

test('full flow: start, callback, two pages, tick one, one connected account', async () => {
  oauth.__clearOAuthStores()
  const loginId = await loginAs([
    { id: 'page-A', name: 'Page A' },
    { id: 'page-B', name: 'Page B' },
  ])
  // exchangeCode got the hosted callback URI, not the frontend page
  assert.equal(fake.exchangeCalls.length, 1)
  assert.equal(fake.exchangeCalls[0]!.redirectUri, 'https://app.example.test/api/v1/social/oauth/fake/callback')

  const pending = await get(`/oauth/fake/pending?login=${loginId}`)
  assert.equal(pending.status, 200, JSON.stringify(pending.json))
  assert.equal(pending.json.data.items.length, 2)
  assert.deepEqual(
    pending.json.data.items.map((p: any) => p.name).sort(),
    ['Page A', 'Page B'],
  )
  assert.ok(pending.json.data.items.every((p: any) => p.avatarUrl), 'avatars listed')
  assertNoTokens(pending.json, 'pending list')

  const saved = await post('/oauth/fake/save', { login: loginId, platform_account_ids: ['page-A'] })
  assert.equal(saved.status, 200, JSON.stringify(saved.json))
  assert.equal(saved.json.data.items.length, 1)
  assert.equal(saved.json.data.items[0].platform, 'fake')
  assert.equal(saved.json.data.items[0].status, 'connected')
  assert.equal(saved.json.data.items[0].replyMode, 'draft')
  assert.equal(saved.json.data.items[0].watching, true)
  assertNoTokens(saved.json, 'save response')

  const [row] = await db.select().from(schema.socialAccounts)
    .where(eq(schema.socialAccounts.platformAccountId, 'page-A'))
  assert.ok(row, 'account stored')
  assert.equal(row!.status, 'connected')
  assert.ok(TOKEN_SECRETS.some(s => s.includes('page-A') && row!.accessToken === s), 'page token stored server-side')

  // the login is consumed: saving again with it fails
  const reuse = await post('/oauth/fake/save', { login: loginId, platform_account_ids: ['page-B'] })
  assert.equal(reuse.status, 400)
})

test('pending list is gone after 10 minutes', async () => {
  oauth.__clearOAuthStores()
  const loginId = await loginAs([{ id: 'page-C', name: 'Page C' }])
  oauth.__expireOAuthPending(loginId)
  const pending = await get(`/oauth/fake/pending?login=${loginId}`)
  assert.equal(pending.status, 400)
  assert.match(pending.json.message, /expired/)
  const saved = await post('/oauth/fake/save', { login: loginId, platform_account_ids: ['page-C'] })
  assert.equal(saved.status, 400)
  assert.equal(
    (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.platformAccountId, 'page-C'))).length,
    0,
    'expired login saves nothing',
  )
})

async function addAccountWithData(platformAccountId: string, values: Record<string, unknown> = {}): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId,
    name: 'Old Page',
    status: 'reconnect_needed',
    accessToken: pageToken(`old-${platformAccountId}`),
    replyMode: 'auto',
    watching: true,
    watchDays: 14,
    replyToPraise: false,
    brandAbout: 'We sell rice.',
    brandTone: 'Kind.',
    brandFaq: 'Price 100.',
    brandForbidden: 'Politics.',
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).returning()
  const id = Number(res[0].id)
  for (const status of ['draft', 'needs_human']) {
    await db.insert(schema.socialComments).values({
      accountId: id,
      platformCommentId: `c-${platformAccountId}-${status}`,
      text: 'How much?',
      commentedAt: ts,
      status,
      createdAt: ts,
      updatedAt: ts,
    } as any)
  }
  return id
}

test('reconnect updates the same row and keeps brand, settings, and drafts', async () => {
  oauth.__clearOAuthStores()
  const id = await addAccountWithData('page-R')
  const before = (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)))[0]!

  const loginId = await loginAs([{ id: 'page-R', name: 'Page R Renamed' }])
  const saved = await post('/oauth/fake/save', { login: loginId, platform_account_ids: ['page-R'] })
  assert.equal(saved.status, 200, JSON.stringify(saved.json))
  assert.equal(saved.json.data.items[0].id, id, 'same row')
  assertNoTokens(saved.json, 'reconnect save')

  const after = (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)))[0]!
  assert.equal(after!.status, 'connected')
  assert.notEqual(after!.accessToken, before!.accessToken, 'new tokens stored')
  assert.equal(after!.name, 'Page R Renamed')
  assert.equal(after!.brandAbout, 'We sell rice.')
  assert.equal(after!.brandTone, 'Kind.')
  assert.equal(after!.brandFaq, 'Price 100.')
  assert.equal(after!.brandForbidden, 'Politics.')
  assert.equal(after!.replyMode, 'auto')
  assert.equal(after!.watchDays, 14)
  const comments = (await db.select().from(schema.socialComments)
    .where(eq(schema.socialComments.accountId, id)))
    .sort((a, b) => a.platformCommentId.localeCompare(b.platformCommentId))
  assert.deepEqual(comments.map(c => c.status), ['draft', 'needs_human'], 'drafts kept')
})

test('disconnect deletes tokens, keeps comments; reconnect brings the same row back', async () => {
  oauth.__clearOAuthStores()
  const id = await addAccountWithData('page-D', { status: 'connected' })

  const gone = await post(`/accounts/${id}/disconnect`, {})
  assert.equal(gone.status, 200, JSON.stringify(gone.json))
  assert.equal(gone.json.data.status, 'disconnected')
  assertNoTokens(gone.json, 'disconnect response')

  const row = (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)))[0]!
  assert.equal(row!.status, 'disconnected')
  assert.equal(row!.accessToken, null)
  assert.equal(row!.refreshToken, null)
  const kept = await db.select().from(schema.socialComments).where(eq(schema.socialComments.accountId, id))
  assert.equal(kept.length, 2, 'comments stay as history')

  const listed = await get('/accounts')
  assert.ok(!listed.json.data.items.some((a: any) => a.id === id), 'disconnected hidden')

  const loginId = await loginAs([{ id: 'page-D', name: 'Page D Again' }])
  const back = await post('/oauth/fake/save', { login: loginId, platform_account_ids: ['page-D'] })
  assert.equal(back.status, 200, JSON.stringify(back.json))
  assert.equal(back.json.data.items[0].id, id, 'same row back')
  const revived = (await db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)))[0]!
  assert.equal(revived!.status, 'connected')
  assert.ok(revived!.accessToken, 'tokens stored again')
  assert.equal(revived!.brandAbout, 'We sell rice.', 'brand kept across disconnect')
})

test('a disconnected account is skipped by the polling round', async () => {
  oauth.__clearOAuthStores()
  await db.delete(schema.socialComments)
  await db.delete(schema.socialPosts)
  await db.delete(schema.socialAccounts)
  fake.posts = []
  fake.commentsByPost.clear()
  fake.listPostsCalls = 0
  fake.listCommentsCalls = 0
  poller.__resetSocialPollerState()

  const ts = now()
  await db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId: 'page-off',
    name: 'Off Page',
    status: 'disconnected',
    watching: true,
    createdAt: ts,
    updatedAt: ts,
  } as any)
  fake.seedPosts([{ id: 'p1', text: 'hello', createdAt: new Date() }])
  fake.seedComments('p1', [{
    id: 'c1', postId: 'p1', text: 'How much?', authorName: 'Ann',
    createdAt: new Date(), isOwn: false,
  }])

  const r = await poller.runSocialPollRound({ waitBetweenSends: async () => {} })
  assert.deepEqual(r, { skipped: false, accounts: 0, newComments: 0 })
  assert.equal(fake.listPostsCalls, 0, 'adapter never called')
  assert.equal(fake.listCommentsCalls, 0, 'adapter never called')
  assert.equal((await db.select().from(schema.socialComments)).length, 0, 'nothing stored')
  const listed = await get('/accounts')
  assertNoTokens(listed.json, 'accounts list')
})
