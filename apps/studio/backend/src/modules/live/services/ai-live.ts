/**
 * AI Live — ไลฟ์ขายของด้วยอวตาร LiveTalking บนเครื่อง GPU (docs/ai-live/PLAN.md)
 *
 * Studio ไม่คุย LiveTalking/SRS ตรง ๆ แต่สั่งผ่าน naka-live-agent (deploy/ai-live) ด้วย Bearer token:
 *   /health /start /stop /say /interrupt /speaking /push/start /push/stop /whep
 * ค่าตั้ง (agentUrl, token, avatar, voice, rtmpUrl) เก็บใน app_settings key `ai_live`;
 * token และ rtmpUrl (มี stream key) ไม่ถูกส่งกลับไปที่ frontend — คืนเฉพาะ hasToken / hasRtmpUrl / rtmpHost
 * สคริปต์พิธีกร (live_host) และคำตอบคอมเมนต์ (live_responder) มาจาก Mastra agent → parse JSON ฝั่งนี้
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../core/db/index.js'
import { AppError, now } from '../../../core/http/response.js'
import { mastra } from '../../../core/mastra/index.js'
import { getTextConfig } from '../../../core/ai/ai.js'
import { joinProviderUrl } from '../../../core/ai/adapters/url.js'

const SETTINGS_KEY = 'ai_live'
export const LIVE_VOICES = ['th-TH-PremwadeeNeural', 'th-TH-AcharaNeural', 'th-TH-NiwatNeural'] as const
const VOICE_RE = /^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$/
const SAFE_ID_RE = /^[A-Za-z0-9_.-]{1,80}$/
const MAX_SAY = 600

export interface LiveConfig {
  agentUrl: string
  token: string
  avatarId: string
  voice: string
  rtmpUrl: string
  /** TikTok channel whose live comments feed the AI (services/tiktok-live.ts) */
  tiktokUsername: string
  /** optional Euler Stream sign-server key (secret, raises the free rate limit) */
  tiktokSignApiKey: string
}

/** สิ่งที่ส่งให้ frontend — ไม่มี token / stream key / sign key */
export interface PublicLiveConfig {
  agentUrl: string
  avatarId: string
  voice: string
  hasToken: boolean
  hasRtmpUrl: boolean
  rtmpHost: string
  configured: boolean
  tiktokUsername: string
  hasTiktokSignKey: boolean
}

const DEFAULTS: LiveConfig = { agentUrl: '', token: '', avatarId: 'wav2lip256_avatar1', voice: 'th-TH-PremwadeeNeural', rtmpUrl: '', tiktokUsername: '', tiktokSignApiKey: '' }

// The config is read from PostgreSQL once at startup and kept in memory: the readers are synchronous
// (agent(), liveStatus(), …). Writes update the cache first, then persist in order in the background;
// the settings route waits for flushLiveConfig() before it answers.
let cached: LiveConfig = { ...DEFAULTS }

export async function loadLiveConfig(): Promise<void> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, SETTINGS_KEY))
  try {
    cached = { ...DEFAULTS, ...(row?.value ? JSON.parse(row.value) : {}) }
  } catch {
    cached = { ...DEFAULTS }
  }
}

function readConfig(): LiveConfig {
  return { ...cached }
}

let persisting: Promise<unknown> = Promise.resolve()
function writeConfig(cfg: LiveConfig) {
  cached = { ...cfg }
  const value = JSON.stringify(cfg)
  persisting = persisting.then(() => db.insert(schema.appSettings)
    .values({ key: SETTINGS_KEY, value, updatedAt: now() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: now() } }))
    .catch(err => console.error('live config was not saved:', err?.message))
}

/** Resolves when every saveLiveConfig() so far is in the database. */
export function flushLiveConfig(): Promise<unknown> {
  return persisting
}

await loadLiveConfig()

function rtmpHost(url: string) {
  try { return new URL(url.replace(/^rtmps?:/, 'http:')).host } catch { return '' }
}

export function toPublic(cfg: LiveConfig): PublicLiveConfig {
  return {
    agentUrl: cfg.agentUrl,
    avatarId: cfg.avatarId,
    voice: cfg.voice,
    hasToken: !!cfg.token,
    hasRtmpUrl: !!cfg.rtmpUrl,
    rtmpHost: rtmpHost(cfg.rtmpUrl),
    configured: !!cfg.agentUrl && !!cfg.token,
    tiktokUsername: cfg.tiktokUsername,
    hasTiktokSignKey: !!cfg.tiktokSignApiKey,
  }
}

export function getLiveConfig(): PublicLiveConfig {
  return toPublic(readConfig())
}

/** อัปเดตบางฟิลด์; token/rtmpUrl ที่ส่งมาเป็นค่าว่างหรือไม่ส่ง = คงค่าเดิม, ส่ง null = ลบ */
export function saveLiveConfig(input: Record<string, unknown>): PublicLiveConfig {
  const cfg = readConfig()
  if (input.agentUrl !== undefined) {
    const url = String(input.agentUrl || '').trim().replace(/\/+$/, '')
    if (url && !/^https?:\/\/[^\s/]+(:\d+)?$/.test(url)) throw new AppError('agentUrl ต้องเป็น http(s)://host:port', 'E_LIVE_CONFIG')
    cfg.agentUrl = url
  }
  if (input.token === null) cfg.token = ''
  else if (typeof input.token === 'string' && input.token.trim()) {
    if (input.token.trim().length < 24) throw new AppError('token ต้องยาวอย่างน้อย 24 ตัวอักษร', 'E_LIVE_CONFIG')
    cfg.token = input.token.trim()
  }
  if (input.avatarId !== undefined) {
    const id = String(input.avatarId || '').trim()
    if (id && !SAFE_ID_RE.test(id)) throw new AppError('avatarId ไม่ถูกต้อง', 'E_LIVE_CONFIG')
    cfg.avatarId = id || DEFAULTS.avatarId
  }
  if (input.voice !== undefined) {
    const v = String(input.voice || '').trim()
    if (!VOICE_RE.test(v)) throw new AppError('voice ไม่ถูกต้อง (เช่น th-TH-PremwadeeNeural)', 'E_LIVE_CONFIG')
    cfg.voice = v
  }
  if (input.rtmpUrl === null) cfg.rtmpUrl = ''
  else if (typeof input.rtmpUrl === 'string' && input.rtmpUrl.trim()) {
    const u = input.rtmpUrl.trim()
    if (!/^rtmps?:\/\/\S+$/.test(u)) throw new AppError('RTMP URL ต้องขึ้นต้นด้วย rtmp:// หรือ rtmps://', 'E_LIVE_CONFIG')
    cfg.rtmpUrl = u
  }
  if (input.tiktokUsername !== undefined) {
    const u = String(input.tiktokUsername || '').trim().replace(/^@/, '')
    if (u && !/^[A-Za-z0-9._]{2,24}$/.test(u)) throw new AppError('ชื่อช่อง TikTok ไม่ถูกต้อง', 'E_LIVE_CONFIG')
    cfg.tiktokUsername = u
  }
  if (input.tiktokSignApiKey === null) cfg.tiktokSignApiKey = ''
  else if (typeof input.tiktokSignApiKey === 'string' && input.tiktokSignApiKey.trim()) cfg.tiktokSignApiKey = input.tiktokSignApiKey.trim().slice(0, 200)
  writeConfig(cfg)
  return toPublic(cfg)
}

/** TikTok channel + sign key for services/tiktok-live.ts (backend only) */
export function getTikTokSettings() {
  const cfg = readConfig()
  return { username: cfg.tiktokUsername, signApiKey: cfg.tiktokSignApiKey }
}

// ---------- naka-live-agent client ----------

async function agent(path: string, opts: { method?: string; json?: unknown; sdp?: string; form?: FormData; timeoutMs?: number } = {}) {
  const cfg = readConfig()
  if (!cfg.agentUrl || !cfg.token) throw new AppError('ยังไม่ได้ตั้งค่าเครื่อง AI Live (agent URL + token)', 'E_LIVE_NOT_CONFIGURED')
  let res: Response
  try {
    res = await fetch(cfg.agentUrl + path, {
      method: opts.method || (opts.json !== undefined || opts.sdp !== undefined || opts.form ? 'POST' : 'GET'),
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        ...(opts.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.sdp !== undefined ? { 'Content-Type': 'application/sdp' } : {}),
      },
      // FormData sets its own multipart Content-Type with the boundary
      body: opts.form ?? (opts.sdp !== undefined ? opts.sdp : opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
    })
  } catch (err: any) {
    throw new AppError(`ติดต่อเครื่อง AI Live ไม่ได้ (${err?.name === 'TimeoutError' ? 'timeout' : err?.message || 'network'})`, 'E_LIVE_UNREACHABLE')
  }
  if (res.status === 401) throw new AppError('เครื่อง AI Live ปฏิเสธ token', 'E_LIVE_UNAUTHORIZED')
  return res
}

/** call naka-live-agent and unwrap {ok, data}; also used by services/live-avatars.ts */
export async function agentJson(path: string, opts: Parameters<typeof agent>[1] = {}) {
  const res = await agent(path, opts)
  const body: any = await res.json().catch(() => ({}))
  if (!res.ok || body?.ok === false) {
    throw new AppError(body?.error || `AI Live agent HTTP ${res.status}`, res.status === 409 ? 'E_LIVE_CONFLICT' : 'E_LIVE_AGENT')
  }
  return body?.data
}

export async function liveStatus() {
  const config = getLiveConfig()
  if (!config.configured) return { config, online: false, agent: null }
  try {
    return { config, online: true, agent: await agentJson('/health', { timeoutMs: 8000 }) }
  } catch (err: any) {
    return { config, online: false, agent: null, error: err?.message || String(err) }
  }
}

export async function startLive(input: { avatarId?: string; voice?: string } = {}) {
  const cfg = readConfig()
  const avatarId = String(input.avatarId || cfg.avatarId)
  const voice = String(input.voice || cfg.voice)
  if (!SAFE_ID_RE.test(avatarId)) throw new AppError('avatarId ไม่ถูกต้อง', 'E_LIVE_CONFIG')
  if (!VOICE_RE.test(voice)) throw new AppError('voice ไม่ถูกต้อง', 'E_LIVE_CONFIG')
  // model load + first WebRTC push: the agent waits up to ~3 minutes
  return agentJson('/start', { json: { avatar_id: avatarId, voice, model: 'wav2lip' }, timeoutMs: 200_000 })
}

export const stopLive = () => agentJson('/stop', { json: {} })
export const interruptLive = () => agentJson('/interrupt', { json: {} })
export async function isSpeaking(): Promise<boolean> {
  const data = await agentJson('/speaking', { timeoutMs: 8000 })
  return !!data?.speaking
}

export async function say(input: { text?: unknown; interrupt?: unknown; voice?: unknown }) {
  const text = String(input.text || '').replace(/\s+/g, ' ').trim()
  if (!text) throw new AppError('ไม่มีข้อความให้พูด', 'E_LIVE_SAY')
  if (text.length > MAX_SAY) throw new AppError(`ข้อความยาวเกิน ${MAX_SAY} ตัวอักษร`, 'E_LIVE_SAY')
  const voice = input.voice ? String(input.voice) : undefined
  if (voice && !VOICE_RE.test(voice)) throw new AppError('voice ไม่ถูกต้อง', 'E_LIVE_SAY')
  return agentJson('/say', { json: { text, interrupt: !!input.interrupt, ...(voice ? { voice } : {}) } })
}

/** ไลฟ์จริง: ส่งต่อสตรีมไป RTMP ที่บันทึกไว้ (URL + stream key อยู่ฝั่ง backend เท่านั้น) */
export async function startPush() {
  const cfg = readConfig()
  if (!cfg.rtmpUrl) throw new AppError('ยังไม่ได้ใส่ RTMP URL + stream key ของแพลตฟอร์ม', 'E_LIVE_NO_RTMP')
  return agentJson('/push/start', { json: { rtmp_url: cfg.rtmpUrl }, timeoutMs: 30_000 })
}
export const stopPush = () => agentJson('/push/stop', { json: {} })

/** พรีวิวในเบราว์เซอร์: ส่ง SDP offer ของผู้ดูผ่าน agent → SRS WHEP; คืน SDP answer */
export async function whep(offer: string): Promise<string> {
  if (!offer || !offer.startsWith('v=0') || offer.length > 20_000) throw new AppError('SDP offer ไม่ถูกต้อง', 'E_LIVE_SDP')
  const res = await agent('/whep', { sdp: offer, timeoutMs: 20_000 })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text)?.error || text } catch { /* raw */ }
    throw new AppError(`เปิดพรีวิวไม่ได้: ${msg.slice(0, 200)}`, 'E_LIVE_AGENT')
  }
  return text
}

/** ปลดโมเดล Unsloth (รูป/วิดีโอ) ที่ค้างบน GPU ก่อนเริ่มไลฟ์ — การ์ด 24 GB รับ H3/Qwen-Image + LiveTalking พร้อมกันไม่ไหว */
export async function freeUnslothGpu() {
  const rows = (await db.select().from(schema.aiServiceConfigs)).filter(r => (r.provider || '').toLowerCase() === 'unsloth' && r.baseUrl)
  const servers = [...new Map(rows.map(r => [r.baseUrl.replace(/\/+$/, ''), r.apiKey])).entries()]
  const results: Array<{ server: string; image: number | string; video: number | string }> = []
  for (const [base, key] of servers) {
    const call = async (kind: 'images' | 'video') => {
      try {
        const r = await fetch(joinProviderUrl(base, '/api/inference', `/${kind}/unload`), {
          method: 'POST', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(30_000),
        })
        return r.status
      } catch (err: any) {
        return err?.message || 'error'
      }
    }
    results.push({ server: new URL(base).host, image: await call('images'), video: await call('video') })
  }
  return results
}

// ---------- LLM: host script + comment replies ----------

export interface LiveProduct { name: string; details: string; price: string; promo: string; shop: string }

function cleanProduct(raw: any): LiveProduct {
  const s = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)
  const p = { name: s(raw?.name, 200), details: s(raw?.details, 3000), price: s(raw?.price, 100), promo: s(raw?.promo, 300), shop: s(raw?.shop, 120) }
  if (!p.name) throw new AppError('กรุณาใส่ชื่อสินค้า', 'E_LIVE_PRODUCT')
  return p
}

function particleFor(voice: string) {
  return /Niwat/i.test(voice) ? 'ครับ' : 'ค่ะ'
}

/** ดึง JSON object แรกจากข้อความ LLM (ทนต่อ code fence / ข้อความแทรก) */
export function parseJsonObject(text: string): any {
  const t = String(text || '').replace(/```(?:json)?/gi, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in reply')
  return JSON.parse(t.slice(start, end + 1))
}

async function runAgent(type: 'live_host' | 'live_responder', payload: unknown): Promise<string> {
  await getTextConfig() // ไม่มีโมเดลข้อความ → E_NO_TEXT_MODEL
  const agentImpl: any = mastra.getAgent(type)
  if (!agentImpl) throw new AppError(`${type} Agent ไม่พร้อมใช้งาน`, 'E_AGENT_UNAVAILABLE')
  const result: any = await agentImpl.generate([{ role: 'user', content: JSON.stringify(payload) }], { maxSteps: 1 })
  return String(result?.text || '')
}

export async function writeHostScript(input: { product?: unknown; tone?: unknown; minutes?: unknown; voice?: unknown }) {
  const product = cleanProduct(input.product)
  const voice = String(input.voice || readConfig().voice)
  const payload = {
    language: 'th',
    particle: particleFor(voice),
    product,
    tone: String(input.tone || 'สนุก เป็นกันเอง กระตือรือร้น').slice(0, 120),
    minutes: Math.min(10, Math.max(1, Number(input.minutes) || 2)),
  }
  let lines: string[] = []
  for (let attempt = 0; attempt < 2 && !lines.length; attempt++) {
    try {
      const parsed = parseJsonObject(await runAgent('live_host', payload))
      lines = (Array.isArray(parsed?.lines) ? parsed.lines : [])
        .map((l: unknown) => String(l ?? '').replace(/\s+/g, ' ').trim())
        .filter((l: string) => l.length > 0 && l.length <= 240)
        .slice(0, 30)
    } catch (err) {
      if (err instanceof AppError) throw err
    }
  }
  if (!lines.length) throw new AppError('AI เขียนสคริปต์ไม่สำเร็จ ลองอีกครั้ง', 'E_LIVE_SCRIPT')
  return { lines }
}

export async function answerComment(input: { comment?: unknown; viewer?: unknown; product?: unknown; faq?: unknown; voice?: unknown }) {
  const comment = String(input.comment || '').trim().slice(0, 500)
  if (!comment) throw new AppError('ไม่มีคอมเมนต์', 'E_LIVE_COMMENT')
  const product = cleanProduct(input.product)
  const voice = String(input.voice || readConfig().voice)
  const payload = {
    language: 'th',
    particle: particleFor(voice),
    comment,
    viewer: String(input.viewer || '').trim().slice(0, 60),
    product,
    faq: String(input.faq || '').trim().slice(0, 3000),
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const parsed = parseJsonObject(await runAgent('live_responder', payload))
      const reply = parsed?.reply == null ? null : String(parsed.reply).replace(/\s+/g, ' ').trim().slice(0, 300) || null
      return { reply, handoff: !!parsed?.handoff, reason: String(parsed?.reason || '').slice(0, 120) }
    } catch (err) {
      if (err instanceof AppError) throw err
    }
  }
  throw new AppError('AI ตอบคอมเมนต์ไม่สำเร็จ ลองอีกครั้ง', 'E_LIVE_ANSWER')
}
