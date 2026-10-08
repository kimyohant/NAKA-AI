/**
 * Unsloth video adapter unit tests (docs/unsloth/AGENT-A-backend.md Task 2)
 * ทดสอบล้วน ๆ ไม่ยิง network: lattice/preset/payload/poll mapping
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  durationToNumFrames,
  pickSize,
  unslothSettings,
  UnslothVideoAdapter,
  isConfiguredVideoModelLoaded,
  FRAME_STEP,
  FRAME_OFFSET,
  MIN_FRAMES,
  MAX_FRAMES,
} from '../src/services/adapters/unsloth-video.js'

const BASE = { provider: 'unsloth', baseUrl: 'http://127.0.0.1:8888', apiKey: 'test-key', model: 'unsloth/MiniMax-H3-GGUF' }

test('isConfiguredVideoModelLoaded: โมเดลอื่นโหลดอยู่ (เช่น Wan ผ่าน Unsloth UI) ไม่นับว่าพร้อม — ต้อง load H3 ก่อน', () => {
  const h3 = 'unsloth/MiniMax-H3-GGUF'
  // สถานะจริงที่เจอบน server ตอนรวมงาน: ผู้ใช้สลับไปโหลด Wan
  assert.equal(isConfiguredVideoModelLoaded({ loaded: true, repo_id: 'unsloth/Wan2.2-TI2V-5B-GGUF', family: 'wan2.2-ti2v-5b' }, h3), false)
  assert.equal(isConfiguredVideoModelLoaded({ loaded: false, repo_id: null }, h3), false)
  // H3 partition ref2va รับ first frame ไม่ได้ → ต้อง load fl2va ใหม่
  assert.equal(isConfiguredVideoModelLoaded({ loaded: true, repo_id: h3, h3_task: 'ref2va' }, h3), false)
  assert.equal(isConfiguredVideoModelLoaded({ loaded: true, repo_id: h3, h3_task: 'fl2va' }, h3), true)
  assert.equal(isConfiguredVideoModelLoaded({ loaded: true, repo_id: 'Unsloth/MiniMax-H3-GGUF', h3_task: 'fl2va' }, h3), true)
})

test('duration → num_frames อยู่บน lattice 17k+5 (5→124, 6→141, 10→243, 15→345, 20→345+เตือน)', () => {
  assert.deepEqual(durationToNumFrames(5), { numFrames: 124, clamped: true }) // 5s ต่ำกว่าช่วง (5.17s) → ช็อตสั้นสุด
  assert.deepEqual(durationToNumFrames(6), { numFrames: 141, clamped: false })
  assert.deepEqual(durationToNumFrames(10), { numFrames: 243, clamped: false })
  assert.deepEqual(durationToNumFrames(15), { numFrames: 345, clamped: true }) // 15s > max (14.4s)
  assert.deepEqual(durationToNumFrames(20), { numFrames: 345, clamped: true })
  for (const seconds of [5, 6, 7.5, 10, 12, 14.4]) {
    const { numFrames } = durationToNumFrames(seconds)
    assert.ok(numFrames >= MIN_FRAMES && numFrames <= MAX_FRAMES, `frames in range for ${seconds}s`)
    assert.equal((numFrames - FRAME_OFFSET) % FRAME_STEP, 0, `on lattice for ${seconds}s`)
  }
  assert.deepEqual(durationToNumFrames(null), { numFrames: 124, clamped: true })
})

test('aspect + quality → preset ตาม PLAN (fast เล็กสุด / standard ใหญ่สุดของ aspect นั้น)', () => {
  assert.deepEqual(pickSize('9:16', 'fast'), { width: 544, height: 960 })
  assert.deepEqual(pickSize('9:16', 'standard'), { width: 768, height: 1344 })
  assert.deepEqual(pickSize('16:9', 'fast'), { width: 960, height: 544 })
  assert.deepEqual(pickSize('16:9', 'standard'), { width: 1344, height: 768 })
  assert.deepEqual(pickSize('1:1', 'fast'), { width: 1024, height: 1024 })
  assert.deepEqual(pickSize('1:1', 'standard'), { width: 1024, height: 1024 })
  // aspect ที่ไม่รู้จัก → preset ทั้งชุด (เล็กสุด)
  assert.deepEqual(pickSize('adaptive', 'fast'), { width: 544, height: 960 })
  assert.deepEqual(pickSize(null, 'fast'), { width: 544, height: 960 })
})

test('unslothSettings: default ตาม PLAN ข้อ 3 + อ่านทับจาก settings ได้', () => {
  assert.deepEqual(unslothSettings(BASE), { steps: 20, quality: 'fast', maxConcurrent: 1, queueTimeoutMinutes: 240, ggufFilename: 'minimax_h3_fl2va_pruned-Q8_0.gguf' })
  const custom = unslothSettings({ ...BASE, settings: { steps: 30, quality: 'standard', max_concurrent: 2, queue_timeout_minutes: 60, gguf_filename: 'other.gguf' } })
  assert.deepEqual(custom, { steps: 30, quality: 'standard', maxConcurrent: 2, queueTimeoutMinutes: 60, ggufFilename: 'other.gguf' })
  // ค่าหลุดขอบเขตถูก clamp
  assert.equal(unslothSettings({ ...BASE, settings: { steps: 999 } }).steps, 100)
  assert.equal(unslothSettings({ ...BASE, settings: { steps: -3 } }).steps, 20)
  assert.equal(unslothSettings({ ...BASE, settings: { max_concurrent: 0 } }).maxConcurrent, 1)
})

test('capabilities ตามสัญญา (H3): min 5.17s · step 17/24 · max 14.375s · ทีละงาน · เสียงในตัว · ไม่ต้องใช้ URL สาธารณะ', () => {
  const caps = new UnslothVideoAdapter().capabilities!
  assert.equal(caps.minDurationSec, MIN_FRAMES / 24)
  assert.equal(caps.durationStepSec, FRAME_STEP / 24)
  assert.equal(caps.maxDurationSec, MAX_FRAMES / 24)
  assert.equal(caps.maxConcurrent, 1)
  assert.equal(caps.nativeAudio, true)
  assert.equal(caps.needsPublicUrls, false)
})

test('buildGenerateRequest: native endpoint + payload ไม่มี URL /static/ ดิบ + seed ระบุตัวตน', () => {
  const adapter = new UnslothVideoAdapter()
  const record = {
    id: 42,
    prompt: 'หญิงไทยยิ้มถือเซรั่ม',
    duration: 6,
    aspectRatio: '9:16',
    firstFrameUrl: 'data:image/jpeg;base64,AAAA',
  }
  const req = adapter.buildGenerateRequest(BASE, record as any)
  assert.equal(req.method, 'POST')
  assert.match(req.url, /\/api\/inference\/video\/generate$/)
  assert.equal(req.headers.Authorization, 'Bearer test-key')
  assert.equal(req.body.model, 'unsloth/MiniMax-H3-GGUF')
  assert.equal(req.body.num_frames, 141)
  assert.equal(req.body.steps, 20)
  assert.equal(req.body.seed, 42)
  assert.equal(req.body.first_frame, 'data:image/jpeg;base64,AAAA')
  assert.equal(req.body.width, 544)
  assert.equal(req.body.height, 960)
  // payload ต้องไม่มี path /static/ ดิบ (first frame เป็น data URL เท่านั้น)
  const serialized = JSON.stringify(req.body)
  assert.doesNotMatch(serialized, /\/static\//)
  // ผู้ใช้ตั้ง seed เองได้
  const custom = adapter.buildGenerateRequest(BASE, { ...record, seed: 7 } as any)
  assert.equal(custom.body.seed, 7)
  // prompt ว่าง → error ชัด
  assert.throws(() => adapter.buildGenerateRequest(BASE, { ...record, prompt: ' ' } as any), /prompt/)
})

test('parseGenerateResponse: {status:"started"} → taskId = seed (identity) สำหรับ poll', () => {
  const adapter = new UnslothVideoAdapter()
  const record = { id: 42, prompt: 'x', seed: 7 }
  const res = adapter.parseGenerateResponse({ status: 'started' }, { config: BASE, record: record as any })
  assert.equal(res.isAsync, true)
  assert.equal(res.taskId, '7')
  assert.throws(() => adapter.parseGenerateResponse({ error: 'nope' }, { config: BASE, record: record as any }))
})

test('parsePollResponse: phase mapping + ผูกผลด้วย seed (งานคนอื่นจบก่อน → ยังรอ) + URL แปลงเป็น absolute', () => {
  const adapter = new UnslothVideoAdapter()
  const ctx = { config: BASE, taskId: '42' }

  assert.deepEqual(adapter.parsePollResponse({ active: true, phase: 'denoise', step: 3, total: 20 }, ctx), { status: 'pending' })
  assert.deepEqual(adapter.parsePollResponse({ active: false, phase: null }, ctx), { status: 'pending' })

  const failed = adapter.parsePollResponse({ active: false, phase: 'failed', error: 'frame count invalid' }, ctx)
  assert.equal(failed.status, 'failed')
  assert.match(failed.error!, /frame count invalid/)

  // งานของเราจบ → completed + video URL จาก gallery ผูกกับ base URL
  const done = adapter.parsePollResponse({
    active: false,
    phase: 'completed',
    video: { id: 'abc', seed: 42, url: '/api/inference/video/gallery/abc/file', duration_s: 5.875 },
  }, ctx)
  assert.equal(done.status, 'completed')
  assert.equal(done.videoUrl, 'http://127.0.0.1:8888/api/inference/video/gallery/abc/file')
  assert.equal(done.duration, 5.875)

  // seed ไม่ตรง = คลิปของคนอื่น (progress เป็นสถานะระดับระบบ) → ยังไม่ผูกผล
  const other = adapter.parsePollResponse({
    active: false,
    phase: 'completed',
    video: { id: 'xyz', seed: 999, url: '/api/inference/video/gallery/xyz/file' },
  }, ctx)
  assert.equal(other.status, 'pending')

  // ไม่มี ctx (poll resume หลัง restart ก็มี ctx เสมอจาก generation.ts) — ป้องกันไว้: ถือว่า completed ของงานล่าสุด
  const noCtx = adapter.parsePollResponse({
    active: false,
    phase: 'completed',
    video: { id: 'abc', seed: 1, url: '/api/inference/video/gallery/abc/file' },
  })
  assert.equal(noCtx.status, 'completed')
})

test('isRetryableSubmit: 409/งานชนกัน → รอ submit ใหม่, validation/auth → ไม่ retry', () => {
  const adapter = new UnslothVideoAdapter()
  assert.equal(adapter.isRetryableSubmit?.({ detail: 'A generation is already running' }), true)
  assert.equal(adapter.isRetryableSubmit?.({ detail: 'Server busy, try again' }), true)
  assert.equal(adapter.isRetryableSubmit?.('HTTP 409 Conflict'), true)
  assert.equal(adapter.isRetryableSubmit?.({ error: { message: 'prompt: Field required' } }), false)
  assert.equal(adapter.isRetryableSubmit?.({ error: { message: 'Invalid API key' } }), false)
})

test('extractVideoUrl คืน url ของ gallery record', () => {
  const adapter = new UnslothVideoAdapter()
  assert.equal(adapter.extractVideoUrl({ video: { url: '/api/inference/video/gallery/abc/file' } }), '/api/inference/video/gallery/abc/file')
  assert.equal(adapter.extractVideoUrl({}), null)
})
