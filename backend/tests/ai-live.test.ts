/**
 * AI Live (services/ai-live.ts) — รันกับ naka-live-agent ปลอม (HTTP stub ในเครื่อง) + fake Mastra agents
 * ตรวจ: ค่าตั้งเก็บ/ซ่อน token+stream key, ส่ง Bearer token, say/push/whep ถึง agent ถูกต้อง,
 * 401 → E_LIVE_UNAUTHORIZED, ไม่ได้ตั้งค่า → offline, สคริปต์/คำตอบ parse จาก JSON ของ LLM
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, after } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-live-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const live = await import('../src/services/ai-live.js')
const { mastra } = await import('../src/mastra/index.js')
{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const TOKEN = 'a'.repeat(32)
const RTMP = 'rtmps://live-api-s.facebook.com:443/rtmp/FB-secret-stream-key'
const calls: Array<{ method: string; url: string; auth: string; body: string }> = []
const stub = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => (body += d))
  req.on('end', () => {
    calls.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization || ''), body })
    const json = (code: number, data: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)) }
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return json(401, { ok: false, error: 'unauthorized' })
    if (req.url === '/health') return json(200, { ok: true, data: { livetalking: { running: true }, avatars: ['wav2lip256_avatar1'], gpu: { free_mb: 9000 } } })
    if (req.url === '/say') return json(200, { ok: true, data: { code: 0 } })
    if (req.url === '/push/start') return json(200, { ok: true, data: { running: true } })
    if (req.url === '/speaking') return json(200, { ok: true, data: { speaking: true } })
    if (req.url === '/start') return json(409, { ok: false, error: 'GPU has only 1200 MB free' })
    if (req.url === '/whep') { res.writeHead(201, { 'Content-Type': 'application/sdp' }); return res.end('v=0\r\nanswer') }
    json(404, { ok: false, error: 'not found' })
  })
})
await new Promise<void>(r => stub.listen(0, '127.0.0.1', () => r()))
const port = (stub.address() as any).port
after(() => stub.close())

// fake LLM agents
const replies = new Map<string, string[]>()
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) =>
  replies.has(type) ? { generate: async () => ({ text: replies.get(type)!.shift() ?? '' }) } : realGetAgent(type)
db.insert(schema.aiServiceConfigs).values({
  serviceType: 'text', provider: 'openai', name: 'test', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: JSON.stringify(['m']),
  isActive: true, priority: 1, createdAt: now(), updatedAt: now(),
} as any).run()

test('not configured → status offline, actions refuse with E_LIVE_NOT_CONFIGURED', async () => {
  const s = await live.liveStatus()
  assert.equal(s.online, false)
  assert.equal(s.config.configured, false)
  await assert.rejects(() => live.say({ text: 'สวัสดี' }), (e: any) => e.errorCode === 'E_LIVE_NOT_CONFIGURED')
})

test('config: validation, token and stream key are never returned', () => {
  assert.throws(() => live.saveLiveConfig({ agentUrl: 'ftp://x' }), (e: any) => e.errorCode === 'E_LIVE_CONFIG')
  assert.throws(() => live.saveLiveConfig({ token: 'short' }), (e: any) => e.errorCode === 'E_LIVE_CONFIG')
  assert.throws(() => live.saveLiveConfig({ voice: 'thai' }), (e: any) => e.errorCode === 'E_LIVE_CONFIG')
  assert.throws(() => live.saveLiveConfig({ rtmpUrl: 'http://x' }), (e: any) => e.errorCode === 'E_LIVE_CONFIG')
  const pub = live.saveLiveConfig({ agentUrl: `http://127.0.0.1:${port}/`, token: TOKEN, rtmpUrl: RTMP, voice: 'th-TH-NiwatNeural' })
  assert.equal(pub.configured, true)
  assert.equal(pub.agentUrl, `http://127.0.0.1:${port}`)
  assert.equal(pub.rtmpHost, 'live-api-s.facebook.com:443')
  assert.ok(!JSON.stringify(pub).includes(TOKEN))
  assert.ok(!JSON.stringify(pub).includes('FB-secret-stream-key'))
  // empty token keeps the stored one
  assert.equal(live.saveLiveConfig({ token: '' }).hasToken, true)
})

test('status, say, speaking, push and whep reach the agent with the Bearer token', async () => {
  const s = await live.liveStatus()
  assert.equal(s.online, true)
  assert.deepEqual((s.agent as any).avatars, ['wav2lip256_avatar1'])
  await live.say({ text: '  สวัสดีค่ะ   ทุกคน ', interrupt: true })
  const sayCall = calls.find(c => c.url === '/say')!
  assert.equal(sayCall.auth, `Bearer ${TOKEN}`)
  assert.deepEqual(JSON.parse(sayCall.body), { text: 'สวัสดีค่ะ ทุกคน', interrupt: true })
  await assert.rejects(() => live.say({ text: 'x'.repeat(601) }), (e: any) => e.errorCode === 'E_LIVE_SAY')
  assert.equal(await live.isSpeaking(), true)
  await live.startPush()
  assert.deepEqual(JSON.parse(calls.find(c => c.url === '/push/start')!.body), { rtmp_url: RTMP })
  assert.equal(await live.whep('v=0\r\noffer'), 'v=0\r\nanswer')
  await assert.rejects(() => live.whep('garbage'), (e: any) => e.errorCode === 'E_LIVE_SDP')
})

test('agent errors map to codes: 409 conflict, 401 unauthorized', async () => {
  await assert.rejects(() => live.startLive(), (e: any) => e.errorCode === 'E_LIVE_CONFLICT' && /1200 MB/.test(e.message))
  live.saveLiveConfig({ token: 'b'.repeat(30) })
  await assert.rejects(() => live.isSpeaking(), (e: any) => e.errorCode === 'E_LIVE_UNAUTHORIZED')
  live.saveLiveConfig({ token: TOKEN })
})

test('host script: parses fenced JSON, retries once, keeps only spoken lines', async () => {
  replies.set('live_host', ['oops not json', '```json\n{"lines": ["สวัสดีค่ะทุกคน", "", "  สบู่มะลิทำมือ  ", 42]}\n```'])
  const r = await live.writeHostScript({ product: { name: 'สบู่มะลิ', details: 'ทำมือ' } })
  assert.deepEqual(r.lines, ['สวัสดีค่ะทุกคน', 'สบู่มะลิทำมือ', '42'])
  await assert.rejects(() => live.writeHostScript({ product: { name: '' } }), (e: any) => e.errorCode === 'E_LIVE_PRODUCT')
})

test('comment answer: reply + handoff, and null reply for ignored comments', async () => {
  replies.set('live_responder', ['{"reply": "ขอเช็กให้ในแชทนะครับ", "handoff": true, "reason": "not in faq"}', '{"reply": null, "handoff": false, "reason": "ignored"}'])
  const a = await live.answerComment({ comment: 'ส่งวันไหนครับ', product: { name: 'สบู่มะลิ' } })
  assert.deepEqual(a, { reply: 'ขอเช็กให้ในแชทนะครับ', handoff: true, reason: 'not in faq' })
  const b = await live.answerComment({ comment: 'spam spam', product: { name: 'สบู่มะลิ' } })
  assert.equal(b.reply, null)
})
