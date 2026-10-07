/**
 * AI นักขาย (docs/ai-seller/PLAN.md) — โพสต์ขายสินค้า: สินค้า + รูป + ลิงก์ + วิดีโอ
 * → AI (seller_copywriter) เขียนแคปชั่น/แฮชแท็ก/คอมเมนต์ปักหมุดแยกตามช่องทาง → ผู้ใช้คัดลอก/ดาวน์โหลดไปโพสต์เอง
 * Phase 1 ไม่โพสต์อัตโนมัติ (ต้องเชื่อมบัญชีแพลตฟอร์ม — Phase 2)
 * ลิงก์สินค้าไม่ผ่าน LLM: backend ต่อท้ายคอมเมนต์เอง เพื่อไม่ให้ URL ถูกแต่ง/ตัดทอน
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { AppError, now } from '../utils/response.js'
import { getTextConfig } from './ai.js'
import { mastra } from '../mastra/index.js'
import { ingestUrl } from './marketer.js'
import { getProjectDetail, listProjects } from './studio.js'

export const SELLER_CHANNELS = ['tiktok', 'shopee', 'facebook', 'instagram'] as const
export type SellerChannel = typeof SELLER_CHANNELS[number]
export const SELLER_TONES = ['casual', 'fun', 'pro', 'urgent'] as const
export type SellerTone = typeof SELLER_TONES[number]
export const SELLER_LANGUAGES = ['th', 'en'] as const

const HASHTAG_LIMITS: Record<SellerChannel, number> = { tiktok: 5, shopee: 5, facebook: 3, instagram: 10 }
const MAX_IMAGES = 9

export interface SellerChannelContent { caption: string; hashtags: string[]; comment: string }
type PostRow = typeof schema.sellerPosts.$inferSelect

// ---------- helpers ----------

/** JSON object แรกจากข้อความ LLM (ทน code fence / ข้อความแทรก) */
function parseJsonObject(text: string): any {
  const t = String(text || '').replace(/```(?:json)?/gi, '')
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('no JSON object in reply')
  return JSON.parse(t.slice(start, end + 1))
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

function optStr(v: unknown, max: number): string | null {
  return str(v, max) || null
}

/** ลิงก์ต้องเป็น http(s) เท่านั้น (กัน javascript: ฯลฯ ที่ frontend เอาไปทำ <a href>) */
function optUrl(v: unknown, field: string): string | null {
  const s = str(v, 2000)
  if (!s) return null
  let u: URL
  try { u = new URL(s) } catch { throw new AppError(`${field} ไม่ใช่ลิงก์ที่ถูกต้อง`, 'E_INVALID_FIELD') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new AppError(`${field} ต้องขึ้นต้นด้วย http(s)://`, 'E_INVALID_FIELD')
  return u.toString()
}

/** ไฟล์ของเราเองเท่านั้น (/static/...) — รูป/วิดีโอมาจาก upload, ingest หรือ Studio */
function staticPath(v: unknown): string | null {
  const s = str(v, 1000)
  if (!s) return null
  const p = s.startsWith('/') ? s : `/${s}`
  if (!p.startsWith('/static/') || p.includes('..')) throw new AppError('ไฟล์ต้องอัปโหลดผ่านระบบ', 'E_INVALID_FIELD')
  return p
}

function cleanChannels(v: unknown): SellerChannel[] {
  if (!Array.isArray(v)) throw new AppError('channels ต้องเป็นอาร์เรย์', 'E_INVALID_FIELD')
  return SELLER_CHANNELS.filter(c => v.includes(c))
}

function cleanHashtag(v: unknown): string {
  return String(v ?? '').replace(/^#+/, '').replace(/[\s#,]+/g, '').slice(0, 60)
}

function cleanContent(raw: unknown, channels: readonly SellerChannel[]): Partial<Record<SellerChannel, SellerChannelContent>> {
  const out: Partial<Record<SellerChannel, SellerChannelContent>> = {}
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>
  for (const ch of channels) {
    const c = src[ch]
    if (!c || typeof c !== 'object') continue
    out[ch] = {
      caption: String(c.caption ?? '').trim().slice(0, 2200),
      hashtags: [...new Set((Array.isArray(c.hashtags) ? c.hashtags : []).map(cleanHashtag).filter(Boolean))].slice(0, 30) as string[],
      comment: String(c.comment ?? '').trim().slice(0, 1000),
    }
  }
  return out
}

/** ลิงก์ที่จะใส่ในคอมเมนต์: affiliate มาก่อน, ไม่มีใช้ลิงก์สินค้า */
export function postLink(row: Pick<PostRow, 'affiliateUrl' | 'productUrl'>): string | null {
  return row.affiliateUrl || row.productUrl || null
}

/** ข้อความพร้อมโพสต์ — caption + แฮชแท็ก, และคอมเมนต์ + ลิงก์ (frontend ปุ่มคัดลอกใช้ค่านี้) */
export function composeChannel(content: SellerChannelContent, link: string | null) {
  const tags = content.hashtags.map(h => `#${h}`).join(' ')
  const post = [content.caption, tags].filter(Boolean).join('\n\n')
  const comment = link && !content.comment.includes(link) ? [content.comment, link].filter(Boolean).join('\n') : content.comment
  return { post, comment }
}

export function toPostJson(row: PostRow) {
  const channels = parseJson<string[]>(row.channels, []).filter((c): c is SellerChannel => (SELLER_CHANNELS as readonly string[]).includes(c))
  const content = cleanContent(parseJson(row.content, {}), SELLER_CHANNELS)
  const link = postLink(row)
  return {
    id: row.id,
    title: row.title,
    productName: row.productName,
    productUrl: row.productUrl,
    productPrice: row.productPrice,
    productDescription: row.productDescription,
    productImages: parseJson<string[]>(row.productImages, []),
    affiliateUrl: row.affiliateUrl,
    videoUrl: row.videoUrl,
    studioProjectId: row.studioProjectId,
    channels,
    language: row.language,
    tone: row.tone,
    notes: row.notes,
    content,
    ready: Object.fromEntries(Object.entries(content).map(([ch, c]) => [ch, composeChannel(c!, link)])),
    status: row.status,
    errorMsg: row.errorMsg,
    generatedAt: row.generatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function getRow(id: number): Promise<PostRow | null> {
  const [row] = await db.select().from(schema.sellerPosts)
    .where(and(eq(schema.sellerPosts.id, id), isNull(schema.sellerPosts.deletedAt)))
  return row ?? null
}

// ---------- CRUD ----------

export function getSellerOptions() {
  return { channels: SELLER_CHANNELS, tones: SELLER_TONES, languages: SELLER_LANGUAGES, hashtagLimits: HASHTAG_LIMITS }
}

export async function listPosts() {
  const rows = await db.select().from(schema.sellerPosts)
    .where(isNull(schema.sellerPosts.deletedAt))
    .orderBy(desc(schema.sellerPosts.updatedAt))
  return rows.map(toPostJson)
}

export async function getPost(id: number) {
  const row = await getRow(id)
  return row ? toPostJson(row) : null
}

/** ฟิลด์ที่แก้ได้ — ใช้ทั้ง create และ update (ไม่ส่งฟิลด์ = ไม่แก้) */
function patchFrom(body: Record<string, unknown>) {
  const patch: Partial<typeof schema.sellerPosts.$inferInsert> = {}
  if ('title' in body) patch.title = str(body.title, 120)
  if ('productName' in body) patch.productName = str(body.productName, 200)
  if ('productUrl' in body) patch.productUrl = optUrl(body.productUrl, 'ลิงก์สินค้า')
  if ('productPrice' in body) patch.productPrice = optStr(body.productPrice, 60)
  if ('productDescription' in body) patch.productDescription = optStr(body.productDescription, 3000)
  if ('productImages' in body) {
    if (!Array.isArray(body.productImages)) throw new AppError('productImages ต้องเป็นอาร์เรย์', 'E_INVALID_FIELD')
    const imgs = body.productImages.map(staticPath).filter((p): p is string => !!p)
    patch.productImages = JSON.stringify([...new Set(imgs)].slice(0, MAX_IMAGES))
  }
  if ('affiliateUrl' in body) patch.affiliateUrl = optUrl(body.affiliateUrl, 'ลิงก์ affiliate')
  if ('videoUrl' in body) patch.videoUrl = staticPath(body.videoUrl)
  if ('studioProjectId' in body) {
    const n = Number(body.studioProjectId)
    patch.studioProjectId = body.studioProjectId == null || body.studioProjectId === '' ? null : (Number.isInteger(n) && n > 0 ? n : null)
  }
  if ('channels' in body) patch.channels = JSON.stringify(cleanChannels(body.channels))
  if ('language' in body) {
    if (!(SELLER_LANGUAGES as readonly unknown[]).includes(body.language)) throw new AppError('language ไม่รองรับ', 'E_INVALID_FIELD')
    patch.language = body.language as string
  }
  if ('tone' in body) {
    if (!(SELLER_TONES as readonly unknown[]).includes(body.tone)) throw new AppError('tone ไม่รองรับ', 'E_INVALID_FIELD')
    patch.tone = body.tone as string
  }
  if ('notes' in body) patch.notes = optStr(body.notes, 1000)
  if ('content' in body) patch.content = JSON.stringify(cleanContent(body.content, SELLER_CHANNELS))
  return patch
}

export async function createPost(body: Record<string, unknown>) {
  const patch = patchFrom(body)
  if (!patch.productName && !patch.productUrl) throw new AppError('ใส่ชื่อสินค้าหรือลิงก์สินค้าอย่างน้อยหนึ่งอย่าง', 'E_SELLER_NEEDS_PRODUCT')
  const ts = now()
  const res = await db.insert(schema.sellerPosts).values({
    channels: JSON.stringify(SELLER_CHANNELS),
    ...patch,
    title: patch.title || patch.productName || '',
    createdAt: ts,
    updatedAt: ts,
  })
  return getPost(getInsertId(res))
}

export async function updatePost(id: number, body: Record<string, unknown>) {
  if (!await getRow(id)) return null
  const patch = patchFrom(body)
  await db.update(schema.sellerPosts).set({ ...patch, updatedAt: now() }).where(eq(schema.sellerPosts.id, id))
  return getPost(id)
}

export async function deletePost(id: number) {
  if (!await getRow(id)) return false
  await db.update(schema.sellerPosts).set({ deletedAt: now() }).where(eq(schema.sellerPosts.id, id))
  return true
}

// ---------- sources ----------

/** ดึงข้อมูลสินค้าจากลิงก์ (SSRF-safe ingest เดียวกับ Marketer/Studio) */
export async function ingestSellerUrl(url: string) {
  return ingestUrl(url)
}

/** วิดีโอที่ทำเสร็จแล้วใน Product Studio — ให้เลือกมาโพสต์ได้เลย (merge ล่าสุดที่ completed) */
export async function listStudioVideos() {
  const projects = await listProjects()
  const out = []
  for (const p of projects.filter(p => p.episodeId)) {
    const detail = await getProjectDetail(p.id)
    const merge = detail?.latestMerge
    if (merge?.status !== 'completed' || !merge.videoUrl) continue
    out.push({
      projectId: p.id,
      title: p.title,
      productName: p.productName,
      productUrl: p.productUrl,
      productDescription: p.productDescription,
      productImages: p.productImages,
      videoUrl: merge.videoUrl,
      createdAt: merge.createdAt,
    })
  }
  return out
}

// ---------- AI copy ----------

/** เขียนแคปชั่น/แฮชแท็ก/คอมเมนต์ให้ทุกช่องทางที่เลือก (sync ~10-30s, ลองซ้ำ 1 ครั้งถ้า JSON เสีย) */
export async function generateCopy(id: number, body: { channels?: unknown; tone?: unknown; language?: unknown; notes?: unknown } = {}) {
  let row = await getRow(id)
  if (!row) return null
  const settings: Record<string, unknown> = {}
  for (const k of ['channels', 'tone', 'language', 'notes'] as const) if (k in body) settings[k] = body[k]
  if (Object.keys(settings).length) {
    await db.update(schema.sellerPosts).set({ ...patchFrom(settings), updatedAt: now() }).where(eq(schema.sellerPosts.id, id))
    row = (await getRow(id))!
  }
  const channels = toPostJson(row).channels
  if (!channels.length) throw new AppError('เลือกช่องทางโพสต์อย่างน้อย 1 ช่องทาง', 'E_SELLER_NO_CHANNEL')
  if (!row.productName.trim()) throw new AppError('ใส่ชื่อสินค้าก่อนให้ AI เขียนแคปชั่น', 'E_SELLER_NEEDS_PRODUCT')

  await getTextConfig() // ไม่มีโมเดลข้อความ → E_NO_TEXT_MODEL
  const agent: any = mastra.getAgent('seller_copywriter')
  if (!agent) throw new AppError('seller_copywriter Agent ไม่พร้อมใช้งาน', 'E_AGENT_UNAVAILABLE')
  const payload = {
    language: row.language,
    tone: row.tone,
    channels,
    product: { name: row.productName, price: row.productPrice || null, details: row.productDescription || '' },
    hasLink: !!postLink(row),
    notes: row.notes || '',
  }

  let content: Partial<Record<SellerChannel, SellerChannelContent>> = {}
  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result: any = await agent.generate([{ role: 'user', content: JSON.stringify(payload) }], { maxSteps: 1 })
      const parsed = parseJsonObject(String(result?.text || ''))
      content = cleanContent(parsed?.channels, channels)
      for (const ch of channels) {
        const c = content[ch]
        if (c) c.hashtags = c.hashtags.slice(0, HASHTAG_LIMITS[ch])
      }
      if (channels.every(ch => content[ch]?.caption)) break
      lastError = 'AI ตอบไม่ครบทุกช่องทาง'
    } catch (err: any) {
      if (err instanceof AppError) throw err
      lastError = err?.message || String(err)
    }
  }
  if (!channels.some(ch => content[ch]?.caption)) {
    await db.update(schema.sellerPosts).set({ status: 'failed', errorMsg: lastError.slice(0, 500), updatedAt: now() }).where(eq(schema.sellerPosts.id, id))
    throw new AppError('AI เขียนแคปชั่นไม่สำเร็จ ลองอีกครั้ง', 'E_SELLER_COPY')
  }
  // ช่องทางที่ไม่ได้เลือกรอบนี้เก็บของเดิมไว้ (ผู้ใช้อาจแก้มือไว้แล้ว)
  const merged = { ...cleanContent(parseJson(row.content, {}), SELLER_CHANNELS), ...content }
  const ts = now()
  await db.update(schema.sellerPosts).set({
    content: JSON.stringify(merged), status: 'ready', errorMsg: null, generatedAt: ts, updatedAt: ts,
  }).where(eq(schema.sellerPosts.id, id))
  return getPost(id)
}
