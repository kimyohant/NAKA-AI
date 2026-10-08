/**
 * AI นักขาย (docs/ai-seller/PLAN.md) — โพสต์ขายสินค้า: สินค้า + รูป + ลิงก์ + วิดีโอ
 * → AI (seller_copywriter) เขียนแคปชั่น/แฮชแท็ก/คอมเมนต์ปักหมุดแยกตามช่องทาง → ผู้ใช้คัดลอก/ดาวน์โหลดไปโพสต์เอง
 * Phase 1 ไม่โพสต์อัตโนมัติ (ต้องเชื่อมบัญชีแพลตฟอร์ม — Phase 2)
 * ลิงก์สินค้าไม่ผ่าน LLM: backend ต่อท้ายคอมเมนต์เอง เพื่อไม่ให้ URL ถูกแต่ง/ตัดทอน
 * v19 คลังสกิล × AI นักขาย: makeVideo สร้างโปรเจกต์ Studio จากสินค้าของโพสต์ + สกิล (เทมเพลต) → เขียนบท
 * → auto-render → แนบวิดีโอที่รวมเสร็จเข้าโพสต์เอง (driveVideo วนเช็กทุก 5s + getPost sync ซ้ำ กันหลุดหลัง restart)
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ownedBy, ownerScope, runAsOwner } from '../../../core/auth/owner-context.js'
import { db, insertedId, schema } from '../../../core/db/index.js'
import { AppError, now } from '../../../core/http/response.js'
import { getActiveConfig, getTextConfig } from '../../../core/ai/ai.js'
import { mastra } from '../../../core/mastra/index.js'
import { ingestUrl } from '../../marketer/index.js'
import {
  createProject, deleteProject, getProjectDetail, getProjectRow, listProjects, parseAutoRender, startStudioScript,
  cancelAutoRender, startAutoRender, getStudioTemplate, type StudioPlatform,
} from '../../product-studio/index.js'
import { logTaskError } from '../../../core/tasks/task-logger.js'

export const SELLER_CHANNELS = ['tiktok', 'shopee', 'facebook', 'instagram'] as const
export type SellerChannel = typeof SELLER_CHANNELS[number]
export const SELLER_TONES = ['casual', 'fun', 'pro', 'urgent'] as const
export type SellerTone = typeof SELLER_TONES[number]
export const SELLER_LANGUAGES = ['th', 'en'] as const

const HASHTAG_LIMITS: Record<SellerChannel, number> = { tiktok: 5, shopee: 5, facebook: 3, instagram: 10 }
/** ช่องทางแรกที่เลือก → แพลตฟอร์มของโปรเจกต์ Studio (กำหนดสัดส่วน/ความยาวสูงสุด) */
const CHANNEL_PLATFORM: Record<SellerChannel, StudioPlatform> = { tiktok: 'tiktok', shopee: 'shopee', facebook: 'facebook', instagram: 'instagram_reels' }
const DRIVE_POLL_MS = 5_000
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
    .where(and(isNull(schema.sellerPosts.deletedAt), ownedBy(schema.sellerPosts.ownerUserId)))
    .orderBy(desc(schema.sellerPosts.updatedAt))
  return Promise.all(rows.map(withVideoJob))
}

export async function getPost(id: number) {
  const row = await getRow(id)
  return row ? withVideoJob(await syncVideo(row)) : null
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
  }).returning({ id: schema.sellerPosts.id })
  return getPost(insertedId(res))
}

export async function updatePost(id: number, body: Record<string, unknown>) {
  const row = await getRow(id)
  if (!row) return null
  const patch = patchFrom(body)
  // ผู้ใช้เลือก/อัปโหลดวิดีโออื่นระหว่างที่ระบบกำลังทำวิดีโอจากสกิล → เลิกแนบผลของงานนั้น
  if ('videoUrl' in body && patch.videoUrl !== row.videoUrl) Object.assign(patch, { videoAuto: false, videoError: null })
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

// ---------- คลังสกิล → วิดีโอ (v19) ----------

export type SellerVideoStage = 'scripting' | 'keyframes' | 'videos' | 'merging' | 'done' | 'failed' | 'cancelled'

async function setVideo(id: number, patch: Partial<typeof schema.sellerPosts.$inferInsert>): Promise<PostRow> {
  await db.update(schema.sellerPosts).set({ ...patch, updatedAt: now() }).where(eq(schema.sellerPosts.id, id))
  return (await getRow(id))!
}

/** วิดีโอที่รวมเสร็จล่าสุดของโปรเจกต์ Studio (null = ยังไม่มี) */
async function mergedVideoUrl(projectId: number): Promise<string | null> {
  const merge = (await getProjectDetail(projectId))?.latestMerge
  return merge?.status === 'completed' && merge.videoUrl ? merge.videoUrl : null
}

/**
 * พางานทำวิดีโอเดินต่อหนึ่งก้าว (idempotent — เรียกซ้ำได้จาก driver และ getPost)
 * script_ready → เริ่ม auto-render · done → แนบวิดีโอ · failed/cancelled/ลบ → หยุดพร้อม video_error
 */
export async function syncVideo(row: PostRow): Promise<PostRow> {
  if (!row.videoAuto || !row.studioProjectId) return row
  const project = await getProjectRow(row.studioProjectId)
  if (!project) return setVideo(row.id, { videoAuto: false, videoError: 'E_SELLER_VIDEO_GONE: โปรเจกต์วิดีโอถูกลบ' })
  if (project.status === 'failed') {
    return setVideo(row.id, { videoAuto: false, videoError: project.errorMsg || 'E_SELLER_VIDEO_FAILED: เขียนบทไม่สำเร็จ' })
  }
  if (project.status === 'scripting') return row
  const state = parseAutoRender(project.autoRender)
  if (state.stage === 'idle') {
    if (project.status !== 'script_ready') return row
    try {
      await startAutoRender(project.id)
    } catch (err: any) {
      if (err?.errorCode === 'E_STUDIO_BUSY') return row // driver กับ getPost ชนกัน — อีกตัวเริ่มไปแล้ว
      const msg = err?.errorCode ? `${err.errorCode}: ${err.message}` : (err?.message || 'auto-render failed')
      return setVideo(row.id, { videoAuto: false, videoError: msg })
    }
    return row
  }
  if (state.stage === 'done') {
    const url = await mergedVideoUrl(project.id)
    return setVideo(row.id, url
      ? { videoAuto: false, videoUrl: url, videoError: null }
      : { videoAuto: false, videoError: 'E_STUDIO_NO_VIDEOS: ไม่พบวิดีโอที่รวมเสร็จ' })
  }
  if (state.stage === 'failed' || state.stage === 'cancelled') {
    return setVideo(row.id, { videoAuto: false, videoError: state.errorMsg || `E_SELLER_VIDEO_FAILED: ${state.stage}` })
  }
  return row
}

/** สถานะงานวิดีโอสำหรับ UI (null = โพสต์ไม่ได้ทำวิดีโอจากสกิล) */
async function videoJobOf(row: PostRow) {
  if (!row.studioProjectId || !row.videoTemplateId) return null
  const project = await getProjectRow(row.studioProjectId)
  const state = project ? parseAutoRender(project.autoRender) : null
  let stage: SellerVideoStage
  if (row.videoAuto) {
    stage = !project || project.status === 'scripting' || !state || state.stage === 'idle' ? 'scripting'
      : (['keyframes', 'videos', 'merging'].includes(state.stage) ? state.stage : 'merging') as SellerVideoStage
  } else if (row.videoError) {
    stage = state?.stage === 'cancelled' || row.videoError.startsWith('E_SELLER_VIDEO_CANCELLED') ? 'cancelled' : 'failed'
  } else {
    stage = 'done'
  }
  return {
    projectId: row.studioProjectId,
    templateId: row.videoTemplateId,
    running: !!row.videoAuto,
    stage,
    done: state && row.videoAuto ? state.done : 0,
    failed: state && row.videoAuto ? state.failed : 0,
    total: state && row.videoAuto ? state.total : 0,
    error: row.videoError,
  }
}

async function withVideoJob(row: PostRow) {
  return { ...toPostJson(row), videoJob: await videoJobOf(row) }
}

const drivers = new Set<number>()

/** วนพางานจนจบ (fire-and-forget) — ตัวเดียวต่อโพสต์ */
export async function driveVideo(postId: number, pollMs = DRIVE_POLL_MS): Promise<void> {
  if (drivers.has(postId)) return
  drivers.add(postId)
  try {
    for (;;) {
      const row = await getRow(postId)
      if (!row?.videoAuto) return
      if (!(await syncVideo(row)).videoAuto) return
      await new Promise(r => setTimeout(r, pollMs))
    }
  } catch (err: any) {
    logTaskError('Seller', 'video-driver', { postId, error: err?.message || String(err) })
  } finally {
    drivers.delete(postId)
  }
}

/** boot: โพสต์ที่ยังรอวิดีโออยู่ → วน driver ต่อ (auto-render ของ Studio resume เองแล้ว) */
export async function resumeSellerVideos(): Promise<number> {
  const rows = await db.select().from(schema.sellerPosts)
    .where(and(eq(schema.sellerPosts.videoAuto, true), isNull(schema.sellerPosts.deletedAt)))
  let resumed = 0
  for (const row of rows) {
    // makeVideo claimed it but stopped before linking a project (server restart) → release it
    if (!row.studioProjectId) {
      await setVideo(row.id, { videoAuto: false, videoError: 'E_TASK_INTERRUPTED: เซิร์ฟเวอร์รีสตาร์ทระหว่างสร้างวิดีโอ — กดทำวิดีโอใหม่' })
      continue
    }
    void driveVideo(row.id)
    resumed++
  }
  return resumed
}

/**
 * ทำวิดีโอจากสกิล: ใช้ข้อมูลสินค้าของโพสต์สร้างโปรเจกต์ Studio (เทมเพลต = สกิล) แล้วเริ่มเขียนบททันที
 * guard ก่อนเสียเงิน: ต้องมีชื่อสินค้า + โมเดลข้อความ/รูป/วิดีโอครบ + presenter ถ้าสกิลต้องใช้ (E_AVATAR_REQUIRED)
 */
export async function makeVideo(id: number, body: { templateId?: unknown; avatarId?: unknown; influencerId?: unknown } = {}) {
  const row = await getRow(id)
  if (!row) return null
  if (row.videoAuto) throw new AppError('กำลังทำวิดีโออยู่ — รอให้เสร็จหรือกดหยุดก่อน', 'E_SELLER_VIDEO_BUSY')
  const template = getStudioTemplate(typeof body.templateId === 'string' ? body.templateId : '')
  if (!template) throw new AppError(`ไม่รู้จักสกิล: ${String(body.templateId ?? '')}`, 'E_TEMPLATE_UNKNOWN')
  if (!row.productName.trim()) throw new AppError('ใส่ชื่อสินค้าก่อนทำวิดีโอ', 'E_SELLER_NEEDS_PRODUCT')
  const [text, image, video] = await Promise.all([getActiveConfig('text'), getActiveConfig('image'), getActiveConfig('video')])
  if (!text) throw new AppError('未配置文本模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_TEXT_MODEL')
  if (!image) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')
  if (!video) throw new AppError('未配置视频模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_VIDEO_MODEL')

  // claim the post in one statement: of two clicks at once only one passes (each would otherwise create
  // and script its own Studio project). No project link while it is being made, so syncVideo leaves it be.
  const [claimed] = await db.update(schema.sellerPosts)
    .set({ videoAuto: true, studioProjectId: null, videoError: null, updatedAt: now() })
    .where(and(eq(schema.sellerPosts.id, id), eq(schema.sellerPosts.videoAuto, false), isNull(schema.sellerPosts.deletedAt)))
    .returning({ id: schema.sellerPosts.id })
  if (!claimed) throw new AppError('กำลังทำวิดีโออยู่ — รอให้เสร็จหรือกดหยุดก่อน', 'E_SELLER_VIDEO_BUSY')
  const release = () => setVideo(id, { videoAuto: false, studioProjectId: row.studioProjectId, videoError: row.videoError })

  const post = toPostJson(row)
  const optionalId = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : Number(v))
  let project: Awaited<ReturnType<typeof createProject>>
  try {
    // the Studio project belongs to the post's member (also when an admin starts it for them)
    project = await runAsOwner({ ownerId: row.ownerUserId, admin: ownerScope()?.admin ?? true }, () => createProject({
      title: row.title || row.productName,
      productName: row.productName,
      productUrl: row.productUrl,
      productDescription: [row.productDescription, row.productPrice ? `Price: ${row.productPrice}` : ''].filter(Boolean).join('\n') || undefined,
      productImages: post.productImages,
      templateId: template.id,
      platform: CHANNEL_PLATFORM[post.channels[0] ?? 'tiktok'],
      language: row.language,
      market: row.language === 'th' ? 'TH' : 'GLOBAL',
      avatarId: optionalId(body.avatarId),
      influencerId: optionalId(body.influencerId),
      notes: row.notes || undefined,
    }))
  } catch (err) {
    await release()
    throw err
  }
  if (!project) {
    await release()
    throw new AppError('สร้างโปรเจกต์วิดีโอไม่สำเร็จ', 'E_SELLER_VIDEO_FAILED')
  }
  try {
    await startStudioScript(project.id)
  } catch (err) {
    await deleteProject(project.id) // ไม่ทิ้งโปรเจกต์ค้าง เช่น สกิลต้องมี presenter แต่ไม่ได้เลือก
    await release()
    throw err
  }
  await setVideo(id, { studioProjectId: project.id, videoUrl: null, videoTemplateId: template.id, videoAuto: true, videoError: null })
  void driveVideo(id)
  return getPost(id)
}

/** หยุดทำวิดีโอ: ยกเลิก auto-render (งานที่ส่งแล้วปล่อยจบเอง) และเลิกรอแนบ */
export async function stopVideo(id: number) {
  const row = await getRow(id)
  if (!row) return null
  if (row.videoAuto && row.studioProjectId) await cancelAutoRender(row.studioProjectId)
  await setVideo(id, { videoAuto: false, videoError: row.videoAuto ? 'E_SELLER_VIDEO_CANCELLED: หยุดโดยผู้ใช้' : row.videoError })
  return getPost(id)
}
