/**
 * AI Live avatars (services/live-avatars.ts) — รันกับ naka-live-agent ปลอม + ตัวสร้างวิดีโอปลอม
 * ตรวจ: ชื่อ/ยินยอม/ไฟล์, รูป → วิดีโอ (ได้ data URL ของรูป) → ส่ง multipart (avatar_id มาก่อน file) → รอจน done,
 * วิดีโอ → ส่งตรง, ห้ามสร้างจากรูปตอนอวตารรันอยู่, ชื่อซ้ำ, agent แจ้งล้ม → job failed
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, after } from 'node:test'
import sharp from 'sharp'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-avatar-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')
mkdirSync(path.join(dir, 'static', 'uploads'), { recursive: true })
mkdirSync(path.join(dir, 'static', 'videos'), { recursive: true })

const live = await import('../src/modules/live/services/ai-live.js')
const avatars = await import('../src/modules/live/services/live-avatars.js')

// uploads that Studio would have stored
await sharp({ create: { width: 64, height: 96, channels: 3, background: '#88aaff' } }).png().toFile(path.join(dir, 'static', 'uploads', 'me.png'))
writeFileSync(path.join(dir, 'static', 'uploads', 'me.mp4'), Buffer.from('fake-mp4-bytes'))
writeFileSync(path.join(dir, 'static', 'videos', 'idle.mp4'), Buffer.from('ai-idle-video'))

const TOKEN = 't'.repeat(30)
let running = false
const existing = ['wav2lip256_avatar1']
const tasks = new Map<string, { polls: number; fail?: boolean }>()
const uploads: Array<{ order: string[]; avatarId: string; bytes: number }> = []
const stub = http.createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', d => chunks.push(d))
  req.on('end', () => {
    const j = (c: number, d: unknown) => { res.writeHead(c, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)) }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return j(401, { ok: false, error: 'unauthorized' })
    if (req.url === '/health') return j(200, { ok: true, data: { livetalking: { running }, push: { running: false }, gpu: null, avatars: existing, models_ready: true } })
    if (req.url === '/avatars' && req.method === 'POST') {
      const raw = Buffer.concat(chunks).toString('latin1')
      const order = [...raw.matchAll(/form-data; name="([^"]+)"/g)].map(m => m[1])
      const avatarId = /name="avatar_id"\r\n\r\n([^\r]+)/.exec(raw)?.[1] || ''
      uploads.push({ order, avatarId, bytes: chunks.reduce((n, c) => n + c.length, 0) })
      tasks.set(avatarId, { polls: 0, fail: avatarId.includes('broken') })
      return j(202, { ok: true, data: { avatar_id: avatarId, status: 'queued' } })
    }
    const m = /^\/avatars\/tasks\/(.+)$/.exec(req.url || '')
    if (m) {
      const t = tasks.get(m[1])!
      t.polls++
      if (t.fail) return j(200, { ok: true, data: { status: 'failed', error: 'genavatar failed (no face found?)' } })
      return j(200, { ok: true, data: { status: t.polls >= 2 ? 'done' : 'building' } })
    }
    j(404, { ok: false, error: 'not found' })
  })
})
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()))
after(() => stub.close())
live.saveLiveConfig({ agentUrl: `http://127.0.0.1:${(stub.address() as any).port}`, token: TOKEN })
avatars.__setPollMs(20)

let madeWith = ''
avatars.__setVideoMaker(async (firstFrame) => { madeWith = firstFrame; return 'static/videos/idle.mp4' })

async function settle(id: string) {
  for (let i = 0; i < 200; i++) {
    const job = avatars.listAvatarJobs().find(j => j.avatarId === id)!
    if (job.stage === 'done' || job.stage === 'failed') return job
    await new Promise(r => setTimeout(r, 20))
  }
  throw new Error('job did not settle')
}

test('validation: name, source, consent, file', async () => {
  await assert.rejects(() => avatars.createAvatar({ name: 'A B', source: 'photo', path: 'static/uploads/me.png', consent: true }), (e: any) => e.errorCode === 'E_AVATAR_NAME')
  await assert.rejects(() => avatars.createAvatar({ name: 'naka_ann', source: 'gif', path: 'static/uploads/me.png', consent: true }), (e: any) => e.errorCode === 'E_AVATAR_SOURCE')
  await assert.rejects(() => avatars.createAvatar({ name: 'naka_ann', source: 'photo', path: 'static/uploads/me.png' }), (e: any) => e.errorCode === 'E_AVATAR_CONSENT')
  await assert.rejects(() => avatars.createAvatar({ name: 'naka_ann', source: 'photo', path: '../../etc/passwd', consent: true }), (e: any) => e.errorCode === 'E_AVATAR_FILE')
  await assert.rejects(() => avatars.createAvatar({ name: 'wav2lip256_avatar1', source: 'video', path: 'static/uploads/me.mp4', consent: true }), (e: any) => e.errorCode === 'E_AVATAR_EXISTS')
})

test('photo → AI idle video (from a data URL of the photo) → upload → done', async () => {
  const job = await avatars.createAvatar({ name: 'Naka_Ann', source: 'photo', path: '/static/uploads/me.png', consent: true })
  assert.equal(job.avatarId, 'naka_ann')
  assert.equal(job.stage, 'video')
  const done = await settle('naka_ann')
  assert.equal(done.stage, 'done', done.error || '')
  assert.match(madeWith, /^data:image\//)
  const up = uploads.find(u => u.avatarId === 'naka_ann')!
  assert.deepEqual(up.order, ['avatar_id', 'file']) // agent needs the id before the file
  assert.ok(up.bytes > 'ai-idle-video'.length)
})

test('video goes straight to the agent; agent failure marks the job failed', async () => {
  const ok = await settle((await avatars.createAvatar({ name: 'naka_vid', source: 'video', path: 'static/uploads/me.mp4', consent: true })).avatarId)
  assert.equal(ok.stage, 'done')
  const bad = await settle((await avatars.createAvatar({ name: 'naka_broken', source: 'video', path: 'static/uploads/me.mp4', consent: true })).avatarId)
  assert.equal(bad.stage, 'failed')
  assert.match(bad.error || '', /no face/)
})

test('photo is refused while the avatar is running (the AI video needs the whole GPU)', async () => {
  running = true
  await assert.rejects(() => avatars.createAvatar({ name: 'naka_busy', source: 'photo', path: 'static/uploads/me.png', consent: true }), (e: any) => e.errorCode === 'E_AVATAR_GPU_BUSY')
  running = false
})
