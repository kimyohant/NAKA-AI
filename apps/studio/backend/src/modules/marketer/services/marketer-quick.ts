/**
 * AI Marketer — Quick start (TopView "Popular Ways to Get Started" ฉบับ NAKA-AI, ย้ายมาจาก naka-ai studio 05)
 *
 * - คลังแม่แบบ 12 แบบ (4 กลุ่ม) + "ผู้เชี่ยวชาญ" ตามแพลตฟอร์มไทย + หมวดสินค้า — ใช้ทั้งหน้าบ้านและ prompt
 * - Quick insight: สั่งงานวิเคราะห์ครั้งเดียว → agent `marketing_insight` เขียนรายงาน markdown (async 202 + poll)
 *   ใช้คลังคลิปมาแรงไทย (services/trending.ts) เป็น Evidence ในหมวดที่เลือก
 * - บันทึกที่ `marketer_insights` (migrations/pg/0003, per-member); boot → failStaleInsights() ปิดงานที่ค้างจาก restart
 */
import { desc, eq } from 'drizzle-orm'
import { db, insertedId, schema } from '../../../core/db/index.js'
import { ownedBy } from '../../../core/auth/owner-context.js'
import { AppError, now } from '../../../core/http/response.js'
import { getTextConfig } from '../../../core/ai/ai.js'
import { mastra } from '../../../core/mastra/index.js'
import { startTask, updateTask } from '../../../core/tasks/pipeline-tasks.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../../../core/tasks/task-logger.js'
import { listTrendVideos, type TrendIndustry } from './trending.js'

export const QUICK_GROUPS = ['market', 'listing', 'content', 'ads'] as const
export type QuickGroup = typeof QUICK_GROUPS[number]

/** หมวดสินค้า (ใกล้เคียง TikTok Shop ไทย) → industry ของคลังเทรนด์ ใช้ดึง Evidence */
export const QUICK_CATEGORIES = {
  beauty: 'beauty', health: 'health', fashion: 'fashion', food: 'food', home: 'home', kitchen: 'home',
  mom_baby: 'other', electronics: 'gadgets', appliances: 'gadgets', sports: 'other', auto: 'other', pets: 'pets', toys: 'other', other: 'other',
} as const satisfies Record<string, TrendIndustry>
export type QuickCategory = keyof typeof QUICK_CATEGORIES

/** ผู้เชี่ยวชาญที่ agent สวมบท — label อยู่ที่ i18n `marketer.quick.experts.*` */
export const QUICK_EXPERTS = {
  general: 'A generalist e-commerce marketer for Thailand: compare channels and recommend where this product should sell.',
  tiktok_shop: 'TikTok Shop Thailand expert: short vertical videos, the yellow basket, live selling, affiliate creators, GMV Max.',
  shopee: 'Shopee Thailand expert: search-friendly titles, cover images, shop vouchers, double-date campaigns, Shopee Live, Shopee Ads.',
  lazada: 'Lazada Thailand expert: LazMall, store pages, product titles, campaigns, Sponsored Discovery, LazLive.',
  facebook: 'Facebook & Instagram expert for Thai sellers: pages, groups, Reels, Meta Ads (Advantage+), closing sales in chat.',
  line_oa: 'LINE OA expert: broadcasts, rich menus, coupons, retention and repeat purchase.',
} as const
export type QuickExpert = keyof typeof QUICK_EXPERTS

export interface QuickTemplate { id: string; group: QuickGroup; icon: 'chart' | 'search' | 'doc' | 'chat' | 'video' | 'money' | 'calendar'; prompt: string }

/** prompt ภาษาไทย — [วงเล็บเหลี่ยม] คือช่องที่ผู้ใช้เติม; ชื่อแม่แบบอยู่ที่ i18n `marketer.quick.templates.<id>` */
export const QUICK_TEMPLATES: readonly QuickTemplate[] = [
  { id: 'category_opportunity', group: 'market', icon: 'chart',
    prompt: 'วิเคราะห์โอกาสของหมวด [หมวดสินค้า] ในตลาดออนไลน์ไทย ช่วงราคาที่ขายดี กลุ่มลูกค้าหลัก ช่องว่างที่ร้านเล็กเข้าไปได้ และสินค้าแบบไหนที่ควรเริ่มก่อน' },
  { id: 'trending_products', group: 'market', icon: 'chart',
    prompt: 'จากคลิปมาแรงในหมวด [หมวดสินค้า] บอกว่าสินค้าและมุมขายแบบไหนกำลังได้ผลบน TikTok Shop และ Shopee ไทย และร้านของฉันที่ขาย [สินค้าของคุณ] ควรหยิบอะไรมาใช้' },
  { id: 'competitor_scan', group: 'market', icon: 'search',
    prompt: 'เปรียบเทียบสินค้า [สินค้าของคุณ] ราคา [ราคา] บาท กับคู่แข่ง [ชื่อร้านหรือสินค้าคู่แข่ง พร้อมราคา] หาจุดที่เราชนะ จุดที่ต้องแก้ และข้อความขายที่ทำให้ลูกค้าเลือกเรา' },
  { id: 'pricing_strategy', group: 'market', icon: 'money',
    prompt: 'ช่วยวางราคาเปิดตัวสินค้า [สินค้าของคุณ] ต้นทุน [ต้นทุน] บาท คู่แข่งขายราคา [ช่วงราคา] บาท วางราคาปกติ ราคาโปรเปิดตัว ราคาแคมเปญเลขเบิ้ล และชุดสินค้า (bundle) ที่ยังมีกำไร' },
  { id: 'title_optimization', group: 'listing', icon: 'doc',
    prompt: 'ปรับชื่อสินค้า [ชื่อสินค้าตอนนี้] สำหรับ [Shopee / Lazada / TikTok Shop] ให้ติดคำค้นภาษาไทยที่คนพิมพ์จริง พร้อมคำอธิบายสินค้าและคำค้นที่ควรใส่' },
  { id: 'review_insights', group: 'listing', icon: 'chat',
    prompt: 'สรุปรีวิวลูกค้าต่อไปนี้ของ [สินค้าของคุณ] ว่าลูกค้าชอบอะไร บ่นอะไร ควรแก้สินค้า หน้าร้าน หรือคำตอบแชตอย่างไร: [วางรีวิวลูกค้า]' },
  { id: 'ugc_brief', group: 'content', icon: 'doc',
    prompt: 'เขียนบรีฟให้ครีเอเตอร์ TikTok ทำคลิปรีวิว [สินค้าของคุณ] กลุ่มเป้าหมาย [กลุ่มลูกค้า] ระบุมุมเล่า ฮุก 3 ช็อตแรก สิ่งที่ห้ามพูด และค่าตอบแทนแบบคอมมิชชันที่เหมาะสม' },
  { id: 'video_script', group: 'content', icon: 'video',
    prompt: 'เขียนสคริปต์คลิปขาย [สินค้าของคุณ] ยาว [15 / 30 / 60] วินาที ฮุก 3 แบบ ช็อตต่อช็อต ข้อความบนจอ และคำชวนกดตะกร้า' },
  { id: 'viral_analysis', group: 'content', icon: 'video',
    prompt: 'ถอดสูตรคลิปนี้: [วางลิงก์หรือแคปชันคลิปไวรัล] ฮุก โครงเรื่อง จังหวะ และเหตุผลที่คนซื้อ แล้วปรับเป็นไอเดียคลิปสำหรับ [สินค้าของคุณ]' },
  { id: 'campaign_calendar', group: 'ads', icon: 'calendar',
    prompt: 'วางแผนแคมเปญ [เดือน] สำหรับร้าน [ประเภทร้าน] ครอบคลุมวันเลขเบิ้ล วันเงินเดือนออก และเทศกาลไทยในเดือนนั้น งบโฆษณา [งบ] บาท แบ่งงานเป็นรายสัปดาห์' },
  { id: 'roas_analysis', group: 'ads', icon: 'money',
    prompt: 'วิเคราะห์ผลโฆษณาต่อไปนี้ แคมเปญไหนควรเพิ่มงบ ตัด หรือปรับครีเอทีฟ: [วางตัวเลข ค่าโฆษณา ยอดขาย คลิก CTR ของแต่ละแคมเปญ]' },
  { id: 'search_terms', group: 'ads', icon: 'search',
    prompt: 'หาคำค้นภาษาไทยสำหรับยิงโฆษณา [สินค้าของคุณ] บน Shopee Ads และ Lazada Sponsored แยกคำหลัก คำเฉพาะเจาะจง และคำที่ควรตัดออก' },
]
const TEMPLATE_IDS = new Set(QUICK_TEMPLATES.map(t => t.id))

export const THAI_MARKET_CONTEXT = [
  'Thai market context to apply:',
  '- Channels: TikTok Shop, Shopee, Lazada, Facebook/Instagram, LINE OA and live selling.',
  '- Double-date sales every month (9.9, 10.10, 11.11, 12.12) and payday (around the 25th to early next month) are peak periods.',
  '- Thai festivals: Songkran, Chinese New Year, Loy Krathong, New Year, Mother\'s Day, Father\'s Day, back to school.',
  '- Prices are in baht; buyers are sensitive to shipping fees, vouchers and cash on delivery.',
  '- Food, supplements, cosmetics and health products must not claim exaggerated or medical benefits (Thai FDA / OCPB rules).',
].join('\n')

type InsightRow = typeof schema.marketerInsights.$inferSelect

export function toInsightJson(row: InsightRow) {
  return {
    id: row.id, templateId: row.templateId, prompt: row.prompt, expert: row.expert, category: row.category,
    productName: row.productName, status: row.status, result: row.result, errorMsg: row.errorMsg,
    createdAt: row.createdAt, updatedAt: row.updatedAt,
  }
}

function text(v: unknown, field: string, max: number, required = false): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) throw new AppError(`${field} ต้องไม่ว่าง`, 'E_INVALID_FIELD')
    return null
  }
  if (typeof v !== 'string') throw new AppError(`${field} ต้องเป็นข้อความ`, 'E_INVALID_FIELD')
  const s = v.trim()
  if (required && !s) throw new AppError(`${field} ต้องไม่ว่าง`, 'E_INVALID_FIELD')
  if (s.length > max) throw new AppError(`${field} ยาวเกิน ${max} ตัวอักษร`, 'E_INVALID_FIELD')
  return s || null
}

export function parseInsightBody(body: any) {
  if (!body || typeof body !== 'object') throw new AppError('ข้อมูลไม่ถูกต้อง', 'E_INVALID_FIELD')
  const templateId = typeof body.templateId === 'string' && TEMPLATE_IDS.has(body.templateId) ? body.templateId : null
  const expert = typeof body.expert === 'string' && Object.hasOwn(QUICK_EXPERTS, body.expert) ? body.expert as QuickExpert : 'general'
  const category = typeof body.category === 'string' && Object.hasOwn(QUICK_CATEGORIES, body.category) ? body.category as QuickCategory : null
  return { templateId, prompt: text(body.prompt, 'prompt', 4000, true)!, expert, category, productName: text(body.productName, 'productName', 160) }
}

/** Evidence จากคลังคลิปมาแรงไทย (curated) ในหมวดที่ใกล้ที่สุด */
export function trendingEvidence(category: QuickCategory | null): string {
  const industry = category ? QUICK_CATEGORIES[category] : undefined
  const { entries, curatedAt } = listTrendVideos({ industry, sort: 'views' })
  if (!entries.length) return '【Trending evidence】(none)'
  return [`【Trending evidence — curated Thai viral clips as of ${curatedAt}; treat the numbers as Evidence, everything else you add is Assumption】`,
    ...entries.slice(0, 8).map((e, i) => `${i + 1}. [${e.industry}/${e.platform}] ${e.title.slice(0, 160)} | views ${e.views.toLocaleString('en-US')}` +
      (e.estRevenueThb !== null ? ` | est. revenue ${e.estRevenueThb.toLocaleString('en-US')} THB` : '') +
      ` | hook: ${e.pattern.hook.slice(0, 120)} | why: ${e.summary.slice(0, 160)}`)].join('\n')
}

export function buildInsightMessage(input: ReturnType<typeof parseInsightBody>): string {
  return [
    `【Role】${QUICK_EXPERTS[input.expert]}`,
    THAI_MARKET_CONTEXT,
    input.productName ? `【Seller's product】${input.productName}` : '',
    input.category ? `【Category】${input.category}` : '',
    trendingEvidence(input.category),
    `【Task from the seller (Thai)】\n${input.prompt}`,
    'Write the report now, in Thai, following your output format.',
  ].filter(Boolean).join('\n\n')
}

export async function listInsights() {
  // each member sees their own analyses (admins see all); get/delete by id are checked in auth/ownership.ts
  const rows = await db.select().from(schema.marketerInsights).where(ownedBy(schema.marketerInsights.ownerUserId))
    .orderBy(desc(schema.marketerInsights.id)).limit(30)
  return rows.map(toInsightJson)
}

export async function getInsight(id: number) {
  const [row] = await db.select().from(schema.marketerInsights).where(eq(schema.marketerInsights.id, id))
  return row ? toInsightJson(row) : null
}

export async function deleteInsight(id: number): Promise<boolean> {
  const res = await db.delete(schema.marketerInsights).where(eq(schema.marketerInsights.id, id))
    .returning({ id: schema.marketerInsights.id })
  return res.length > 0
}

/** POST /marketer/insights — 202 แล้วเขียนรายงานเบื้องหลัง; หน้าบ้าน poll GET /marketer/insights/:id */
export async function createInsight(body: any) {
  const input = parseInsightBody(body)
  await getTextConfig() // ไม่มี text model → E_NO_TEXT_MODEL (400) ก่อนสร้างแถว
  const ts = now()
  const res = await db.insert(schema.marketerInsights).values({
    templateId: input.templateId, prompt: input.prompt, expert: input.expert, category: input.category,
    productName: input.productName, status: 'processing', createdAt: ts, updatedAt: ts,
  }).returning({ id: schema.marketerInsights.id })
  const id = insertedId(res)
  const key = `marketer_insight:${id}`
  const task = await startTask({ kind: 'marketer_insight', key })
  if (!task) throw new AppError('งานนี้กำลังทำอยู่', 'E_CAMPAIGN_BUSY')
  logTaskStart('Marketer', 'quick-insight', { id, templateId: input.templateId ?? undefined, expert: input.expert })
  const message = buildInsightMessage(input)
  ;(async () => {
    const agent = mastra.getAgent('marketing_insight')
    if (!agent) throw new AppError('marketing_insight Agent 不可用', 'E_AGENT_UNAVAILABLE')
    const result: any = await agent.generate([{ role: 'user', content: message }], { maxSteps: 2 })
    const report = String(result?.text || '').trim()
    if (!report) throw new Error('marketing_insight returned an empty report')
    await db.update(schema.marketerInsights).set({ status: 'completed', result: report, errorMsg: null, updatedAt: now() })
      .where(eq(schema.marketerInsights.id, id))
    await updateTask(key, { status: 'done', finishedAt: now() })
    logTaskSuccess('Marketer', 'quick-insight', { id, chars: report.length })
  })().catch(async (err: any) => {
    const raw = err?.message || 'insight failed'
    const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
    await db.update(schema.marketerInsights).set({ status: 'failed', errorMsg: msg.slice(0, 500), updatedAt: now() })
      .where(eq(schema.marketerInsights.id, id))
    await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
    logTaskError('Marketer', 'quick-insight', { id, error: msg })
  })
  return (await getInsight(id))!
}

/** boot: งาน processing ค้างจาก restart → failed (กันหน้าบ้านหมุนค้าง) */
export async function failStaleInsights(): Promise<number> {
  const res = await db.update(schema.marketerInsights)
    .set({ status: 'failed', errorMsg: 'E_TASK_INTERRUPTED: เซิร์ฟเวอร์รีสตาร์ตระหว่างทำงาน กรุณาลองใหม่', updatedAt: now() })
    .where(eq(schema.marketerInsights.status, 'processing'))
    .returning({ id: schema.marketerInsights.id })
  return res.length
}

export function quickCatalog() {
  return { templates: QUICK_TEMPLATES, groups: QUICK_GROUPS, experts: Object.keys(QUICK_EXPERTS), categories: Object.keys(QUICK_CATEGORIES) }
}
