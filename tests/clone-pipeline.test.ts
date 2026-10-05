/**
 * Viral Clone pipeline scenario — รันใน process เดียว (env ก่อน import services, pattern เดียวกับ studio2-pipeline)
 * - ยิง provider จริงผ่าน HTTP stub server ในเครื่อง (openai image + volcengine video) ที่เสิร์ฟ media จริง
 *   (mp4 จาก ffmpeg-static, png จาก sharp) → ผ่าน generateImage/generateVideo → merge จริง → ffprobe จริง
 * - LLM (analyze/translate) ทดสอบด้วยการ patch mastra.getAgent ด้วย fake agent ที่สคริปต์ผลลัพธ์
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'
import Database from 'better-sqlite3'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)
const dir = mkdtempSync(path.join(tmpdir(), 'naka-clone-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now, AppError } = await import('../src/utils/response.js')
const clone = await import('../src/services/clone.js')
const { failStaleRunningTasks, RESUMABLE_PIPELINE_KINDS } = await import('../src/services/pipeline-tasks.js')
const { mastra } = await import('../src/mastra/index.js')

// ---------- seed: schema + configs + product/avatar + media ----------
{
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
  assert.deepEqual(versions.map(r => r.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14], 'migrations applied through v13')
  for (const table of ['clone_projects', 'clone_variants']) {
    const cols = (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(r => r.name)
    assert.ok(cols.length > 5, `${table} exists`)
  }
  sqlite.close()
}

const ts = now()
const pngBytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 120, b: 80 } } }).png().toBuffer()
const ffmpegPath = (await import('ffmpeg-static')).default as unknown as string
const clipPath = path.join(dir, 'clip.mp4')
await execFileAsync(ffmpegPath, [
  '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x568:d=1:r=24',
  '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
  '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', clipPath,
])
const clipBytes = readFileSync(clipPath)

mkdirSync(path.join(dir, 'static', 'images'), { recursive: true })
mkdirSync(path.join(dir, 'static', 'avatars'), { recursive: true })
writeFileSync(path.join(dir, 'static', 'images', 'p.png'), pngBytes)
writeFileSync(path.join(dir, 'static', 'avatars', 'a.png'), pngBytes)

// product (Studio) + avatar สำหรับ matrix/existence checks
{
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.prepare("INSERT INTO studio_projects (title, product_name, product_description, product_images, template_id, language, market, platform, aspect_ratio, duration_sec, status, created_at, updated_at) VALUES ('Serum S', 'Serum S', 'วิตซีเข้มข้น', '[\"static/images/p.png\"]', 'ugc_review', 'th', 'TH', 'tiktok', '9:16', 24, 'draft', ?, ?)").run(ts, ts)
  sqlite.prepare("INSERT INTO studio_avatars (name, description, image_url, created_at, updated_at) VALUES ('Ploy', 'Thai woman 25', '/static/avatars/a.png', ?, ?)").run(ts, ts)
  sqlite.close()
}

// ---------- HTTP stub server (openai image + volcengine video + media bytes) ----------
let imageCalls = 0
let videoJobs = 0
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://stub')
  const reply = (payload: unknown, type = 'application/json') => {
    res.writeHead(200, { 'Content-Type': type })
    res.end(type === 'application/json' ? JSON.stringify(payload) : payload as Buffer)
  }
  if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
    imageCalls += 1
    return reply({ data: [{ url: `http://127.0.0.1:${port}/media/img.png` }] })
  }
  if (req.method === 'POST' && url.pathname === '/api/v3/contents/generations/tasks') {
    videoJobs += 1
    return reply({ id: `job${videoJobs}` })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/api/v3/contents/generations/tasks/')) {
    return reply({ status: 'succeeded', video_url: `http://127.0.0.1:${port}/media/clip.mp4` })
  }
  if (req.method === 'GET' && url.pathname.startsWith('/media/')) {
    const name = url.pathname.split('/').pop()
    const isVideo = name?.endsWith('.mp4')
    res.writeHead(200, { 'Content-Type': isVideo ? 'video/mp4' : 'image/png' })
    return res.end(isVideo ? clipBytes : pngBytes)
  }
  res.writeHead(404)
  res.end('{}')
})
await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
const port = (server.address() as { port: number }).port
const stubBase = `http://127.0.0.1:${port}`

{
  const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  sqlite.pragma('journal_mode = WAL')
  sqlite.prepare("INSERT INTO ai_service_configs (service_type, provider, name, base_url, api_key, model, is_active, is_default, priority, created_at, updated_at) VALUES ('image','openai','stub',?,'sk-test-stub-local','[\"gpt-image-1\"]',1,1,10,?,?),('video','volcengine','stub',?,'sk-test-stub-local','[\"doubao-seedance-2-0-mini-260615\"]',1,1,10,?,?),('text','openai','stub-text',?,'sk-test-stub-local','[\"gpt-4o-mini\"]',1,1,10,?,?)").run(stubBase, ts, ts, stubBase, ts, ts, stubBase, ts, ts)
  sqlite.close()
}

// ---------- fake agent (LLM สคริปต์ผลลัพธ์ — analyze/translate) ----------
// script = mutable queue: generate แต่ละครั้งดึงรายการถัดไป (หมดคิว → '{}')
type ScriptedAgent = { script: () => string[] }
const fakeAgents = new Map<string, ScriptedAgent>()
const fakeScript = (entries: string[]): ScriptedAgent => {
  const queue = [...entries]
  return { script: () => queue }
}
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => {
  const fake = fakeAgents.get(type)
  if (fake) {
    return { generate: async () => ({ text: fake.script().shift() ?? '{}' }) }
  }
  return realGetAgent(type)
}

const goodJson = JSON.stringify({
  title: 'Acne Serum Clone',
  durationSec: 10,
  beats: [
    { id: 'b1', role: 'hook', line: 'หน้าใสใน 3 วัน', visual: 'product', visualHint: 'ถือเซรั่ม', durationSec: 5 },
    { id: 'b2', role: 'cta', line: 'กดตะกร้าเลยค่ะ', visual: 'avatar', visualHint: null, durationSec: 5 },
  ],
  hooks: ['ใครผิวหมองคะ ยกมือขึ้น', 'เซรั่มตัวนี้ขายดีที่สุด'],
  captionStyle: { style: 'bold', enabled: false },
})

test('clone CRUD + validation (Task 2)', { timeout: 30_000 }, async () => {
  await assert.rejects(
    () => clone.createCloneProject({ name: 'x', transcript: '   ' }),
    (err: any) => err instanceof AppError && err.errorCode === 'E_INVALID_FIELD',
  )
  const project = await clone.createCloneProject({ name: 'Clone Serum', transcript: 'สวัสดีครับ วันนี้จะรีวิวเซรั่ม ผลลัพธ์ดีมาก กดสั่งเลย', language: 'th' })
  assert.equal(project!.status, 'draft')
  assert.equal(project!.referencePath, null)

  const updated = await clone.updateCloneProject(project!.id, { name: 'Clone Serum v2', language: 'th' })
  assert.equal(updated!.name, 'Clone Serum v2')
  const detail = await clone.getCloneProjectDetail(project!.id)
  assert.deepEqual(detail!.variants, [])
  ;(globalThis as any).__cloneProjectId = project!.id
})

test('analyze: validate → repair 1 ครั้ง → ready; ยังพัง → E_CLONE_ANALYZE_FAILED (Task 3)', { timeout: 60_000 }, async () => {
  const projectId = (globalThis as any).__cloneProjectId as number
  fakeAgents.set('viral_cloner', fakeScript([
    '{"title":"x","beats":[]}', // ครั้งแรกพัง (beats ว่าง) → repair
    goodJson, // ครั้งที่สอง (repair) ผ่าน
  ]))
  const result = await clone.analyzeCloneProject(projectId, { async: false })
  assert.equal(result!.status, 'ready')
  assert.equal(result!.blueprint!.beats.length, 2)
  assert.equal(result!.errorCode, null)

  // โปรเจกต์ 2: พังทั้งสองครั้ง → error + code
  const broken = await clone.createCloneProject({ name: 'Broken', transcript: 'บทพูดคนโกหก ซื้อแล้วเสียใจ อย่าซื้อเด็ดขาด ระวังโดนหลอก' })
  fakeAgents.set('viral_cloner', fakeScript(['not json at all {{{', 'also bad ]]']))
  const failed = await clone.analyzeCloneProject(broken!.id, { async: false })
  assert.equal(failed!.status, 'error')
  assert.equal(failed!.errorCode, 'E_CLONE_ANALYZE_FAILED')
  assert.match(failed!.errorMsg || '', /^E_CLONE_ANALYZE_FAILED:/)

  // mutex: key กำลัง running → analyze ซ้ำ → E_CLONE_BUSY (deterministic — ไม่พึ่ง race ของ sync calls)
  fakeAgents.set('viral_cloner', fakeScript([goodJson]))
  const { startTask } = await import('../src/services/pipeline-tasks.js')
  await startTask({ kind: 'clone_analyze', key: `clone_analyze:${projectId}` })
  await assert.rejects(
    () => clone.analyzeCloneProject(projectId, { async: false }),
    (err: any) => err.errorCode === 'E_CLONE_BUSY',
  )
  await db.update(schema.pipelineTasks).set({ status: 'done', finishedAt: now() }).where(eqKey(`clone_analyze:${projectId}`))
  // รองรับ re-analyze หลังเคย ready
  const again = await clone.analyzeCloneProject(projectId, { async: false })
  assert.equal(again!.status, 'ready')
})

test('blueprint save: validate ก่อนเซฟ (Task 4)', { timeout: 30_000 }, async () => {
  const projectId = (globalThis as any).__cloneProjectId as number
  await assert.rejects(
    () => clone.saveCloneBlueprint(projectId, { beats: [{ id: 'b1', role: 'nonsense', line: 'x', visual: 'product', visualHint: null, durationSec: 3 }] }),
    (err: any) => err instanceof AppError && err.errorCode === 'E_INVALID_FIELD' && /role/.test(err.message),
  )
  const saved = await clone.saveCloneBlueprint(projectId, JSON.parse(goodJson))
  assert.equal(saved!.status, 'ready')
  assert.equal(saved!.blueprint!.beats[0].durationSec, 5)
})

test('matrix: cap 12 + ตรวจ product/avatar มีจริง (Task 5)', { timeout: 30_000 }, async () => {
  const projectId = (globalThis as any).__cloneProjectId as number
  await assert.rejects(
    () => clone.createCloneVariants(projectId, { matrix: { hookIndexes: [0, 1, 2, 3], productIds: [1, 2], avatarIds: [1, 2], languages: ['th', 'en'] } }),
    (err: any) => err.errorCode === 'E_CLONE_MATRIX_TOO_LARGE',
  )
  await assert.rejects(
    () => clone.createCloneVariants(projectId, { matrix: { productIds: [9999], languages: ['th'] } }),
    (err: any) => err.errorCode === 'E_INVALID_FIELD' && err.message.includes('9999'),
  )
  await assert.rejects(
    () => clone.createCloneVariants(projectId, { matrix: { avatarIds: [4242], languages: ['th'] } }),
    (err: any) => err.errorCode === 'E_INVALID_FIELD' && err.message.includes('4242'),
  )
  // สร้างจริง: hooks [0,1] × th + en แยกโปรเจกต์มุม → 3 ตัวแปร + 1 ตัว hookIndex นอกช่วง (เพื่อทดสอบ per-variant failure)
  const variants = await clone.createCloneVariants(projectId, { matrix: { hookIndexes: [0, 1], languages: ['th'] } })
  assert.equal(variants!.length, 2)
  assert.match(variants![0].label, /hook1 · noproduct · noavatar · th/)
  const en = await clone.createCloneVariants(projectId, { matrix: { languages: ['en'] } })
  assert.equal(en!.length, 1)
  const bad = await clone.createCloneVariants(projectId, { matrix: { hookIndexes: [99], languages: ['th'] } })
  assert.equal(bad!.length, 1)
  ;(globalThis as any).__variantIds = [variants![0].id, variants![1].id, en![0].id, bad![0].id]
})

test('render happy path (mock providers) — completed + outputPath + durationSec; per-variant failure ไม่หยุด batch (Task 6)', { timeout: 240_000 }, async () => {
  const projectId = (globalThis as any).__cloneProjectId as number
  const variantIds = (globalThis as any).__variantIds as number[]
  fakeAgents.set('viral_translator', fakeScript([
    JSON.stringify({
      lines: { b1: 'Glowing skin in 3 days', b2: 'Tap the cart now' },
      hooks: ['Who still has dull skin?', 'This serum sells out fast'],
    }),
  ]))

  const result = await clone.startCloneRender({ projectId })
  assert.equal(result!.queued, 4)

  // รอจนทุกตัวแปรจบ (completed/failed) — driver วนตามลำดับ id
  for (let i = 0; i < 60; i++) {
    const detail = await clone.getCloneProjectDetail(projectId)
    const settled = detail!.variants.every(v => ['completed', 'failed'].includes(v.status))
    if (settled) break
    await new Promise(r => setTimeout(r, 3_000))
  }
  const detail = await clone.getCloneProjectDetail(projectId)
  const byId = new Map(detail!.variants.map(v => [v.id, v]))
  for (const variantId of variantIds.slice(0, 3)) {
    const variant = byId.get(variantId)!
    assert.equal(variant.status, 'completed', `variant ${variantId}: ${variant.errorMsg}`)
    assert.match(variant.outputPath || '', /^\/static\/merged\/.+\.mp4$/)
    const abs = path.join(dir, 'static', 'merged', path.basename(variant.outputPath!))
    assert.ok(existsSync(abs), `output file exists for ${variantId}`)
    assert.ok((variant.durationSec ?? 0) > 0.5 && (variant.durationSec ?? 0) < 30, `duration from ffprobe: ${variant.durationSec}`)
    assert.ok(variant.queuePosition === null)
  }
  const failed = byId.get(variantIds[3])!
  assert.equal(failed.status, 'failed')
  assert.equal(failed.errorCode, 'E_INVALID_FIELD')
  assert.match(failed.errorMsg || '', /hookIndex 99/)
  // คำแปลถูก cache ไว้ใน overrides_json.translations (Agent A decision) และ agent ถูกเรียกแค่ครั้งเดียว
  const enVariant = byId.get(variantIds[2])!
  assert.ok((enVariant.overrides as any).translations?.en?.lines?.b1 === 'Glowing skin in 3 days')
  // 3 variants × 2 beats (variant ที่ hookIndex 99 ล้มก่อนส่งงาน) — ครบถ้วนและพอดี
  assert.equal(imageCalls, 6)
  assert.equal(videoJobs, 6)
})

test('queuePosition + delete guard (สัญญา Agent B)', { timeout: 30_000 }, async () => {
  const projectId = (globalThis as any).__cloneProjectId as number
  const variantIds = (globalThis as any).__variantIds as number[]
  // set ตัวแรก rendering ตัวที่สอง queued → position 1, delete ตัว rendering → E_CLONE_BUSY
  await db.update(schema.cloneVariants).set({ status: 'rendering', updatedAt: now() }).where(eqId(variantIds[0]))
  await db.update(schema.cloneVariants).set({ status: 'queued', updatedAt: now() }).where(eqId(variantIds[1]))
  const queued = await clone.getCloneVariantDetail(variantIds[1])
  assert.equal(queued!.queuePosition, 1)
  await assert.rejects(
    () => clone.deleteCloneVariant(variantIds[0]),
    (err: any) => err.errorCode === 'E_CLONE_BUSY',
  )
  // restore
  await db.update(schema.cloneVariants).set({ status: 'completed', updatedAt: now() }).where(eqId(variantIds[0]))
  await db.update(schema.cloneVariants).set({ status: 'completed', updatedAt: now() }).where(eqId(variantIds[1]))
  // project delete ระหว่างมี variant queued → E_CLONE_BUSY
  await db.update(schema.cloneVariants).set({ status: 'queued', updatedAt: now() }).where(eqId(variantIds[1]))
  await assert.rejects(
    () => clone.deleteCloneProject(projectId),
    (err: any) => err.errorCode === 'E_CLONE_BUSY',
  )
  await db.update(schema.cloneVariants).set({ status: 'completed', updatedAt: now() }).where(eqId(variantIds[1]))
})

test('boot-resume: clone_render อยู่ใน RESUMABLE kind + resume วิ่งต่อจน variant re-render เสร็จ', { timeout: 240_000 }, async () => {
  assert.ok(RESUMABLE_PIPELINE_KINDS.includes('clone_render'))
  const projectId = (globalThis as any).__cloneProjectId as number
  const variantIds = (globalThis as any).__variantIds as number[]
  // จำลองรีสตาร์ท: variant แรกเคย completed → ทำเป็น failed + pipeline row running (row เดิม reset กลับ running)
  await db.update(schema.cloneVariants).set({ status: 'failed', errorCode: null, errorMsg: null, updatedAt: now() }).where(eqId(variantIds[0]))
  const key = `clone_render:${projectId}`
  await db.update(schema.pipelineTasks).set({ status: 'running', errorMsg: null, cancelRequested: 0, finishedAt: null, updatedAt: now() }).where(eqKey(key))
  // failStaleRunningTasks ต้องไม่แตะ row นี้
  await failStaleRunningTasks()
  const [row] = await db.select().from(schema.pipelineTasks).where(eqKey(key))
  assert.equal(row!.status, 'running', 'clone_render ถูกปล่อยให้ resume')
  await db.delete(schema.pipelineTasks).where(eqKey(key))

  const resumed = await clone.resumeStaleCloneRenders() // ไม่มี running row แล้ว → 0
  assert.equal(resumed, 0)
  // start ใหม่ผ่าน render-all → failed ทั้งสองถูกคิวใหม่ (v1 re-render สำเร็จ, v4 ล้มซ้ำตาม hookIndex 99)
  const result = await clone.startCloneRender({ projectId })
  assert.equal(result!.queued, 2)
  for (let i = 0; i < 60; i++) {
    const v1 = await clone.getCloneVariantDetail(variantIds[0])
    const v4 = await clone.getCloneVariantDetail(variantIds[3])
    if (['completed', 'failed'].includes(v1!.status) && ['completed', 'failed'].includes(v4!.status)) break
    await new Promise(r => setTimeout(r, 3_000))
  }
  const variant = await clone.getCloneVariantDetail(variantIds[0])
  assert.equal(variant!.status, 'completed', variant!.errorMsg || '')
  const variant4 = await clone.getCloneVariantDetail(variantIds[3])
  assert.equal(variant4!.status, 'failed')
})

// helper
function eqId(id: number) {
  return eq(schema.cloneVariants.id, id)
}
function eqKey(key: string) {
  return eq(schema.pipelineTasks.key, key)
}

test('cleanup', () => {
  ;(mastra as any).getAgent = realGetAgent
  server.close()
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch { /* Windows อาจล็อกไฟล์ — ปล่อยให้ OS เคลียร์ */ }
})
