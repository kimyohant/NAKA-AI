/**
 * GET /api/v1/system/overview (core/routes/system.ts) — what the naka-ai back office shows about this
 * studio: version, disk use (PostgreSQL schema included) and one queue summary per video provider,
 * listing the unknown/queued tasks an admin may cancel.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-system-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.NAKA_DATA_DIR = dir
process.env.NAKA_VERSION = 'v9.8.7'
const { Hono } = await import('hono')
const { db, insertedId, schema } = await import('../src/core/db/index.js')
const { default: system } = await import('../src/core/routes/system.js')

const app = new Hono()
app.route('/api/v1/system', system)

const ts = () => new Date().toISOString()
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

async function videoConfig(name: string, provider: string) {
  return insertedId(await db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video', provider, name, baseUrl: 'http://127.0.0.1:8888', apiKey: 'not-real', model: '[]',
    priority: 0, isActive: true, settings: '{}', createdAt: ts(), updatedAt: ts(),
  }).returning({ id: schema.aiServiceConfigs.id }))
}

async function task(configId: number, status: string, extra: Record<string, unknown> = {}) {
  return insertedId(await db.insert(schema.sysTask).values({
    type: 'video', prompt: 'p', provider: 'unsloth', configId, status, createdAt: ts(), updatedAt: ts(), ...extra,
  }).returning({ id: schema.sysTask.id }))
}

test('overview: version, disk use and one queue summary per video provider', async () => {
  mkdirSync(path.join(dir, 'static', 'videos'), { recursive: true })
  writeFileSync(path.join(dir, 'static', 'videos', 'clip.mp4'), Buffer.alloc(2048))

  const unsloth = await videoConfig('Unsloth MiniMax H3', 'unsloth')
  const other = await videoConfig('Seedance', 'volcengine')
  const lost = await task(unsloth, 'unknown', { errorMsg: 'Polling attempts exhausted; provider task may still be running', storyboardId: 7, dramaId: 1 })
  const waiting = await task(unsloth, 'queued')
  await task(unsloth, 'processing', { taskId: '42' })
  await task(unsloth, 'completed', { completedAt: hoursAgo(1) })
  await task(unsloth, 'completed', { completedAt: hoursAgo(30) }) // older than a day: not counted
  await task(unsloth, 'failed', { updatedAt: hoursAgo(2) })
  await db.insert(schema.sysTask).values({ type: 'image', prompt: 'p', provider: 'unsloth', configId: unsloth, status: 'queued', createdAt: ts(), updatedAt: ts() })

  const res = await app.request('/api/v1/system/overview')
  assert.equal(res.status, 200)
  const { data } = await res.json() as any
  assert.equal(data.version, '9.8.7')
  assert.equal(data.database, 'PostgreSQL (schema studio)')
  assert.ok(data.storage.usage.videos >= 2048, 'the data folder is measured')
  assert.ok(data.storage.usage.db > 0, 'the PostgreSQL schema is counted')

  const byId = new Map(data.videoQueues.map((q: any) => [q.configId, q]))
  const q = byId.get(unsloth) as any
  assert.deepEqual(
    { name: q.name, provider: q.provider, queued: q.queued, running: q.running, unknown: q.unknown, completed24h: q.completed24h, failed24h: q.failed24h },
    { name: 'Unsloth MiniMax H3', provider: 'unsloth', queued: 1, running: 1, unknown: 1, completed24h: 1, failed24h: 1 },
    'image tasks and old completions are left out',
  )
  assert.deepEqual(q.waiting.map((t: any) => [t.id, t.status]), [[lost, 'unknown'], [waiting, 'queued']], 'unknown first: they hold the slot')
  assert.equal(q.waiting[0].storyboardId, 7)
  assert.match(q.waiting[0].error, /Polling attempts exhausted/)
  assert.deepEqual((byId.get(other) as any).waiting, [], 'a provider with nothing waiting is still listed')
})

test('failed tasks: recent failures of every type, newest first, with the owner and drama; no prompt', async () => {
  const config = await videoConfig('Unsloth fail list', 'unsloth')
  const [drama] = await db.insert(schema.dramas).values({ title: 'ละครทดสอบ', createdAt: ts(), updatedAt: ts() } as any)
    .returning({ id: schema.dramas.id })
  const older = await task(config, 'failed', { updatedAt: hoursAgo(5), errorMsg: 'provider said no', ownerUserId: 'u_member', dramaId: drama.id })
  const newer = await task(config, 'failed', { type: 'image', updatedAt: hoursAgo(1), errorMsg: 'x'.repeat(500), errorCode: 'E_TIMEOUT' })
  const old = await task(config, 'failed', { updatedAt: hoursAgo(24 * 9) }) // outside 7 days
  const done = await task(config, 'completed', { updatedAt: hoursAgo(1) })

  const res = await app.request('/api/v1/system/failed-tasks')
  assert.equal(res.status, 200)
  const { data } = await res.json() as any
  assert.equal(data.days, 7)
  const ids = data.tasks.map((t: any) => t.id)
  assert.ok(ids.indexOf(newer) < ids.indexOf(older), 'newest first')
  assert.ok(!ids.includes(old) && !ids.includes(done), 'older than 7 days and not failed are left out')
  const row = data.tasks.find((t: any) => t.id === older)
  assert.deepEqual([row.ownerUserId, row.dramaTitle, row.configName, row.error], ['u_member', 'ละครทดสอบ', 'Unsloth fail list', 'provider said no'])
  const image = data.tasks.find((t: any) => t.id === newer)
  assert.equal(image.type, 'image'); assert.equal(image.errorCode, 'E_TIMEOUT'); assert.equal(image.error.length, 300)
  assert.ok(!JSON.stringify(data).includes('"prompt"'), 'prompts stay in the studio')
  assert.equal(data.total, data.tasks.length)

  const wide = await (await app.request('/api/v1/system/failed-tasks?days=30')).json() as any
  assert.equal(wide.data.days, 30)
  assert.equal(wide.data.total, data.total + 1)
  assert.equal((await (await app.request('/api/v1/system/failed-tasks?days=999')).json() as any).data.days, 30)
})

test('member-works: one member\'s latest works, newest first, each thing once, with the studio page that opens it', async () => {
  const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 10, minutes)).toISOString()
  const add = async (table: any, values: Record<string, unknown>) => insertedId(await db.insert(table).values(values).returning({ id: table.id }))
  const drama = await add(schema.dramas, { title: 'ละครรักในออฟฟิศ', status: 'draft', ownerUserId: 'm1', createdAt: at(1), updatedAt: at(10) })
  // the drama behind a product video is not a work of its own
  const inner = await add(schema.dramas, { title: 'inner', status: 'draft', ownerUserId: 'm1', createdAt: at(1), updatedAt: at(50) })
  const project = await add(schema.studioProjects, { title: 'รีวิวสบู่', templateId: 't', ownerUserId: 'm1', dramaId: inner, status: 'completed', createdAt: at(1), updatedAt: at(20) })
  // the product-video project behind a seller post is not either
  const behindPost = await add(schema.studioProjects, { title: 'behind', templateId: 't', ownerUserId: 'm1', createdAt: at(1), updatedAt: at(55) })
  const post = await add(schema.sellerPosts, { title: '', productName: 'ครีมกันแดด', studioProjectId: behindPost, ownerUserId: 'm1', createdAt: at(1), updatedAt: at(30) })
  const clone = await add(schema.cloneProjects, { name: 'โคลนคลิปไวรัล', ownerUserId: 'm1', createdAt: at(1), updatedAt: at(40) })
  await add(schema.dramas, { title: 'ของคนอื่น', status: 'draft', ownerUserId: 'm2', createdAt: at(1), updatedAt: at(59) })
  await add(schema.dramas, { title: 'ลบแล้ว', status: 'draft', ownerUserId: 'm1', createdAt: at(1), updatedAt: at(58), deletedAt: at(58) })

  const res = await app.request('/api/v1/system/member-works?owner=m1&limit=10')
  assert.equal(res.status, 200)
  const { data } = await res.json() as any
  assert.deepEqual(data.works.map((w: any) => [w.kind, w.title, w.path]), [
    ['viral_clone', 'โคลนคลิปไวรัล', `/viral-clone/${clone}`],
    ['seller', 'ครีมกันแดด', `/seller/${post}`],
    ['product_video', 'รีวิวสบู่', `/studio/${project}`],
    ['drama', 'ละครรักในออฟฟิศ', `/drama/${drama}`],
  ])
  assert.equal(data.works[2].status, 'completed')

  assert.equal((await (await app.request('/api/v1/system/member-works?owner=m1&limit=2')).json() as any).data.works.length, 2)
  for (const bad of ['', 'local', 'a b', "x'y"]) {
    assert.equal((await app.request('/api/v1/system/member-works?owner=' + encodeURIComponent(bad))).status, 400, bad)
  }
})
