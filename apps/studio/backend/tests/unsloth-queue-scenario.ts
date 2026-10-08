/**
 * Scenario คิวต่อ config (รันผ่าน wrapper tests/unsloth-queue.test.ts — SQLITE_PATH ชี้ DB ชั่วคราว)
 * - unsloth (maxConcurrent=1): งานที่ 2-3 คงสถานะ queued ไม่ submit + ตำแหน่งคิวถูกต้อง
 * - recover หลัง "รีสตาร์ท": งาน queued กลับเข้าคิวเดิม ไม่ถูกส่งทับสล็อต
 * - queue_timeout_minutes → failed + E_VIDEO_QUEUE_TIMEOUT
 * - volcengine (ไม่ประกาศ maxConcurrent): 3 งานพร้อมกันถูก submit ทันทีทั้งหมด (พฤติกรรมเดิม)
 */
import assert from 'node:assert/strict'

import { db, insertedId, schema } from '../src/core/db/index.js'
import { eq } from 'drizzle-orm'
import { now } from '../src/core/http/response.js'
import { generateVideo, pumpVideoQueue, recoverGenerationTasks, videoQueuePosition } from '../src/core/generation/generation.js'

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: any) => {
  const url = String(input)
  if (url.includes('/api/inference/video/status')) {
    return new Response(JSON.stringify({ loaded: true, repo_id: 'unsloth/MiniMax-H3-GGUF' }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  if (url.includes('/api/inference/video/generate') || url.includes('/api/inference/video/generate-progress')
    || url.includes('/contents/generations/tasks')) {
    // ค้างเหมือน provider กำลัง render — งานที่ submit แล้วต้องอยู่สถานะ submitting/processing
    return new Promise<Response>(() => {})
  }
  return realFetch(input)
}) as typeof fetch

async function waitFor(label: string, check: () => boolean, timeoutMs = 15_000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (check()) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`timeout waiting for: ${label}`)
}

const getTask = (id: number) => db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id)).all()[0]

function insertConfig(provider: string, model: string, settings: Record<string, unknown>) {
  const ts = now()
  const res = db.insert(schema.aiServiceConfigs).values({
    serviceType: 'video',
    provider,
    name: `${provider}-video-test`,
    baseUrl: provider === 'unsloth' ? 'http://127.0.0.1:8888' : 'https://volcengineai.example.local',
    apiKey: 'test-key-not-real',
    model: JSON.stringify([model]),
    priority: 0,
    isActive: true,
    settings: JSON.stringify(settings),
    createdAt: ts,
    updatedAt: ts,
  }).run()
  return getInsertId(res)
}

async function main() {
  const unslothConfigId = insertConfig('unsloth', 'unsloth/MiniMax-H3-GGUF', {
    price_thb_per_video_second: 0,
    max_concurrent: 1,
    queue_timeout_minutes: 240,
  })
  const volcengineConfigId = insertConfig('volcengine', 'doubao-seedance-2-0-mini-260615', { price_thb_per_video_second: 1 })

  // ── Phase A: 3 งาน unsloth พร้อมกัน → งานเดียวออกจากคิว ──
  const t1 = await generateVideo({ prompt: 'shot 1', duration: 6, configId: unslothConfigId })
  const t2 = await generateVideo({ prompt: 'shot 2', duration: 6, configId: unslothConfigId })
  const t3 = await generateVideo({ prompt: 'shot 3', duration: 6, configId: unslothConfigId })

  await waitFor('t1 submitting', () => getTask(t1)?.status === 'submitting')
  assert.equal(getTask(t1)!.status, 'submitting')
  assert.equal(getTask(t2)!.status, 'queued', 'งานที่ 2 ต้องรอคิว (maxConcurrent=1)')
  assert.equal(getTask(t3)!.status, 'queued', 'งานที่ 3 ต้องรอคิว')
  assert.equal(videoQueuePosition(getTask(t1)!), null, 'งานที่กำลัง submit ไม่มีตำแหน่งคิว')
  assert.equal(videoQueuePosition(getTask(t2)!), 1)
  assert.equal(videoQueuePosition(getTask(t3)!), 2)

  // ── Phase B: รีสตาร์ท — งาน queued กลับเข้าคิวเดิม ไม่ส่งทับสล็อต ──
  // จำลองงานที่ submit ไปก่อนหน้าแล้ว (มี taskId) กำลัง poll อยู่
  const fakeRunningTs = now()
  const fakeRunningRes = db.insert(schema.sysTask).values({
    type: 'video',
    prompt: 'submitted before restart',
    provider: 'unsloth',
    configId: unslothConfigId,
    params: JSON.stringify({ duration: 6 }),
    status: 'processing',
    taskId: 'job-before-restart',
    createdAt: fakeRunningTs,
    updatedAt: fakeRunningTs,
  }).run()
  const fakeRunningId = getInsertId(fakeRunningRes)

  const counts = await recoverGenerationTasks()
  assert.equal(counts.queued, 2, 'งาน queued 2 งานกลับเข้าคิวเดิม')
  assert.ok(counts.resumed >= 1, 'งานที่มี taskId resume poll ต่อ')
  assert.equal(getTask(fakeRunningId)!.status, 'processing')
  assert.equal(getTask(t2)!.status, 'queued', 'หลังรีสตาร์ทงานคิวยังรอ (สล็อตเต็ม)')
  assert.equal(getTask(t3)!.status, 'queued')

  // ── Phase C: queue_timeout_minutes → failed + E_VIDEO_QUEUE_TIMEOUT ──
  const stale = new Date(Date.now() - 241 * 60_000).toISOString()
  db.update(schema.sysTask).set({ createdAt: stale }).where(eq(schema.sysTask.id, t3)).run()
  await pumpVideoQueue()
  const t3Row = getTask(t3)!
  assert.equal(t3Row.status, 'failed', 'งานรอเกิน timeout ต้อง failed')
  assert.equal(t3Row.errorCode, 'E_VIDEO_QUEUE_TIMEOUT')
  assert.match(t3Row.errorMsg || '', /E_VIDEO_QUEUE_TIMEOUT/)
  assert.equal(getTask(t2)!.status, 'queued', 'งานที่ยังไม่เกิน timeout ยังรอต่อ')
  assert.equal(videoQueuePosition(getTask(t2)!), 1, 'ตำแหน่งคิวคำนวณใหม่หลังงานหน้าออก')

  // ── Phase D: volcengine ไม่มี maxConcurrent → 3 งานถูก submit ทันทีทั้งหมด (เหมือนเดิม) ──
  const v1 = await generateVideo({ prompt: 'v shot 1', duration: 5, configId: volcengineConfigId })
  const v2 = await generateVideo({ prompt: 'v shot 2', duration: 5, configId: volcengineConfigId })
  const v3 = await generateVideo({ prompt: 'v shot 3', duration: 5, configId: volcengineConfigId })
  await waitFor('volcengine tasks submitting', () => [v1, v2, v3].every(id => ['submitting', 'processing'].includes(getTask(id)?.status || '')))
  for (const id of [v1, v2, v3]) {
    const row = getTask(id)!
    assert.ok(['submitting', 'processing'].includes(row.status || ''), `volcengine task ${id} submitted immediately`)
    assert.equal(videoQueuePosition(row), null, 'volcengine ไม่มีคิว (ไม่ประกาศ maxConcurrent)')
  }

  console.log('unsloth queue: passed')
  process.exit(0) // worker ที่ค้างบน fetch stub ยังแขวน — ออกเอง
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
