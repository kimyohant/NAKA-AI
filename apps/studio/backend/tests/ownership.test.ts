/**
 * Per-member data (unified system, step 2): src/core/auth/ownership.ts + owner-context.ts on the real routes.
 * Members are injected the way requireSession does it (c.set('user')), so no token server is needed.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-owner-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')
const { Hono } = await import('hono')
const { ownership } = await import('../src/core/auth/ownership.js')
const { db, schema } = await import('../src/core/db/index.js')
const { default: dramas } = await import('../src/modules/drama/routes/dramas.js')
const { default: episodes } = await import('../src/modules/drama/routes/episodes.js')
const { default: campaigns } = await import('../src/modules/marketer/routes/campaigns.js')
const { default: seller } = await import('../src/modules/seller/routes/seller.js')
const { default: tasks } = await import('../src/core/routes/tasks.js')

type Member = { id: string; name: string; email: null; admin: boolean }
const A: Member = { id: 'u-a', name: 'A', email: null, admin: false }
const B: Member = { id: 'u-b', name: 'B', email: null, admin: false }
const ADMIN: Member = { id: 'u-admin', name: 'Admin', email: null, admin: true }
const LOCAL: Member = { id: 'local', name: 'Local', email: null, admin: true }

const app = new Hono()
const members: Record<string, Member> = { a: A, b: B, admin: ADMIN, local: LOCAL }
app.use('/api/v1/*', async (c, next) => {
  c.set('user' as never, members[c.req.header('X-As') || 'local'] as never)
  return next()
})
app.use('/api/v1/*', ownership)
const api = new Hono()
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/campaigns', campaigns)
api.route('/seller', seller)
api.route('/tasks', tasks)
app.route('/api/v1', api)

const call = async (as: string, method: string, url: string, body?: unknown) => {
  const res = await app.request(`/api/v1${url}`, {
    method,
    headers: { 'X-As': as, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: res.status, json: await res.json() as any }
}
const ids = (list: any[]) => list.map(r => r.id)

// a legacy row from before v21 / single-user mode (created outside any request)
const ts = new Date().toISOString()
const [legacy] = await db.insert(schema.dramas).values({ title: 'legacy', createdAt: ts, updatedAt: ts }).returning()

test('rows created outside a request belong to local', () => {
  assert.equal(legacy.ownerUserId, 'local')
})

test('dramas: members only see and open their own', async () => {
  const mine = await call('a', 'POST', '/dramas', { title: 'A drama' })
  assert.equal(mine.status, 201, JSON.stringify(mine.json))
  const id = mine.json.data.id
  const [row] = await db.select().from(schema.dramas).where((await import('drizzle-orm')).eq(schema.dramas.id, id))
  assert.equal(row.ownerUserId, 'u-a')

  assert.deepEqual(ids((await call('a', 'GET', '/dramas')).json.data.items), [id])
  assert.deepEqual(ids((await call('b', 'GET', '/dramas')).json.data.items), [])
  assert.equal((await call('b', 'GET', '/dramas/stats')).json.data.total, 0)

  for (const [method, url, body] of [
    ['GET', `/dramas/${id}`],
    ['PUT', `/dramas/${id}`, { title: 'taken' }],
    ['DELETE', `/dramas/${id}`],
    ['POST', '/episodes', { drama_id: id, title: 'sneaky' }], // parent id in the body
    ['GET', `/campaigns?drama_id=${id}`], // parent id in the query
    ['GET', `/dramas/${legacy.id}`], // legacy rows are the admin's
  ] as const) {
    const res = await call('b', method, url, body)
    assert.equal(res.status, 404, `${method} ${url}`)
    assert.equal(res.json.errorCode, 'E_FORBIDDEN_OWNER')
  }
  assert.equal((await call('a', 'GET', `/dramas/${id}`)).status, 200)
})

test('admins open anything and list their own plus legacy rows', async () => {
  const a = await call('a', 'POST', '/dramas', { title: 'A again' })
  const mine = await call('admin', 'POST', '/dramas', { title: 'admin drama' })
  const list = ids((await call('admin', 'GET', '/dramas')).json.data.items)
  assert.ok(list.includes(mine.json.data.id) && list.includes(legacy.id))
  assert.ok(!list.includes(a.json.data.id))
  assert.equal((await call('admin', 'GET', `/dramas/${a.json.data.id}`)).status, 200)
})

test('single-user mode (SSO off) sees every row', async () => {
  const all = await db.select().from(schema.dramas)
  const list = ids((await call('local', 'GET', '/dramas?page_size=100')).json.data.items)
  assert.equal(list.length, all.filter(d => !d.deletedAt).length)
})

test('campaigns, seller posts and tasks are per member', async () => {
  const campaign = await call('a', 'POST', '/campaigns', { productName: 'Serum' })
  assert.equal(campaign.status, 201, JSON.stringify(campaign.json))
  assert.ok(ids((await call('a', 'GET', '/campaigns')).json.data).includes(campaign.json.data.id))
  assert.deepEqual(ids((await call('b', 'GET', '/campaigns')).json.data), [])
  assert.equal((await call('b', 'GET', `/campaigns/${campaign.json.data.id}`)).status, 404)

  const post = await call('a', 'POST', '/seller/posts', { productName: 'Serum' })
  assert.equal(post.status, 201, JSON.stringify(post.json))
  assert.deepEqual(ids((await call('b', 'GET', '/seller/posts')).json.data), [])
  assert.equal((await call('b', 'PUT', `/seller/posts/${post.json.data.id}`, { productName: 'mine now' })).status, 404)
  assert.equal((await call('a', 'GET', `/seller/posts/${post.json.data.id}`)).status, 200)

  const [task] = await db.insert(schema.sysTask)
    .values({ type: 'image', ownerUserId: 'u-a', createdAt: ts, updatedAt: ts }).returning()
  assert.deepEqual(ids((await call('a', 'GET', '/tasks')).json.data), [task.id])
  assert.deepEqual(ids((await call('b', 'GET', '/tasks')).json.data), [])
  assert.equal((await call('b', 'GET', `/tasks/${task.id}`)).status, 404)
})

test('children follow their parent: episodes of a drama', async () => {
  const { json } = await call('a', 'POST', '/dramas', { title: 'with episode' })
  const [ep] = await db.insert(schema.episodes)
    .values({ dramaId: json.data.id, episodeNumber: 1, title: 'ep1', createdAt: ts, updatedAt: ts }).returning()
  assert.equal((await call('b', 'GET', `/episodes/${ep.id}/characters`)).status, 404)
  assert.equal((await call('a', 'GET', `/episodes/${ep.id}/characters`)).status, 200)
})
