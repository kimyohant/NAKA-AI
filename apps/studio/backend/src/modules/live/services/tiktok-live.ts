/**
 * AI Live × TikTok LIVE — อ่านคอมเมนต์ ของขวัญ ผู้ติดตาม และคนเข้าห้องจากไลฟ์ TikTok แบบเรียลไทม์ (docs/ai-live/PLAN.md §TikTok)
 *
 * ใช้ไลบรารี tiktok-live-connector (ไม่เป็นทางการ; ไลเซนส์ AGPL-3.0; เชื่อมผ่าน sign server ของ Euler Stream)
 * แยกไว้ในไฟล์นี้ไฟล์เดียว (import เฉพาะที่นี่) เพื่อถอด/เปลี่ยนได้ง่าย
 * - อ่านอย่างเดียว ไม่ล็อกอิน ช่องต้องกำลังไลฟ์อยู่
 * - เหตุการณ์เก็บใน ring buffer ในหน่วยความจำ (ไม่ลง DB) แล้ว frontend poll GET /live/tiktok/events?after=<id>
 * - ไม่ reconnect เอง (เลี่ยง rate limit ของ sign server) — หลุดแล้ว status = 'disconnected' ให้ผู้ใช้กดเชื่อมใหม่
 */
import { ControlEvent, TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector'
import { AppError } from '../../../core/http/response.js'

export type TikTokEventKind = 'chat' | 'gift' | 'follow' | 'share' | 'member' | 'system'
export interface TikTokUser { uniqueId: string; nickname: string }
export interface TikTokEvent {
  id: number
  at: number
  kind: TikTokEventKind
  user?: TikTokUser
  text?: string
  gift?: { name: string; count: number; diamonds: number }
}
export type TikTokStatus = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'ended' | 'error'

/** สิ่งที่ service ต้องใช้จาก connection — ทำให้ test ใส่ connection ปลอมได้ */
export interface TikTokConnectionLike {
  on(event: string, handler: (...args: any[]) => void): unknown
  connect(): Promise<unknown>
  disconnect(): Promise<unknown> | void
}
type ConnectionFactory = (uniqueId: string, options: Record<string, unknown>) => TikTokConnectionLike

let createConnection: ConnectionFactory = (uniqueId, options) => new TikTokLiveConnection(uniqueId, options as any) as unknown as TikTokConnectionLike
/** tests only */
export function __setConnectionFactory(f: ConnectionFactory | null) {
  createConnection = f || ((u, o) => new TikTokLiveConnection(u, o as any) as unknown as TikTokConnectionLike)
}

const MAX_EVENTS = 300
const USERNAME_RE = /^[A-Za-z0-9._]{2,24}$/

const state = {
  conn: null as TikTokConnectionLike | null,
  generation: 0,
  username: '',
  status: 'idle' as TikTokStatus,
  error: '',
  connectedAt: 0,
  viewers: 0,
  totalLikes: 0,
  events: [] as TikTokEvent[],
  nextId: 1,
}

function push(e: Omit<TikTokEvent, 'id' | 'at'>) {
  state.events.push({ id: state.nextId++, at: Date.now(), ...e })
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
}

function userOf(raw: any): TikTokUser | undefined {
  if (!raw) return undefined
  const uniqueId = String(raw.uniqueId || '').slice(0, 40)
  const nickname = String(raw.nickname || uniqueId).slice(0, 60)
  return uniqueId || nickname ? { uniqueId, nickname } : undefined
}

export function normalizeUsername(input: unknown): string {
  const u = String(input || '').trim().replace(/^@/, '').replace(/^https?:\/\/(www\.)?tiktok\.com\/@/i, '').replace(/[/?#].*$/, '')
  if (!USERNAME_RE.test(u)) throw new AppError('ชื่อช่อง TikTok ไม่ถูกต้อง (เช่น @nakashop)', 'E_TIKTOK_USERNAME')
  return u
}

function friendlyError(err: any): string {
  const name = String(err?.name || err?.constructor?.name || '')
  const msg = String(err?.message || err || '')
  if (/UserOffline/i.test(name) || /offline|not.*live|isn't online/i.test(msg)) return 'ช่องนี้ยังไม่ได้ไลฟ์อยู่ เริ่มไลฟ์ใน TikTok ก่อนแล้วกดเชื่อมใหม่'
  if (/rate.?limit|429/i.test(msg)) return 'sign server จำกัดจำนวนครั้ง รอสักครู่หรือใส่ Euler Stream API key'
  return msg.slice(0, 200) || 'เชื่อมต่อ TikTok ไม่สำเร็จ'
}

function attach(conn: TikTokConnectionLike, gen: number) {
  // ignore late events from an old connection after reconnect/disconnect
  const live = (fn: (...a: any[]) => void) => (...a: any[]) => { if (gen === state.generation) fn(...a) }
  conn.on(WebcastEvent.CHAT, live((d: any) => {
    const text = String(d?.comment || '').trim()
    if (text) push({ kind: 'chat', user: userOf(d?.user), text: text.slice(0, 300) })
  }))
  conn.on(WebcastEvent.GIFT, live((d: any) => {
    const details = d?.giftDetails || {}
    // streakable gifts (giftType 1) fire on every tap; report once when the streak ends
    if (Number(details.giftType) === 1 && !d?.repeatEnd) return
    push({ kind: 'gift', user: userOf(d?.user), gift: { name: String(details.giftName || 'ของขวัญ').slice(0, 60), count: Number(d?.repeatCount) || 1, diamonds: Number(details.diamondCount) || 0 } })
  }))
  conn.on(WebcastEvent.FOLLOW, live((d: any) => push({ kind: 'follow', user: userOf(d?.user) })))
  conn.on(WebcastEvent.SHARE, live((d: any) => push({ kind: 'share', user: userOf(d?.user) })))
  conn.on(WebcastEvent.MEMBER, live((d: any) => push({ kind: 'member', user: userOf(d?.user) })))
  conn.on(WebcastEvent.LIKE, live((d: any) => { state.totalLikes = Number(d?.totalLikeCount) || state.totalLikes }))
  conn.on(WebcastEvent.ROOM_USER, live((d: any) => { state.viewers = Number(d?.viewerCount) || 0 }))
  conn.on(WebcastEvent.STREAM_END, live(() => {
    state.status = 'ended'
    push({ kind: 'system', text: 'ไลฟ์ TikTok จบแล้ว' })
  }))
  conn.on(ControlEvent.DISCONNECTED, live(() => {
    if (state.status === 'connected') {
      state.status = 'disconnected'
      push({ kind: 'system', text: 'หลุดการเชื่อมต่อ TikTok' })
    }
  }))
  conn.on(ControlEvent.ERROR, live((err: any) => { state.error = friendlyError(err) }))
}

export async function connectTikTok(input: { username: unknown; signApiKey?: string }) {
  const username = normalizeUsername(input.username)
  await disconnectTikTok()
  const gen = ++state.generation
  Object.assign(state, { username, status: 'connecting', error: '', viewers: 0, totalLikes: 0, connectedAt: 0 })
  const conn = createConnection(username, {
    processInitialData: false,
    enableExtendedGiftInfo: false,
    ...(input.signApiKey ? { signApiKey: input.signApiKey } : {}),
  })
  state.conn = conn
  attach(conn, gen)
  try {
    await Promise.race([
      conn.connect(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout: TikTok ไม่ตอบใน 30 วินาที')), 30_000)),
    ])
  } catch (err) {
    if (gen === state.generation) {
      state.status = 'error'
      state.error = friendlyError(err)
      state.conn = null
      try { await conn.disconnect() } catch { /* already closed */ }
    }
    throw new AppError(friendlyError(err), 'E_TIKTOK_CONNECT')
  }
  if (gen === state.generation) {
    state.status = 'connected'
    state.connectedAt = Date.now()
    push({ kind: 'system', text: `เชื่อมกับไลฟ์ @${username} แล้ว` })
  }
  return tiktokStatus()
}

export async function disconnectTikTok() {
  const conn = state.conn
  state.generation++
  state.conn = null
  if (state.status === 'connected' || state.status === 'connecting') state.status = 'idle'
  if (conn) {
    try { await conn.disconnect() } catch { /* already closed */ }
  }
  return tiktokStatus()
}

export function tiktokStatus() {
  return {
    status: state.status,
    username: state.username,
    error: state.error,
    connectedAt: state.connectedAt || null,
    viewers: state.viewers,
    totalLikes: state.totalLikes,
    lastEventId: state.nextId - 1,
  }
}

/** events newer than `after` (frontend keeps the last id it has seen) */
export function tiktokEvents(after: unknown) {
  const since = Math.max(0, Number(after) || 0)
  return { ...tiktokStatus(), events: state.events.filter(e => e.id > since) }
}
