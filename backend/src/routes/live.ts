/**
 * AI Live 路由 — /api/v1/live (docs/ai-live/PLAN.md)
 * ทุก endpoint คุยกับ naka-live-agent บนเครื่อง GPU ผ่าน services/ai-live.ts (token อยู่ฝั่ง backend เท่านั้น)
 * - GET/PUT /config · GET /status · POST /start /stop /say /interrupt · GET /speaking
 * - POST /push/start /push/stop (RTMP ไปแพลตฟอร์ม) · POST /whep (SDP พรีวิว, text/plain ↔ application/sdp)
 * - POST /script (live_host) · POST /answer (live_responder) · POST /free-gpu (ปลดโมเดล Unsloth)
 * - POST /tiktok/connect /tiktok/disconnect · GET /tiktok/events?after= (คอมเมนต์ไลฟ์ TikTok)
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { success, badRequest } from '../utils/response.js'
import * as live from '../services/ai-live.js'
import * as tiktok from '../services/tiktok-live.js'

const app = new Hono()

async function run(c: Context, fn: () => Promise<unknown> | unknown) {
  try {
    return success(c, await fn())
  } catch (err: any) {
    return badRequest(c, err?.message || 'AI Live error', err?.errorCode)
  }
}

const body = async (c: Context) => c.req.json().catch(() => ({} as Record<string, unknown>))

app.get('/config', c => run(c, () => live.getLiveConfig()))
app.put('/config', async c => { const b = await body(c); return run(c, () => live.saveLiveConfig(b)) })
app.get('/status', c => run(c, () => live.liveStatus()))

app.post('/start', async c => { const b = await body(c); return run(c, () => live.startLive(b)) })
app.post('/stop', c => run(c, () => live.stopLive()))
app.post('/say', async c => { const b = await body(c); return run(c, () => live.say(b)) })
app.post('/interrupt', c => run(c, () => live.interruptLive()))
app.get('/speaking', c => run(c, async () => ({ speaking: await live.isSpeaking() })))

app.post('/push/start', c => run(c, () => live.startPush()))
app.post('/push/stop', c => run(c, () => live.stopPush()))
app.post('/free-gpu', c => run(c, () => live.freeUnslothGpu()))

app.post('/script', async c => { const b = await body(c); return run(c, () => live.writeHostScript(b)) })
app.post('/answer', async c => { const b = await body(c); return run(c, () => live.answerComment(b)) })

// TikTok LIVE comments (services/tiktok-live.ts): connect to a channel that is live, then poll events
app.post('/tiktok/connect', async (c) => {
  const b = await body(c)
  return run(c, async () => {
    const saved = live.getTikTokSettings()
    const username = String(b.username || saved.username || '')
    const status = await tiktok.connectTikTok({ username, signApiKey: saved.signApiKey })
    if (b.username) live.saveLiveConfig({ tiktokUsername: status.username }) // remember the last channel
    return status
  })
})
app.post('/tiktok/disconnect', c => run(c, () => tiktok.disconnectTikTok()))
app.get('/tiktok/events', c => run(c, () => tiktok.tiktokEvents(c.req.query('after'))))

// WHEP: the browser posts its raw SDP offer; we answer with the raw SDP from SRS
app.post('/whep', async (c) => {
  try {
    const answer = await live.whep(await c.req.text())
    return c.body(answer, 201, { 'Content-Type': 'application/sdp' })
  } catch (err: any) {
    return badRequest(c, err?.message || 'WHEP failed', err?.errorCode)
  }
})

export default app
