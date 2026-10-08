/**
 * Social Auto Reply ticket 07 — Accounts + Brand Profile routes.
 * Temp SQLite, node:test. Covers: no token leak on any social route,
 * settings save + validation, brand save/read + limits, new-account defaults.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-07-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const { default: social, BRAND_LIMITS } = await import('../src/routes/social.js')

{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const ACCESS = 'tok-access-abc123'
const REFRESH = 'tok-refresh-def456'

function addAccount(values: Record<string, unknown> = {}): number {
  const ts = now()
  const res = db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId: `t07-${Math.random().toString(36).slice(2)}`,
    name: 'Page T07',
    status: 'connected',
    accessToken: ACCESS,
    refreshToken: REFRESH,
    tokenExpiresAt: ts,
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

function addComment(accountId: number): void {
  const ts = now()
  db.insert(schema.socialComments).values({
    accountId,
    platformCommentId: `t07-c-${Math.random().toString(36).slice(2)}`,
    text: 'How much?',
    commentedAt: ts,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  } as any).run()
}

async function get(route: string) {
  const res = await social.request(route)
  assert.equal(res.status, 200, `${route} -> ${res.status}`)
  return (await res.json() as any).data
}

async function send(method: string, route: string, body?: unknown) {
  const res = await social.request(route, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json() as any
  return { status: res.status, json }
}

const accId = addAccount()
addComment(accId)

test('no social route response contains tokens', async () => {
  const routes = ['/accounts', `/accounts/${accId}/brand`, '/comments']
  for (const r of routes) {
    const data = await get(r)
    const raw = JSON.stringify(data)
    assert.ok(!raw.includes(ACCESS), `${r} leaks access token`)
    assert.ok(!raw.includes(REFRESH), `${r} leaks refresh token`)
    for (const key of ['access_token', 'refresh_token', 'accessToken', 'refreshToken']) {
      assert.ok(!raw.includes(`"${key}"`), `${r} contains key ${key}`)
    }
  }
})

test('settings update saves reply mode, watching, watch days, reply to praise', async () => {
  const { status, json } = await send('PATCH', `/accounts/${accId}/settings`, {
    reply_mode: 'auto', watching: false, watch_days: 14, reply_to_praise: false,
  })
  assert.equal(status, 200, JSON.stringify(json))
  assert.equal(json.data.replyMode, 'auto')
  assert.equal(json.data.watching, false)
  assert.equal(json.data.watchDays, 14)
  assert.equal(json.data.replyToPraise, false)
  const listed = await get('/accounts')
  const row = listed.items.find((a: any) => a.id === accId)!
  assert.equal(row.replyMode, 'auto')
  assert.equal(row.watchDays, 14)
})

test('settings update refuses invalid values', async () => {
  for (const body of [
    { reply_mode: 'turbo' },
    { watch_days: 0 },
    { watch_days: 31 },
    { watch_days: 7.5 },
    { watching: 'yes' },
    { reply_to_praise: 'sometimes' },
    {},
  ]) {
    const { status } = await send('PATCH', `/accounts/${accId}/settings`, body)
    assert.equal(status, 400, `accepted ${JSON.stringify(body)}`)
  }
})

test('brand profile saves and reads back the five fields', async () => {
  const brand = {
    about: 'We sell jasmine rice.',
    tone: 'Friendly, ends with na ka.',
    faq: 'Price 200 THB. Open 9-18.',
    forbidden: 'Politics.',
    default_language: 'en',
  }
  const put = await send('PUT', `/accounts/${accId}/brand`, brand)
  assert.equal(put.status, 200, JSON.stringify(put.json))
  const read = await get(`/accounts/${accId}/brand`)
  assert.equal(read.about, brand.about)
  assert.equal(read.tone, brand.tone)
  assert.equal(read.faq, brand.faq)
  assert.equal(read.forbidden, brand.forbidden)
  assert.equal(read.defaultLanguage, 'en')
})

test('brand profile limits are enforced by the backend', async () => {
  assert.deepEqual({ ...BRAND_LIMITS }, { about: 500, tone: 200, faq: 3000, forbidden: 500 })
  const cases: Array<[string, number]> = [
    ['about', 500], ['tone', 200], ['faq', 3000], ['forbidden', 500],
  ]
  for (const [field, limit] of cases) {
    const over = await send('PUT', `/accounts/${accId}/brand`, { [field]: 'x'.repeat(limit + 1) })
    assert.equal(over.status, 400, `${field} over limit accepted`)
    const at = await send('PUT', `/accounts/${accId}/brand`, { [field]: 'x'.repeat(limit) })
    assert.equal(at.status, 200, `${field} at limit rejected`)
  }
  const badLang = await send('PUT', `/accounts/${accId}/brand`, { default_language: 'xx-unknown' })
  assert.equal(badLang.status, 400)
})

test('new social account defaults: draft, watch days 7, praise on, Thai', async () => {
  const ts = now()
  const res = db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId: `t07-defaults-${Date.now()}`,
    name: 'Fresh Page',
    status: 'connected',
    createdAt: ts,
    updatedAt: ts,
  } as any).run()
  const id = Number((res as any).lastInsertRowid)
  const listed = await get('/accounts')
  const row = listed.items.find((a: any) => a.id === id)!
  assert.equal(row.replyMode, 'draft')
  assert.equal(row.watchDays, 7)
  assert.equal(row.replyToPraise, true)
  assert.equal(row.watching, true)
  const brand = await get(`/accounts/${id}/brand`)
  assert.equal(brand.defaultLanguage, 'th')
})

test('disconnected accounts are not listed', async () => {
  const gone = addAccount({ status: 'disconnected' })
  const listed = await get('/accounts')
  assert.ok(!listed.items.some((a: any) => a.id === gone))
})
