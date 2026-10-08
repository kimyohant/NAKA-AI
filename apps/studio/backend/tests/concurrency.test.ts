/**
 * Check-then-write paths that SQLite made atomic (one writer, no real I/O between the read and the write)
 * and that must stay atomic on PostgreSQL, where every await is a round trip another request can slip into.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

process.env.DATABASE_URL = 'pglite://memory'

const { db, schema, insertedId } = await import('../src/core/db/index.js')
const { startTask, updateTask } = await import('../src/core/tasks/pipeline-tasks.js')
const gallery = await import('../src/modules/marketer/services/gallery.js')
const { now } = await import('../src/core/http/response.js')

test('startTask: of concurrent starts on a new key exactly one wins', async () => {
  const results = await Promise.all(Array.from({ length: 5 }, () => startTask({ kind: 'studio_render', key: 'race:new' })))
  assert.equal(results.filter(Boolean).length, 1)
  const rows = await db.select().from(schema.pipelineTasks)
  assert.equal(rows.filter(r => r.key === 'race:new').length, 1)
})

test('startTask: of concurrent restarts of a finished key exactly one wins', async () => {
  assert.ok(await startTask({ kind: 'studio_render', key: 'race:again' }))
  await updateTask('race:again', { status: 'done', finishedAt: now() })
  const results = await Promise.all(Array.from({ length: 5 }, () => startTask({ kind: 'studio_render', key: 'race:again' })))
  assert.equal(results.filter(Boolean).length, 1, 'two requests both reset the finished row to running')
  // still running → refused
  assert.equal(await startTask({ kind: 'studio_render', key: 'race:again' }), null)
})

test('upsertCreativeResult: concurrent first saves of one creative do not collide on UNIQUE(creative_id)', async () => {
  const ts = now()
  const campaign = await db.insert(schema.campaigns).values({
    title: 'c', productName: 'p', productImages: '[]', platforms: '["tiktok"]', status: 'draft', createdAt: ts, updatedAt: ts,
  }).returning({ id: schema.campaigns.id })
  const creative = await db.insert(schema.campaignCreatives).values({
    campaignId: insertedId(campaign), angle: 'a', hook: 'h', format: 'ugc', platform: 'tiktok', durationSec: 30,
    script: '## S1', status: 'approved', createdAt: ts, updatedAt: ts,
  }).returning({ id: schema.campaignCreatives.id })
  const id = insertedId(creative)
  const saved = await Promise.all([
    gallery.upsertCreativeResult(id, { views: 100 }),
    gallery.upsertCreativeResult(id, { likes: 7 }),
    gallery.upsertCreativeResult(id, { note: 'n' }),
  ])
  assert.equal(saved.length, 3)
  const rows = await db.select().from(schema.creativeResults)
  assert.equal(rows.length, 1)
  assert.deepEqual([rows[0].views, rows[0].likes, rows[0].note], [100, 7, 'n'], 'every field from every save is kept')
})
