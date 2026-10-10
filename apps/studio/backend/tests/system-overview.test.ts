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
