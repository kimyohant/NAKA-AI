/**
 * Scenario: video tasks through the per-config queue to the end (run by tests/video-task-lifecycle.test.ts,
 * DATABASE_URL=pglite://memory, NAKA_DATA_DIR=<scratch>). Fake Unsloth server, no network.
 * A. a finished clip with fractional seconds (H3: 124/24 s) is written back to the bigint
 *    storyboards.duration, and the next queued task starts
 * B. the server loses an accepted job (restart / model unloaded): the task fails with E_PROVIDER_LOST
 *    instead of holding the queue, and the next queued task starts
 * C. cancel: a queued task can be cancelled; a task being polled or already finished cannot
 * D. an 'unknown' task holds the single slot until it is cancelled; then the queue moves on
 * E. queue timeout counts from the last time the queue moved, not from when the task was queued
 */
import assert from 'node:assert/strict'

import { eq, inArray } from 'drizzle-orm'
import { db, insertedId, schema } from '../src/core/db/index.js'
import { now } from '../src/core/http/response.js'
import { cancelGenerationTask, generateVideo, pumpVideoQueue } from '../src/core/generation/generation.js'

// ── fake Unsloth: each accepted job gets the next behaviour; generate-progress reports the latest job ──
type Behaviour = 'complete' | 'lost' | 'render'
const plan: Behaviour[] = ['complete', 'lost']
let current: { seed: number; behaviour: Behaviour } | null = null
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any, init?: RequestInit) => {
  const url = String(input)
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  if (url.includes('/api/inference/video/status')) return json({ loaded: true, repo_id: 'unsloth/MiniMax-H3-GGUF' })
  if (url.includes('/api/inference/video/generate-progress')) {
    if (!current || current.behaviour === 'render') return json({ active: true, phase: 'denoise', step: 1, total: 20 })
    if (current.behaviour === 'lost') return json({ active: false, phase: null, step: 0, total: 0, video: null })
    return json({ active: false, phase: 'completed', video: { id: 'v1', seed: current.seed, url: '/api/inference/video/gallery/v1/file', duration_s: 124 / 24 } })
  }
  if (url.includes('/api/inference/video/generate')) {
    current = { seed: Number(JSON.parse(String(init?.body || '{}')).seed), behaviour: plan.shift() ?? 'render' }
    return json({ status: 'started' })
  }
  if (url.includes('/api/inference/video/gallery/')) return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]), { status: 200 })
  return realFetch(input, init)
}) as typeof fetch

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs = 45_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await check()) return
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`timeout waiting for: ${label}`)
}

const getTask = async (id: number) => (await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id)))[0]
const getShot = async (id: number) => (await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id)))[0]
const started = async (id: number) => ['submitting', 'processing'].includes((await getTask(id))?.status || '')

async function insertUnslothConfig(name: string) {
  const ts = now()
  const res = await db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video', provider: 'unsloth', name, baseUrl: 'http://127.0.0.1:8888', apiKey: 'test-key-not-real',
    model: JSON.stringify(['unsloth/MiniMax-H3-GGUF']), priority: 0, isActive: true,
    settings: JSON.stringify({ price_thb_per_video_second: 0, max_concurrent: 1, queue_timeout_minutes: 240 }),
    createdAt: ts, updatedAt: ts,
  }).returning({ id: schema.aiServiceConfigs.id })
  return insertedId(res)
}

async function insertShots(count: number) {
  const ts = now()
  const dramaId = insertedId(await db.insert(schema.dramas).values({ title: 'lifecycle', createdAt: ts, updatedAt: ts }).returning({ id: schema.dramas.id }))
  const episodeId = insertedId(await db.insert(schema.episodes).values({ dramaId, episodeNumber: 1, title: 'ep', createdAt: ts, updatedAt: ts }).returning({ id: schema.episodes.id }))
  const ids: number[] = []
  for (let n = 1; n <= count; n++) {
    ids.push(insertedId(await db.insert(schema.storyboards).values({ episodeId, storyboardNumber: n, duration: 5, createdAt: ts, updatedAt: ts }).returning({ id: schema.storyboards.id })))
  }
  return { dramaId, shots: ids }
}

/** a task some earlier run left on the provider, holding the config's single slot */
async function insertProviderTask(configId: number, status: 'unknown' | 'processing', updatedAt: string) {
  const res = await db.insert(schema.sysTask).values({
    type: 'video', prompt: 'left by an earlier run', provider: 'unsloth', configId, params: JSON.stringify({ duration: 5 }),
    status, taskId: 'job-from-earlier-run', createdAt: updatedAt, updatedAt,
  }).returning({ id: schema.sysTask.id })
  return insertedId(res)
}

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString()

async function main() {
  const configId = await insertUnslothConfig('unsloth-lifecycle')
  const { dramaId, shots } = await insertShots(4)
  const video = (n: number, config = configId) => generateVideo({ prompt: `shot ${n}`, duration: 5, configId: config, storyboardId: shots[n - 1], dramaId })

  // ── A ──
  const t1 = await video(1)
  const t2 = await video(2)
  const t3 = await video(3)
  const t4 = await video(4)
  assert.equal((await getTask(t2))!.status, 'queued')
  await waitFor('t1 completed', async () => (await getTask(t1))?.status === 'completed')
  const shot1 = (await getShot(shots[0]))!
  assert.equal(shot1.duration, 5, 'H3 reports 5.1667 s; storyboards.duration is a bigint')
  assert.match(shot1.videoUrl || '', /^static\/videos\//)
  await waitFor('t2 left the queue', () => started(t2))

  // ── B: t2 is accepted, then the server reports idle with no clip ──
  await waitFor('t2 lost', async () => (await getTask(t2))?.status === 'failed', 120_000)
  assert.equal((await getTask(t2))!.errorCode, 'E_PROVIDER_LOST')
  await waitFor('t3 took the slot', () => started(t3))

  // ── C ──
  assert.equal(await cancelGenerationTask(t4), 'cancelled')
  const t4Row = (await getTask(t4))!
  assert.deepEqual([t4Row.status, t4Row.errorCode], ['failed', 'E_CANCELLED'])
  assert.equal(await cancelGenerationTask(t3), 'active', 'a task being polled cannot be cancelled')
  assert.equal(await cancelGenerationTask(t1), 'not_cancellable', 'a finished task stays finished')

  // ── D: an 'unknown' task keeps a second config's only slot ──
  const config2 = await insertUnslothConfig('unsloth-unknown-slot')
  const stuck = await insertProviderTask(config2, 'unknown', now())
  const t5 = await video(4, config2)
  await pumpVideoQueue()
  assert.equal((await getTask(t5))!.status, 'queued', 'the unknown task holds the slot')
  assert.equal(await cancelGenerationTask(stuck), 'cancelled')
  await waitFor('t5 took the freed slot', () => started(t5))

  // ── E: a third config whose slot is busy ──
  const config3 = await insertUnslothConfig('unsloth-stall')
  const running = await insertProviderTask(config3, 'processing', now())
  const t6 = await video(4, config3)
  await db.update(schema.sysTask).set({ createdAt: minutesAgo(241) }).where(eq(schema.sysTask.id, t6))
  await pumpVideoQueue()
  assert.equal((await getTask(t6))!.status, 'queued', 'queued 4 h ago, but the queue moved just now: keep waiting')
  await db.update(schema.sysTask).set({ updatedAt: minutesAgo(241) }).where(inArray(schema.sysTask.id, [running]))
  await pumpVideoQueue()
  const t6Row = (await getTask(t6))!
  assert.deepEqual([t6Row.status, t6Row.errorCode], ['failed', 'E_VIDEO_QUEUE_TIMEOUT'], 'nothing moved for 4 h: give up')

  console.log('video task lifecycle: passed')
  process.exit(0) // t3 and t5 keep "rendering" on the fake server
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
