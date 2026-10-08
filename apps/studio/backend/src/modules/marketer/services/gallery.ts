/**
 * Creative Gallery & Ad Analytics — docs/ai-marketer/GALLERY.md
 * รวม creative ที่ approved / in_production ทุกแคมเปญ + ผลตอบรับจริงที่ผู้ใช้กรอกเอง (manual analytics)
 * กฎตั้งใจ: ไม่ดึงข้อมูลจากแพลตฟอร์มทุกกรณี — ตัวเลขทั้งหมดเป็น Evidence ที่ผู้ใช้กรอกจากต้นทาง
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { ownedBy } from '../../../core/auth/owner-context.js'
import { db, schema } from '../../../core/db/index.js'
import { AppError, now } from '../../../core/http/response.js'

const GALLERY_STATUSES = ['approved', 'in_production']
const MAX_NOTE_LENGTH = 2000
const MAX_SALES_THB = 100_000_000

type CreativeResultRow = typeof schema.creativeResults.$inferSelect

function toResultJson(row: CreativeResultRow) {
  const interactions = (row.likes ?? 0) + (row.comments ?? 0) + (row.shares ?? 0)
  const engagementRate = row.views !== null && row.views > 0 && interactions > 0
    ? interactions / row.views
    : null
  return {
    views: row.views,
    likes: row.likes,
    comments: row.comments,
    shares: row.shares,
    salesThb: row.salesThb,
    postedUrl: row.postedUrl,
    postedAt: row.postedAt,
    note: row.note,
    engagementRate,
    updatedAt: row.updatedAt,
  }
}

export interface GalleryEntry {
  creativeId: number
  campaignId: number
  campaignTitle: string
  productName: string
  productImage: string | null
  /** drama ของแคมเปญ (produce ครั้งแรกจะสร้างและผูกไว้ — ใช้เข้าหน้า episode ตรง ๆ) */
  dramaId: number | null
  angle: string
  hook: string
  format: string
  platform: string
  durationSec: number
  status: string
  episodeId: number | null
  episodeNumber: number | null
  result: ReturnType<typeof toResultJson> | null
  createdAt: string
  updatedAt: string
}

export interface GallerySummary {
  total: number
  produced: number
  withResults: number
  totalViews: number
  totalLikes: number
  totalSalesThb: number
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export async function listGalleryEntries(): Promise<{ entries: GalleryEntry[]; summary: GallerySummary }> {
  const rows = await db.select({
    creative: schema.campaignCreatives,
    campaign: schema.campaigns,
    result: schema.creativeResults,
  })
    .from(schema.campaignCreatives)
    .innerJoin(schema.campaigns, eq(schema.campaignCreatives.campaignId, schema.campaigns.id))
    .leftJoin(schema.creativeResults, eq(schema.creativeResults.creativeId, schema.campaignCreatives.id))
    .where(and(inArray(schema.campaignCreatives.status, GALLERY_STATUSES), isNull(schema.campaigns.deletedAt), ownedBy(schema.campaigns.ownerUserId)))
    .orderBy(desc(schema.campaignCreatives.id))

  const entries: GalleryEntry[] = rows.map(({ creative, campaign, result }) => ({
    creativeId: creative.id,
    campaignId: campaign.id,
    campaignTitle: campaign.title,
    productName: campaign.productName,
    productImage: parseJsonArray(campaign.productImages)[0] ?? null,
    dramaId: campaign.dramaId,
    angle: creative.angle,
    hook: creative.hook,
    format: creative.format,
    platform: creative.platform,
    durationSec: creative.durationSec,
    status: creative.status,
    episodeId: creative.episodeId,
    episodeNumber: creative.episodeNumber,
    result: result ? toResultJson(result) : null,
    createdAt: creative.createdAt,
    updatedAt: creative.updatedAt,
  }))

  const summary: GallerySummary = {
    total: entries.length,
    produced: entries.filter(e => e.status === 'in_production').length,
    withResults: entries.filter(e => e.result).length,
    totalViews: entries.reduce((s, e) => s + (e.result?.views ?? 0), 0),
    totalLikes: entries.reduce((s, e) => s + (e.result?.likes ?? 0), 0),
    totalSalesThb: entries.reduce((s, e) => s + (e.result?.salesThb ?? 0), 0),
  }
  return { entries, summary }
}

// ---------- upsert ผลตอบรับ (1:1 ต่อ creative) ----------

/** เลขไม่ติดลบ (int) — คืน number หรือ null (ไม่กรอก) */
function parseCount(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === '') return null
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0) throw new AppError(`${field} ต้องเป็นจำนวนเต็ม ≥ 0`, 'E_INVALID_FIELD')
  return n
}

function parsePostedAt(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const s = String(value).trim()
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw new AppError('postedAt ต้องเป็นวันที่ที่อ่านได้', 'E_INVALID_FIELD')
  return d.toISOString()
}

function parsePostedUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null
  const url = String(value).trim()
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
  } catch {
    throw new AppError('postedUrl ต้องเป็น http/https', 'E_INVALID_FIELD')
  }
  return url
}

async function requireCreativeRow(creativeId: number) {
  const [row] = await db.select().from(schema.campaignCreatives)
    .where(eq(schema.campaignCreatives.id, creativeId))
  if (!row) throw new AppError(`creative #${creativeId} ไม่มีอยู่`, 'E_INVALID_FIELD')
  return row
}

export async function upsertCreativeResult(creativeId: number, body: any) {
  await requireCreativeRow(creativeId)
  const values: Partial<typeof schema.creativeResults.$inferInsert> = {}
  if (body.views !== undefined) values.views = parseCount(body.views, 'views')
  if (body.likes !== undefined) values.likes = parseCount(body.likes, 'likes')
  if (body.comments !== undefined) values.comments = parseCount(body.comments, 'comments')
  if (body.shares !== undefined) values.shares = parseCount(body.shares, 'shares')
  if (body.salesThb !== undefined) {
    if (body.salesThb === null || body.salesThb === '') values.salesThb = null
    else {
      const n = Number(body.salesThb)
      if (!Number.isFinite(n) || n < 0 || n > MAX_SALES_THB) throw new AppError(`salesThb ต้องเป็น 0–${MAX_SALES_THB}`, 'E_INVALID_FIELD')
      values.salesThb = Math.round(n * 100) / 100
    }
  }
  if (body.postedUrl !== undefined) values.postedUrl = parsePostedUrl(body.postedUrl)
  if (body.postedAt !== undefined) values.postedAt = parsePostedAt(body.postedAt)
  if (body.note !== undefined) {
    if (body.note === null || body.note === '') values.note = null
    else {
      if (typeof body.note !== 'string' || body.note.trim().length === 0) throw new AppError('note ต้องเป็นข้อความ', 'E_INVALID_FIELD')
      if (body.note.length > MAX_NOTE_LENGTH) throw new AppError(`note ยาวเกิน ${MAX_NOTE_LENGTH} ตัวอักษร`, 'E_INVALID_FIELD')
      values.note = body.note.trim()
    }
  }
  const ts = now()
  const [existing] = await db.select().from(schema.creativeResults)
    .where(eq(schema.creativeResults.creativeId, creativeId))
  if (existing) {
    await db.update(schema.creativeResults).set({ ...values, updatedAt: ts })
      .where(eq(schema.creativeResults.creativeId, creativeId))
  } else {
    await db.insert(schema.creativeResults).values({
      creativeId,
      ...values,
      createdAt: ts,
      updatedAt: ts,
    })
  }
  const [row] = await db.select().from(schema.creativeResults)
    .where(eq(schema.creativeResults.creativeId, creativeId))
  return toResultJson(row)
}

export async function deleteCreativeResult(creativeId: number): Promise<boolean> {
  const [row] = await db.select().from(schema.creativeResults)
    .where(eq(schema.creativeResults.creativeId, creativeId))
  if (!row) return false
  await db.delete(schema.creativeResults).where(eq(schema.creativeResults.creativeId, creativeId))
  return true
}

// ---------- วงจรเรียนรู้: ผลตอบรับ → research evidence ----------

/**
 * บล็อก Evidence สำหรับแนบใน message ของ startResearch (GALLERY.md §4)
 * คืน null เมื่อแคมเปญไม่มีผลตอบรับ — message เดิมต้องไม่เปลี่ยน
 */
export async function performanceEvidenceBlock(campaignId: number): Promise<string | null> {
  const rows = await db.select({ creative: schema.campaignCreatives, result: schema.creativeResults })
    .from(schema.creativeResults)
    .innerJoin(schema.campaignCreatives, eq(schema.creativeResults.creativeId, schema.campaignCreatives.id))
    .where(eq(schema.campaignCreatives.campaignId, campaignId))
  if (!rows.length) return null
  const lines = rows.map(({ creative, result }) => {
    const r = toResultJson(result)
    const parts = [
      r.views !== null ? `${r.views.toLocaleString('en-US')} views` : '',
      r.engagementRate !== null ? `engagement ${(r.engagementRate * 100).toFixed(1)}%` : '',
      r.salesThb !== null ? `ยอดขาย ${r.salesThb.toLocaleString('th-TH')} THB` : '',
      r.postedAt ? `โพสต์ ${r.postedAt.slice(0, 10)}` : '',
    ].filter(Boolean)
    return `- creative #${creative.id} (${creative.format} / ${creative.platform}): ${parts.join(' · ') || '(มีข้อมูลบางส่วน)'}`
  })
  return ['【ผลตอบรับจริงจากคลิปที่โพสต์แล้ว (Evidence — ผู้ใช้กรอกเองจากแพลตฟอร์มต้นทาง)】', ...lines].join('\n')
}
