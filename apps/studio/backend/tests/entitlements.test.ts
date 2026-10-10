/**
 * Studio side of member features (docs/entitlements.md): menus outside the plan answer 403, admins and
 * single-user mode are never checked, and AI videos count against the owner's monthly quota.
 * The account schema is the real one: apps/landing/migrations/pg/*.sql applied to schema "account" of the same
 * in-process database, so these tests call the same SQL functions production does.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { mock, test } from 'node:test'
import { Hono } from 'hono'

process.env.DATABASE_URL = 'pglite://memory'
process.env.NAKA_SSO_URL = 'http://localhost:8788'
process.env.NAKA_SSO_SECRET = 'x'.repeat(40)

const { db, schema, rawExec, rawQuery } = await import('../src/core/db/index.js')
const ent = await import('../src/core/auth/entitlements.js')
const { generateVideo } = await import('../src/core/generation/generation.js')
const { runAsOwner } = await import('../src/core/auth/owner-context.js')
const { now } = await import('../src/core/http/response.js')

// provider calls never leave the process: a video submit just hangs
mock.method(globalThis, 'fetch', () => new Promise<Response>(() => {}))

// the account schema (landing migrations) beside the studio schema; one connection, so restore the search path after
const migrations = path.resolve(import.meta.dirname, '../../../landing/migrations/pg')
await rawExec('CREATE SCHEMA account; SET search_path TO account;')
for (const file of readdirSync(migrations).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort()) {
  await rawExec(readFileSync(path.join(migrations, file), 'utf8'))
}
await rawExec(`SET search_path TO studio;
  INSERT INTO account.users (id, display_name, created_at) VALUES ('free1', 'ฟรี', 1), ('starter1', 'เริ่มต้น', 1), ('pro1', 'โปร', 1), ('boss', 'แอดมิน', 1);
  INSERT INTO account.subscriptions (user_id, plan_id, status, expires_at) VALUES
    ('starter1', 'starter', 'active', 4102444800), ('pro1', 'pro', 'active', 4102444800);`)

const used = async (user: string) => Number((await rawQuery(
  "SELECT coalesce(sum(used), 0) AS n FROM account.feature_usage WHERE user_id = $1 AND feature_key = 'studio.video'", [user]))[0].n)

function guarded(user: { id: string; admin: boolean }) {
  const app = new Hono()
  app.use('*', async (c, next) => { c.set('user' as never, { ...user, name: user.id, email: null } as never); return next() })
  app.use('/api/v1/*', ent.entitlementGuard)
  app.all('*', c => c.json({ ok: true }))
  return (p: string, method = 'GET') => app.request(p, { method })
}

test('routes map to the menus that use them; settings and auth are not menus', () => {
  assert.deepEqual(ent.featuresForPath('/api/v1/seller/posts/3'), ['studio.seller'])
  assert.deepEqual(ent.featuresForPath('/api/v1/clone'), ['studio.viral_clone'])
  assert.deepEqual(ent.featuresForPath('/api/v1/studio/avatars'), ['studio.product_studio', 'studio.seller', 'studio.viral_clone'])
  assert.equal(ent.featuresForPath('/api/v1/episodes/1/storyboards')!.length, 7, 'shared timeline: any menu')
  for (const p of ['/api/v1/settings/x', '/api/v1/ai-configs', '/api/v1/auth/naka/me', '/api/v1/studios', '/api/v1/livestream']) {
    assert.equal(ent.featuresForPath(p), null, p)
  }
})

test('the guard follows the plan: free has no studio menu, starter has seller but not live, pro has viral clone; admins pass', async () => {
  const free = guarded({ id: 'free1', admin: false })
  const denied = await free('/api/v1/seller')
  assert.equal(denied.status, 403)
  assert.equal((await denied.json() as any).errorCode, 'E_FEATURE_DISABLED')
  assert.equal((await free('/api/v1/episodes/1')).status, 403, 'no menu at all: the shared routes close too')
  assert.equal((await free('/api/v1/settings')).status, 200)

  const starter = guarded({ id: 'starter1', admin: false })
  assert.equal((await starter('/api/v1/seller', 'POST')).status, 200)
  assert.equal((await starter('/api/v1/studio/templates')).status, 200, 'seller uses Product Studio templates')
  assert.equal((await starter('/api/v1/live')).status, 403)
  assert.equal((await starter('/api/v1/clone')).status, 403)
  assert.equal((await guarded({ id: 'pro1', admin: false })('/api/v1/clone')).status, 200)
  assert.equal((await guarded({ id: 'boss', admin: true })('/api/v1/live')).status, 200, 'admins are not checked')

  // an admin override on naka-ai.com applies on the next request (after the 10 s cache)
  await rawExec("INSERT INTO account.user_features (user_id, feature_key, enabled, note, updated_at) VALUES ('starter1', 'studio.live', true, 'ทดลอง', 1)")
  ent.clearEntitlementCache()
  assert.equal((await starter('/api/v1/live')).status, 200)
})

test('Social Auto Reply follows the plan: the menu routes and the background poller (paid plans, not free)', async () => {
  assert.deepEqual(ent.featuresForPath('/api/v1/social/accounts'), ['studio.social'])
  ent.clearEntitlementCache()
  assert.equal((await guarded({ id: 'free1', admin: false })('/api/v1/social/accounts')).status, 403)
  assert.equal((await guarded({ id: 'starter1', admin: false })('/api/v1/social/accounts')).status, 200)
  assert.equal(await ent.ownerHasFeature('free1', 'studio.social'), false, 'the poller leaves a free member alone')
  assert.equal(await ent.ownerHasFeature('starter1', 'studio.social'), true)
  assert.equal(await ent.ownerHasFeature('local', 'studio.social'), true, 'single-user rows are never checked')
})

test('single-user mode and NAKA_ENTITLEMENTS=off check nothing', async () => {
  process.env.NAKA_ENTITLEMENTS = 'off'
  try {
    assert.equal((await guarded({ id: 'free1', admin: false })('/api/v1/live')).status, 200)
  } finally { delete process.env.NAKA_ENTITLEMENTS }
  const sso = process.env.NAKA_SSO_URL
  delete process.env.NAKA_SSO_URL; delete process.env.NAKA_SSO_SECRET
  try {
    assert.equal(ent.entitlementsOn(), false)
    assert.equal(await ent.useVideoQuota('free1'), null)
  } finally { process.env.NAKA_SSO_URL = sso; process.env.NAKA_SSO_SECRET = 'x'.repeat(40) }
})

test('AI video counts against the project owner\'s monthly quota; refused before any task exists; admins are not counted', async () => {
  const ts = now()
  await db.insert(schema.aiServiceConfigs).values({ serviceType: 'video', provider: 'volcengine', name: 'v', baseUrl: 'http://127.0.0.1:9',
    apiKey: 'k', model: JSON.stringify(['m']), isActive: true, isDefault: true, priority: 1, createdAt: ts, updatedAt: ts })
  const [drama] = await db.insert(schema.dramas).values({ title: 'งานของ starter', status: 'draft', ownerUserId: 'starter1', createdAt: ts, updatedAt: ts })
    .returning({ id: schema.dramas.id })
  await rawExec("INSERT INTO account.user_features (user_id, feature_key, enabled, monthly_limit, note, updated_at) VALUES ('starter1', 'studio.video', true, 2, 'ทดสอบ', 1)")

  const make = () => generateVideo({ dramaId: drama.id, prompt: 'shot', duration: 5 })
  // the owner is the drama's member even when no request scope is set (a startup resume)
  await make()
  await runAsOwner({ ownerId: 'starter1', admin: false }, make)
  assert.equal(await used('starter1'), 2)
  const tasksBefore = (await db.select().from(schema.sysTask)).length
  await assert.rejects(make(), (e: any) => e.errorCode === 'E_FEATURE_QUOTA')
  assert.equal((await db.select().from(schema.sysTask)).length, tasksBefore, 'refused before a task was created')
  assert.equal(await used('starter1'), 2, 'a refusal is not counted')

  // an admin working in the project is not counted; nor is an owner who is a studio admin
  await runAsOwner({ ownerId: 'boss', admin: true }, make)
  await db.insert(schema.users).values({ id: 'boss', displayName: 'แอดมิน', isAdmin: true, createdAt: ts, updatedAt: ts })
  assert.equal(await ent.useVideoQuota('boss'), null)

  // a free member has no studio video at all
  await assert.rejects(runAsOwner({ ownerId: 'free1', admin: false }, () => generateVideo({ prompt: 'x', duration: 5 })),
    (e: any) => e.errorCode === 'E_FEATURE_DISABLED')
})

test('a use whose task could not be created is given back', async () => {
  const use = await ent.useVideoQuota('pro1')
  assert.ok(use)
  assert.equal(await used('pro1'), 1)
  await ent.releaseFeatureUse(use)
  assert.equal(await used('pro1'), 0)
})
