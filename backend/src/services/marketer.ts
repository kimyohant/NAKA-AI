/**
 * AI Marketer 服务 — campaign / docs / creatives 生命周期 + 异步 Agent 任务
 * research / strategy / creatives 走 pipeline_tasks（同 extraction 模式）：
 * campaign.status 是前端轮询的状态机（draft → researching → research_ready → ... → failed），
 * pipeline_tasks 行提供防并发的 running 互斥；boot 时 *_ing 状态由 failStaleCampaigns 清理为 failed。
 * 对外 JSON 统一 camelCase（docs/ai-marketer/PLAN.md ข้อ 4 API Contract）。
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { ownedBy } from '../auth/owner-context.js'
import { db, getInsertId, schema } from '../db/index.js'
import { AppError, now } from '../utils/response.js'
import { getTextConfig, getActiveConfigId, getActiveConfig } from './ai.js'
import { ingestProductUrl, type IngestedProduct } from './product-ingest.js'
import { generateImage } from './generation.js'
import { buildVisualPrompt, visualSizeFor, VISUAL_KINDS, type VisualKind } from './product-visuals.js'
import { mastra } from '../mastra/index.js'
import { buildCampaignRequestContext } from '../agents/context.js'
import { startTask, updateTask, type PipelineTaskKind } from './pipeline-tasks.js'
import { performanceEvidenceBlock } from './gallery.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import {
  MARKETER_DOC_KINDS,
  MARKETER_PLATFORMS,
  MARKETER_CREATIVE_FORMATS,
  snapshotDocRevision,
} from '../agents/tools/marketer-tools.js'

export const DOC_KINDS = MARKETER_DOC_KINDS
export const PLATFORMS = MARKETER_PLATFORMS
export const CREATIVE_FORMATS = MARKETER_CREATIVE_FORMATS
// Phase 3: Product Visuals
// VISUAL_KINDS / VisualKind / buildVisualPrompt / visualSizeFor ย้ายไป services/product-visuals.ts (ใช้ร่วมกับ Studio)
export { VISUAL_KINDS, type VisualKind } from './product-visuals.js'
export const MAX_TRANSCRIPT_LENGTH = 20_000
export const DEFAULT_VISUALS_COUNT = 2

export type DocKind = typeof DOC_KINDS[number]
export type Platform = typeof PLATFORMS[number]
export type CreativeFormat = typeof CREATIVE_FORMATS[number]

const ASPECT_RATIOS = ['9:16', '16:9', '1:1'] as const
/** 进行中状态（前端轮询）；boot 清理同款 */
const ING_STATUSES = ['researching', 'strategizing', 'writing']
export const CAMPAIGN_ING_STATUSES = ING_STATUSES

export const DEFAULT_CREATIVES_COUNT = 3

// ---------- 序列化（camelCase 对外） ----------

type CampaignRow = typeof schema.campaigns.$inferSelect
type DocRow = typeof schema.campaignDocs.$inferSelect
type CreativeRow = typeof schema.campaignCreatives.$inferSelect

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function toCampaignJson(row: CampaignRow) {
  return {
    id: row.id,
    title: row.title,
    productUrl: row.productUrl,
    productName: row.productName,
    productDescription: row.productDescription,
    productImages: parseJsonArray(row.productImages),
    brandNotes: row.brandNotes,
    market: row.market,
    platforms: parseJsonArray(row.platforms),
    audience: row.audience,
    goal: row.goal,
    style: row.style,
    aspectRatio: row.aspectRatio,
    status: row.status,
    errorMsg: row.errorMsg,
    dramaId: row.dramaId,
    researchNotes: row.researchNotes,
    budgetThb: row.budgetThb,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toDocJson(row: DocRow, opts: { revising?: boolean } = {}) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind,
    content: row.content,
    status: row.status,
    version: row.version,
    // async revise (body {async:true}) กำลังรันอยู่ — frontend ใช้ปิดปุ่ม/แสดง spinner
    revising: !!opts.revising,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toCreativeJson(row: CreativeRow) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    angle: row.angle,
    hook: row.hook,
    format: row.format,
    platform: row.platform,
    durationSec: row.durationSec,
    cta: row.cta,
    script: row.script,
    status: row.status,
    episodeId: row.episodeId,
    episodeNumber: row.episodeNumber,
    // Phase 3 recreate mode: creative สร้างตามโครงของ reference ใด
    referenceId: row.referenceId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

// ---------- 校验 ----------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function stringArray(v: unknown, field: string): string[] {
  if (!Array.isArray(v)) throw new AppError(`${field} 必须是字符串数组`, 'E_INVALID_FIELD')
  return v.map(item => {
    if (typeof item !== 'string') throw new AppError(`${field} 必须是字符串数组`, 'E_INVALID_FIELD')
    return item
  })
}

function enumArray<T extends readonly string[]>(v: unknown, allowed: T, field: string): string[] {
  return enumArrayForRoute(v, allowed, field)
}

/** 供路由层校验 formats / platforms 请求参数（非法值 → E_INVALID_FIELD） */
export function enumArrayForRoute(v: unknown, allowed: readonly string[], field: string): string[] {
  const arr = stringArray(v, field)
  for (const item of arr) {
    if (!allowed.includes(item)) throw new AppError(`${field} 含不支持的值: ${item}`, 'E_INVALID_FIELD')
  }
  return arr
}

/** งบประมาณ (THB): null/'' ล้างค่า, ตัวเลข 0-100,000,000 ปัด 2 ตำแหน่ง (เกณฑ์เดียวกับ dramas.ts) */
function parseBudgetThb(raw: unknown): number | null {
  if (raw === null || raw === '' || raw === undefined) return null
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
    throw new AppError('Budget must be between 0 and 100,000,000 THB', 'E_INVALID_FIELD')
  }
  return Math.round(amount * 100) / 100
}

// ---------- CRUD ----------

async function getCampaignRow(id: number): Promise<CampaignRow | null> {
  const [row] = await db.select().from(schema.campaigns)
    .where(and(eq(schema.campaigns.id, id), isNull(schema.campaigns.deletedAt)))
  return row ?? null
}

export async function listCampaigns(opts: { status?: string; dramaId?: number } = {}) {
  const rows = await db.select().from(schema.campaigns)
    .where(and(isNull(schema.campaigns.deletedAt), ownedBy(schema.campaigns.ownerUserId)))
    .orderBy(desc(schema.campaigns.updatedAt))
  let filtered = rows
  if (opts.status) filtered = filtered.filter(r => r.status === opts.status)
  if (opts.dramaId) filtered = filtered.filter(r => r.dramaId === opts.dramaId)
  return filtered.map(toCampaignJson)
}

export async function getCampaignDetail(id: number) {
  const row = await getCampaignRow(id)
  if (!row) return null
  const docs = await db.select().from(schema.campaignDocs)
    .where(eq(schema.campaignDocs.campaignId, id))
    .orderBy(schema.campaignDocs.id)
  const creatives = await db.select().from(schema.campaignCreatives)
    .where(eq(schema.campaignCreatives.campaignId, id))
    .orderBy(schema.campaignCreatives.id)
  // Phase 3: references + visuals (ใหม่→เก่า) — visuals อ่านสดจาก sys_task
  const references = await db.select().from(schema.campaignAdReferences)
    .where(eq(schema.campaignAdReferences.campaignId, id))
    .orderBy(desc(schema.campaignAdReferences.id))
  const visualRows = await db.select().from(schema.campaignVisuals)
    .where(eq(schema.campaignVisuals.campaignId, id))
    .orderBy(desc(schema.campaignVisuals.id))
  const visuals = await Promise.all(visualRows.map(v => toVisualJson(v, parseJsonArray(row.productImages))))
  // งาน async (revise/analyze) ที่กำลังรัน — มาจาก pipeline_tasks (boot แล้ว failStaleRunningTasks เคลียร์ค้าง)
  const running = await db.select().from(schema.pipelineTasks)
    .where(eq(schema.pipelineTasks.status, 'running'))
  const revisingKeys = new Set(running.filter(t => t.kind === 'campaign_doc_revise').map(t => t.key))
  const analyzingKeys = new Set(running.filter(t => t.kind === 'reference_analyze').map(t => t.key))
  return {
    ...toCampaignJson(row),
    docs: docs.map(d => toDocJson(d, { revising: revisingKeys.has(`doc_revise:${id}:${d.id}`) })),
    creatives: creatives.map(toCreativeJson),
    references: references.map(r => toAdReferenceJson(r, { analyzing: analyzingKeys.has(`reference_analyze:${id}:${r.id}`) })),
    visuals,
  }
}

export async function createCampaign(body: any) {
  if (!isNonEmptyString(body.productName) && !isNonEmptyString(body.productUrl)) {
    throw new AppError('需要 productName 或 productUrl', 'E_INVALID_FIELD')
  }
  const ts = now()
  const values: typeof schema.campaigns.$inferInsert = {
    title: isNonEmptyString(body.title) ? body.title.trim() : (body.productName || body.productUrl).trim(),
    productName: isNonEmptyString(body.productName) ? body.productName.trim() : '',
    status: 'draft',
    market: isNonEmptyString(body.market) ? body.market.trim() : 'TH',
    style: isNonEmptyString(body.style) ? body.style : '3d',
    aspectRatio: ASPECT_RATIOS.includes(body.aspectRatio) ? body.aspectRatio : '9:16',
    createdAt: ts,
    updatedAt: ts,
  }
  if (body.productUrl !== undefined) values.productUrl = isNonEmptyString(body.productUrl) ? body.productUrl.trim() : null
  if (body.productDescription !== undefined) values.productDescription = isNonEmptyString(body.productDescription) ? body.productDescription : null
  if (body.productImages !== undefined) {
    values.productImages = JSON.stringify(stringArray(body.productImages, 'productImages'))
  }
  if (body.brandNotes !== undefined) values.brandNotes = isNonEmptyString(body.brandNotes) ? body.brandNotes : null
  if (body.platforms !== undefined && body.platforms !== null) {
    values.platforms = JSON.stringify(enumArray(body.platforms, PLATFORMS, 'platforms'))
  }
  if (body.audience !== undefined) values.audience = isNonEmptyString(body.audience) ? body.audience : null
  if (body.goal !== undefined) values.goal = isNonEmptyString(body.goal) ? body.goal : null
  if (body.researchNotes !== undefined) values.researchNotes = isNonEmptyString(body.researchNotes) ? body.researchNotes : null
  if (body.budgetThb !== undefined) values.budgetThb = parseBudgetThb(body.budgetThb)

  const res = await db.insert(schema.campaigns).values(values)
  const row = await getCampaignRow(getInsertId(res))
  return row ? toCampaignJson(row) : null
}

export async function updateCampaign(id: number, body: any) {
  const row = await getCampaignRow(id)
  if (!row) return null
  const updates: Partial<typeof schema.campaigns.$inferInsert> = { updatedAt: now() }
  if (body.title !== undefined) {
    if (!isNonEmptyString(body.title)) throw new AppError('title 不能为空', 'E_INVALID_FIELD')
    updates.title = body.title.trim()
  }
  if (body.productUrl !== undefined) updates.productUrl = isNonEmptyString(body.productUrl) ? body.productUrl.trim() : null
  if (body.productName !== undefined) {
    if (!isNonEmptyString(body.productName)) throw new AppError('productName 不能为空', 'E_INVALID_FIELD')
    updates.productName = body.productName.trim()
  }
  if (body.productDescription !== undefined) updates.productDescription = isNonEmptyString(body.productDescription) ? body.productDescription : null
  if (body.productImages !== undefined) {
    updates.productImages = JSON.stringify(stringArray(body.productImages, 'productImages'))
  }
  if (body.brandNotes !== undefined) updates.brandNotes = isNonEmptyString(body.brandNotes) ? body.brandNotes : null
  if (body.market !== undefined) {
    if (!isNonEmptyString(body.market)) throw new AppError('market 不能为空', 'E_INVALID_FIELD')
    updates.market = body.market.trim()
  }
  if (body.platforms !== undefined && body.platforms !== null) {
    updates.platforms = JSON.stringify(enumArray(body.platforms, PLATFORMS, 'platforms'))
  }
  if (body.audience !== undefined) updates.audience = isNonEmptyString(body.audience) ? body.audience : null
  if (body.goal !== undefined) updates.goal = isNonEmptyString(body.goal) ? body.goal : null
  if (body.researchNotes !== undefined) updates.researchNotes = isNonEmptyString(body.researchNotes) ? body.researchNotes : null
  if (body.budgetThb !== undefined) updates.budgetThb = parseBudgetThb(body.budgetThb)
  if (body.style !== undefined) {
    if (!isNonEmptyString(body.style)) throw new AppError('style 不能为空', 'E_INVALID_FIELD')
    updates.style = body.style
  }
  if (body.aspectRatio !== undefined) {
    if (!ASPECT_RATIOS.includes(body.aspectRatio)) throw new AppError('aspectRatio 只支持 9:16 / 16:9 / 1:1', 'E_INVALID_FIELD')
    updates.aspectRatio = body.aspectRatio
  }
  await db.update(schema.campaigns).set(updates).where(eq(schema.campaigns.id, id))
  const updated = await getCampaignRow(id)
  return updated ? toCampaignJson(updated) : null
}

export async function deleteCampaign(id: number): Promise<boolean> {
  const row = await getCampaignRow(id)
  if (!row) return false
  await db.update(schema.campaigns).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.campaigns.id, id))
  return true
}

export function ingestUrl(url: string): Promise<IngestedProduct> {
  return ingestProductUrl(url)
}

// ---------- 异步 Agent 任务（research / strategy / creatives） ----------

function assertNotBusy(row: CampaignRow) {
  if (ING_STATUSES.includes(row.status)) {
    throw new AppError('活动有任务正在执行，请等待完成后再试', 'E_CAMPAIGN_BUSY')
  }
}

async function requireTextModel() {
  // 无文本模型配置 → E_NO_TEXT_MODEL（同步抛出，路由返回 400）
  await getTextConfig()
}

function campaignSummaryBlock(row: CampaignRow): string {
  const lines = [
    `【Campaign】#${row.id} ${row.title}`,
    `- Product: ${row.productName}`,
    row.productUrl ? `- Product URL: ${row.productUrl}` : '',
    row.productDescription ? `- Product description: ${row.productDescription}` : '',
    row.productImages ? `- Product images: ${parseJsonArray(row.productImages).join(', ') || '(none)'}` : '',
    row.brandNotes ? `- Brand notes: ${row.brandNotes}` : '',
    `- Market: ${row.market}`,
    `- Platforms: ${parseJsonArray(row.platforms).join(', ') || '(none)'}`,
    row.audience ? `- Audience: ${row.audience}` : '',
    row.goal ? `- Goal: ${row.goal}` : '',
    `- Visual style: ${row.style} / aspect ${row.aspectRatio}`,
  ]
  return lines.filter(Boolean).join('\n')
}

async function docsBlock(campaignId: number): Promise<string> {
  const docs = await db.select().from(schema.campaignDocs)
    .where(eq(schema.campaignDocs.campaignId, campaignId))
    .orderBy(schema.campaignDocs.id)
  if (!docs.length) return '【Existing docs】(none yet)'
  return ['【Existing docs】', ...docs.map(d => `## ${d.kind} (v${d.version})\n${d.content}`)].join('\n\n')
}

/** 文档 kind → 负责修订的 Agent */
function agentForDocKind(kind: string): 'market_researcher' | 'strategist' {
  return kind === 'product_brief' || kind === 'market_research' ? 'market_researcher' : 'strategist'
}

interface AgentJobOptions {
  campaignId: number
  key: string
  agentType: string
  message: string
  readyStatus: string
  docKinds?: string[]
  creativeQuota?: number
  creativeMode?: 'replace' | 'append'
  /** Phase 3 recreate: creative ที่ save ทั้งหมดจะผูกกับ reference นี้ */
  referenceId?: number
  maxSteps?: number
  label: string
}

/** 异步执行 Agent 任务：成功置 readyStatus、失败置 failed + errorMsg（前端轮询 GET /campaigns/:id） */
function runCampaignAgentJob(opts: AgentJobOptions): void {
  ;(async () => {
    const agent = mastra.getAgent(opts.agentType)
    if (!agent) throw new AppError(`${opts.agentType} Agent 不可用`, 'E_AGENT_UNAVAILABLE')
    const requestContext = buildCampaignRequestContext({
      campaignId: opts.campaignId,
      docKinds: opts.docKinds,
      creativeQuota: opts.creativeQuota,
      creativeMode: opts.creativeMode,
      referenceId: opts.referenceId,
    })
    return agent.generate([{ role: 'user', content: opts.message }], {
      maxSteps: opts.maxSteps ?? 24,
      requestContext,
      onStepFinish: (step: any) => {
        const tools = (step?.toolCalls || [])
          .map((t: any) => t?.toolName || t?.payload?.toolName)
          .filter(Boolean)
        logTaskProgress('Marketer', `${opts.label}-step`, {
          campaignId: opts.campaignId,
          tools: tools.length ? tools.join(',') : undefined,
          text: (step?.text || '').slice(0, 200) || undefined,
        })
      },
    })
  })()
    .then(async (result: any) => {
      await updateTask(opts.key, { status: 'done', finishedAt: now() })
      await db.update(schema.campaigns)
        .set({ status: opts.readyStatus, errorMsg: null, updatedAt: now() })
        .where(eq(schema.campaigns.id, opts.campaignId))
      const toolNames = (result?.toolCalls || []).map((t: any) => t?.toolName).filter(Boolean)
      logTaskSuccess('Marketer', opts.label, {
        campaignId: opts.campaignId,
        steps: result?.steps?.length,
        toolCalls: toolNames.join(',') || undefined,
      })
    })
    .catch(async (err: any) => {
      // 有稳定错误码时以「E_XXX: 原文」落库：契约只有 errorMsg 字符串，前端据此前缀翻译（不展示原始中文）
      const raw = err?.message || '任务失败'
      const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
      await updateTask(opts.key, { status: 'error', errorMsg: msg, finishedAt: now() })
      await db.update(schema.campaigns)
        .set({ status: 'failed', errorMsg: msg, updatedAt: now() })
        .where(eq(schema.campaigns.id, opts.campaignId))
      logTaskError('Marketer', opts.label, { campaignId: opts.campaignId, error: msg })
    })
}

async function startCampaignTask(campaignId: number, kind: PipelineTaskKind): Promise<string> {
  const key = `${kind}:${campaignId}`
  const task = await startTask({ kind, key })
  if (!task) throw new AppError('同类任务已在运行中，请等待完成后再试', 'E_CAMPAIGN_BUSY')
  return key
}

export async function startResearch(campaignId: number, notes?: string) {
  const row = await getCampaignRow(campaignId)
  if (!row) return null
  assertNotBusy(row)
  await requireTextModel()
  const key = await startCampaignTask(campaignId, 'campaign_research')
  // เก็บ notes (Evidence จากผู้ใช้) ไว้บน campaign ด้วย — ดูย้อนหลัง/ใช้ revise ได้; ไม่ส่งมาคงค่าเดิม
  const effectiveNotes = notes ?? row.researchNotes ?? undefined
  if (notes !== undefined && notes !== (row.researchNotes ?? undefined)) {
    await db.update(schema.campaigns).set({ researchNotes: notes || null, updatedAt: now() })
      .where(eq(schema.campaigns.id, campaignId))
  }
  await db.update(schema.campaigns).set({ status: 'researching', errorMsg: null, updatedAt: now() })
    .where(eq(schema.campaigns.id, campaignId))
  logTaskStart('Marketer', 'research', { campaignId, hasNotes: Boolean(effectiveNotes) })
  // วงจรเรียนรู้ (docs/ai-marketer/GALLERY.md §4): ผลตอบรับจริงของแคมเปญนี้ → Evidence ให้ market_researcher
  const performanceEvidence = await performanceEvidenceBlock(campaignId)
  const message = [
    campaignSummaryBlock(row),
    effectiveNotes ? `【用户补充资料（竞品/评论/卖点等，一律视为 Evidence）】\n${effectiveNotes}` : '',
    performanceEvidence ?? '',
    '请开始市场调研：调用 read_campaign 确认活动信息，然后撰写 product_brief 与 market_research 两份文档，分别调用 save_campaign_doc 保存。没有数据源的部分严格按 Evidence / Assumption 分开标注。',
  ].filter(Boolean).join('\n\n')
  runCampaignAgentJob({
    campaignId,
    key,
    agentType: 'market_researcher',
    message,
    readyStatus: 'research_ready',
    label: 'research',
  })
  return { status: 'researching' as const }
}

export async function startStrategy(campaignId: number) {
  const row = await getCampaignRow(campaignId)
  if (!row) return null
  assertNotBusy(row)
  const docs = await db.select().from(schema.campaignDocs)
    .where(eq(schema.campaignDocs.campaignId, campaignId))
  if (!docs.some(d => d.kind === 'market_research')) {
    throw new AppError('需要先完成市场调研（market_research）才能制定策略', 'E_STRATEGY_NEEDS_RESEARCH')
  }
  await requireTextModel()
  const key = await startCampaignTask(campaignId, 'campaign_strategy')
  await db.update(schema.campaigns).set({ status: 'strategizing', errorMsg: null, updatedAt: now() })
    .where(eq(schema.campaigns.id, campaignId))
  logTaskStart('Marketer', 'strategy', { campaignId })
  const message = [
    campaignSummaryBlock(row),
    await docsBlock(campaignId),
    '请基于以上文档制定策略：依次撰写并调用 save_campaign_doc 保存 audience_insight / message_map / campaign_plan / content_brief 四份文档。',
  ].join('\n\n')
  runCampaignAgentJob({
    campaignId,
    key,
    agentType: 'strategist',
    message,
    readyStatus: 'strategy_ready',
    label: 'strategy',
  })
  return { status: 'strategizing' as const }
}

export async function startCreatives(campaignId: number, opts: {
  count?: number
  formats?: string[]
  platforms?: string[]
  mode?: 'replace' | 'append'
  referenceId?: number
} = {}) {
  const row = await getCampaignRow(campaignId)
  if (!row) return null
  assertNotBusy(row)
  const docs = await db.select().from(schema.campaignDocs)
    .where(eq(schema.campaignDocs.campaignId, campaignId))
  if (!docs.some(d => d.kind === 'content_brief')) {
    throw new AppError('需要先完成策略（content_brief）才能生成创意', 'E_CREATIVES_NEED_STRATEGY')
  }
  // Phase 3 recreate: referenceId ต้องเป็นของ campaign นี้และ analyzed แล้ว
  let reference: AdReferenceRow | null = null
  if (opts.referenceId !== undefined) {
    reference = await getAdReferenceRow(campaignId, opts.referenceId)
    if (!reference || !reference.analysis) {
      throw new AppError('reference นี้ยังไม่ถูกวิเคราะห์ (analyze ก่อนใช้สร้าง creative)', 'E_REFERENCE_NOT_ANALYZED')
    }
  }
  await requireTextModel()
  const count = opts.count ?? DEFAULT_CREATIVES_COUNT
  const mode = opts.mode === 'append' ? 'append' : 'replace'
  const key = await startCampaignTask(campaignId, 'campaign_creatives')
  await db.update(schema.campaigns).set({ status: 'writing', errorMsg: null, updatedAt: now() })
    .where(eq(schema.campaigns.id, campaignId))
  logTaskStart('Marketer', 'creatives', { campaignId, count, mode })
  const lines = [
    `- Number of creatives: ${count}`,
    opts.formats?.length ? `- Allowed formats: ${opts.formats.join(', ')}` : '- Formats: free choice among ugc/product_demo/problem_solution/before_after/testimonial/unboxing',
    opts.platforms?.length ? `- Allowed platforms: ${opts.platforms.join(', ')}` : `- Platforms: prefer the campaign platforms, otherwise free choice among tiktok/reels/youtube_shorts/facebook/shopee/lazada`,
  ]
  // append: แนบรายการ creative ที่มีอยู่ กัน agent สร้างซ้ำ angle เดิม
  let existingBlock = ''
  if (mode === 'append') {
    const existingCreatives = await db.select().from(schema.campaignCreatives)
      .where(eq(schema.campaignCreatives.campaignId, campaignId))
      .orderBy(schema.campaignCreatives.id)
    existingBlock = existingCreatives.length
      ? ['【Existing creatives (keep all; new ones must differ from these)】',
        ...existingCreatives.map(cr => `- #${cr.id} [${cr.format}/${cr.platform}] angle: ${cr.angle}`)].join('\n')
      : '【Existing creatives】(none yet)'
  }
  const instruction = mode === 'append'
    ? `这是追加模式（append）：不要重复、修改或删除已有创意，新增 ${count} 个与现有创意明显不同的创意，写完整 formatted script，最后调用一次 save_creatives 保存（数量不得超过 ${count}）。`
    : `请构思 ${count} 个差异化创意（不同 angle），每个写完整 formatted script，最后调用一次 save_creatives 保存全部（数量不得超过 ${count}）。`
  // Phase 3 recreate: แนบ analysis ของ reference ให้ ad_scriptwriter ใช้เป็นโครง
  const referenceBlock = reference && reference.analysis
    ? [
        '【Reference ad structure】(recreate mode)',
        `- Reference: ${reference.title}${reference.sourceUrl ? ` (${reference.sourceUrl})` : ''}`,
        'Every creative below must follow this beat structure, hook type and pacing exactly — but sell OUR product, with entirely new wording. Never copy more than one sentence from the reference; never mention the reference brand or competitor names.',
        `【Analysis】\n${reference.analysis}`,
      ].join('\n\n')
    : ''
  const message = [
    campaignSummaryBlock(row),
    await docsBlock(campaignId),
    existingBlock,
    referenceBlock,
    ['【This run】', `- Mode: ${mode}${reference ? ` (recreate from reference #${reference.id})` : ''}`, ...lines].join('\n'),
    instruction,
  ].filter(Boolean).join('\n\n')
  runCampaignAgentJob({
    campaignId,
    key,
    agentType: 'ad_scriptwriter',
    message,
    readyStatus: 'creatives_ready',
    docKinds: [],
    creativeQuota: count,
    creativeMode: mode,
    referenceId: reference?.id,
    maxSteps: 16,
    label: 'creatives',
  })
  return { status: 'writing' as const }
}

// ---------- 文档（编辑 / 修订） ----------

async function getDocRow(campaignId: number, docId: number): Promise<DocRow | null> {
  const [row] = await db.select().from(schema.campaignDocs)
    .where(and(eq(schema.campaignDocs.id, docId), eq(schema.campaignDocs.campaignId, campaignId)))
  return row ?? null
}

export async function updateDoc(campaignId: number, docId: number, body: { content?: unknown; status?: unknown }) {
  const row = await getDocRow(campaignId, docId)
  if (!row) return null
  const hasContent = typeof body.content === 'string' && body.content.length > 0
  if (!hasContent && body.status === undefined) {
    throw new AppError('没有可更新的字段', 'E_INVALID_FIELD')
  }
  const updates: Partial<typeof schema.campaignDocs.$inferInsert> = { updatedAt: now() }
  if (hasContent) {
    // เก็บเนื้อหาเดิมไว้ในประวัติก่อนทับ (ดูย้อน/กู้คืนด้วย PUT เนื้อหาเดิมได้)
    await snapshotDocRevision(row.id, row.version, row.content, 'manual')
    updates.content = body.content as string
    updates.version = row.version + 1 // แก้ content = version+1
  }
  if (body.status !== undefined) {
    if (body.status !== 'draft' && body.status !== 'approved') {
      throw new AppError('status 只支持 draft / approved', 'E_INVALID_FIELD')
    }
    updates.status = body.status
  }
  await db.update(schema.campaignDocs).set(updates).where(eq(schema.campaignDocs.id, docId))
  const updated = await getDocRow(campaignId, docId)
  return updated ? toDocJson(updated) : null
}

/** ประวัติเนื้อหาเอกสารย้อนหลัง (agent revise = agent / แก้มือ = manual) — เรียง version มาก→น้อย */
export async function listDocRevisions(campaignId: number, docId: number) {
  const row = await getDocRow(campaignId, docId)
  if (!row) return null
  const revisions = await db.select().from(schema.campaignDocRevisions)
    .where(eq(schema.campaignDocRevisions.docId, docId))
    .orderBy(desc(schema.campaignDocRevisions.version))
  return revisions.map(r => ({
    id: r.id,
    docId: r.docId,
    version: r.version,
    content: r.content,
    source: r.source,
    createdAt: r.createdAt,
  }))
}

/**
 * กู้คืนเนื้อหาเอกสารจาก revision: เนื้อหาปัจจุบันถูกสแนปชอตไว้ก่อน (ไม่หาย),
 * เนื้อหาจาก revision กลับเข้า doc พร้อม version+1 — เส้นทางกู้คืนที่ง่ายที่สุด
 */
export async function restoreDocRevision(campaignId: number, docId: number, revisionId: number) {
  const doc = await getDocRow(campaignId, docId)
  if (!doc) return null
  const [rev] = await db.select().from(schema.campaignDocRevisions)
    .where(and(eq(schema.campaignDocRevisions.id, revisionId), eq(schema.campaignDocRevisions.docId, docId)))
  if (!rev) return { notFoundRevision: true as const }
  if (rev.content !== doc.content) {
    await snapshotDocRevision(doc.id, doc.version, doc.content, 'manual')
    await db.update(schema.campaignDocs)
      .set({ content: rev.content, version: doc.version + 1, updatedAt: now() })
      .where(eq(schema.campaignDocs.id, docId))
  }
  const updated = await getDocRow(campaignId, docId)
  return { doc: updated ? toDocJson(updated) : null }
}

/** แกน agent ของ revise (ใช้ทั้งโหมด sync และ async — ห้ามก๊อป logic แยก) */
async function runDocRevision(campaign: CampaignRow, doc: DocRow, instruction: string) {
  await requireTextModel()
  const agentType = agentForDocKind(doc.kind)
  const agent = mastra.getAgent(agentType)
  if (!agent) throw new AppError(`${agentType} Agent 不可用`, 'E_AGENT_UNAVAILABLE')

  const requestContext = buildCampaignRequestContext({
    campaignId: campaign.id,
    docKinds: [doc.kind],
  })
  const message = [
    campaignSummaryBlock(campaign),
    `【待修订文档 ${doc.kind} (v${doc.version})】\n${doc.content}`,
    `【修订指令】\n${instruction}`,
    '请按修订指令修改文档：保持 Markdown 结构与 Evidence / Assumption 标注规范，输出修订后的完整文档，并调用 save_campaign_doc 保存（kind 必须是 ' + doc.kind + '）。完成后一两句话概述改了什么。',
  ].join('\n\n')

  await agent.generate([{ role: 'user', content: message }], { maxSteps: 12, requestContext })
}

/** 同步修订：调用文档所属 Agent 按 instruction 修订（docKinds 只放行该文档） */
export async function reviseDoc(campaignId: number, docId: number, instruction: string) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  const doc = await getDocRow(campaignId, docId)
  if (!doc) return null
  await runDocRevision(campaign, doc, instruction)
  const updated = await getDocRow(campaignId, docId)
  return updated ? toDocJson(updated) : null
}

/**
 * โหมด async ของ revise (body {async:true} — กัน proxy timeout เมื่อใช้โมเดล local/CPU):
 * 202 + สถานะผ่าน pipeline_tasks (doc.revising), โหมด sync เดิมไม่เปลี่ยน
 */
export async function reviseDocAsync(campaignId: number, docId: number, instruction: string) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  const doc = await getDocRow(campaignId, docId)
  if (!doc) return null
  const key = `doc_revise:${campaignId}:${docId}`
  const task = await startTask({ kind: 'campaign_doc_revise', key, dramaId: campaign.dramaId ?? undefined })
  if (!task) throw new AppError('กำลังปรับแก้เอกสารนี้อยู่ กรุณารอสักครู่', 'E_CAMPAIGN_BUSY')
  logTaskStart('Marketer', 'doc-revise', { campaignId, docId, docKind: doc.kind })
  ;(async () => runDocRevision(campaign, doc, instruction))()
    .then(async () => {
      await updateTask(key, { status: 'done', finishedAt: now() })
      logTaskSuccess('Marketer', 'doc-revise', { campaignId, docId })
    })
    .catch(async (err: any) => {
      const raw = err?.message || 'doc revision failed'
      const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
      await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
      logTaskError('Marketer', 'doc-revise', { campaignId, docId, error: msg })
    })
  const updated = await getDocRow(campaignId, docId)
  return updated ? toDocJson(updated, { revising: true }) : null
}

// ---------- 创意（编辑 / 删除 / produce） ----------

async function getCreativeRow(campaignId: number, creativeId: number): Promise<CreativeRow | null> {
  const [row] = await db.select().from(schema.campaignCreatives)
    .where(and(eq(schema.campaignCreatives.id, creativeId), eq(schema.campaignCreatives.campaignId, campaignId)))
  return row ?? null
}

export async function updateCreative(campaignId: number, creativeId: number, body: any) {
  const row = await getCreativeRow(campaignId, creativeId)
  if (!row) return null
  const updates: Partial<typeof schema.campaignCreatives.$inferInsert> = { updatedAt: now() }
  if (body.angle !== undefined) updates.angle = String(body.angle)
  if (body.hook !== undefined) updates.hook = String(body.hook)
  if (body.format !== undefined) {
    if (!CREATIVE_FORMATS.includes(body.format)) throw new AppError(`format 不支持: ${body.format}`, 'E_INVALID_FIELD')
    updates.format = body.format
  }
  if (body.platform !== undefined) {
    if (!PLATFORMS.includes(body.platform)) throw new AppError(`platform 不支持: ${body.platform}`, 'E_INVALID_FIELD')
    updates.platform = body.platform
  }
  if (body.durationSec !== undefined) {
    const n = Number(body.durationSec)
    if (!Number.isInteger(n) || n < 5 || n > 180) throw new AppError('durationSec 必须是 5-180 的整数', 'E_INVALID_FIELD')
    updates.durationSec = n
  }
  if (body.cta !== undefined) updates.cta = isNonEmptyString(body.cta) ? body.cta : null
  if (body.script !== undefined) updates.script = String(body.script)
  if (body.status !== undefined) {
    if (!['draft', 'approved', 'in_production'].includes(body.status)) {
      throw new AppError('status 只支持 draft / approved / in_production', 'E_INVALID_FIELD')
    }
    updates.status = body.status
  }
  await db.update(schema.campaignCreatives).set(updates).where(eq(schema.campaignCreatives.id, creativeId))
  const updated = await getCreativeRow(campaignId, creativeId)
  return updated ? toCreativeJson(updated) : null
}

/** 硬删除（已进入生产的不可删） */
export async function deleteCreative(campaignId: number, creativeId: number): Promise<boolean> {
  const row = await getCreativeRow(campaignId, creativeId)
  if (!row) return false
  if (row.status === 'in_production') {
    throw new AppError('创意已进入生产（已生成剧集），不可删除', 'E_CREATIVE_IN_PRODUCTION')
  }
  // เก็บกวาดผลตอบรับค้าง (docs/ai-marketer/GALLERY.md §2 — creative_results ไม่มี FK แข็ง)
  await db.delete(schema.creativeResults).where(eq(schema.creativeResults.creativeId, creativeId))
  await db.delete(schema.campaignCreatives).where(eq(schema.campaignCreatives.id, creativeId))
  return true
}

/**
 * produce：创意 → drama + episode（复用 dramas/episodes 的创建方式）
 * campaign.dramaId 为空时先建 drama（title/style/aspectRatio 来自 campaign，metadata.campaignId 回链）；
 * episode 直接插库（不锁图片/视频配置——用户后续在剧集页配置），creative 置 in_production 并回填 episode 关联。
 * 幂等：已 in_production 的 creative 再次调用返回既有 { dramaId, episodeNumber }。
 */
export async function produceCreative(campaignId: number, creativeId: number) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  const creative = await getCreativeRow(campaignId, creativeId)
  if (!creative) return null

  if (creative.status === 'in_production' && creative.episodeId && creative.episodeNumber && campaign.dramaId) {
    return { dramaId: campaign.dramaId, episodeNumber: creative.episodeNumber }
  }
  if (!creative.script.trim()) {
    throw new AppError('创意还没有脚本内容，无法生产', 'E_INVALID_FIELD')
  }

  // drama：campaign 已绑定且未删除则复用
  let dramaId = campaign.dramaId
  if (dramaId) {
    const [drama] = await db.select().from(schema.dramas)
      .where(and(eq(schema.dramas.id, dramaId), isNull(schema.dramas.deletedAt)))
    if (!drama) dramaId = null
  }
  if (!dramaId) {
    const ts = now()
    const res = await db.insert(schema.dramas).values({
      ownerUserId: campaign.ownerUserId,
      title: campaign.title,
      style: campaign.style,
      aspectRatio: campaign.aspectRatio,
      metadata: JSON.stringify({ campaignId: campaign.id }),
      budgetThb: campaign.budgetThb ?? null,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    })
    dramaId = getInsertId(res)
    await db.update(schema.campaigns).set({ dramaId, updatedAt: now() })
      .where(eq(schema.campaigns.id, campaign.id))
  }

  // episode：下一个集号（忽略软删，同 episodes.ts 逻辑）；生成配置尽力锁定，缺失不阻断
  const existing = await db.select().from(schema.episodes)
    .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
    .orderBy(schema.episodes.episodeNumber)
  const nextNum = existing.length ? Math.max(...existing.map(e => e.episodeNumber)) + 1 : 1
  const ts = now()
  const [imageConfigId, videoConfigId] = await Promise.all([
    getActiveConfigId('image'),
    getActiveConfigId('video'),
  ])
  const epRes = await db.insert(schema.episodes).values({
    dramaId,
    episodeNumber: nextNum,
    title: creative.angle || `第${nextNum}集`,
    content: creative.script,
    scriptContent: creative.script,
    hook: creative.hook,
    status: 'draft',
    resolution: '720p',
    imageConfigId: imageConfigId ?? null,
    videoConfigId: videoConfigId ?? null,
    createdAt: ts,
    updatedAt: ts,
  })
  const episodeId = getInsertId(epRes)

  // 真实商品 → prop 参考素材：ingest 到的商品图挂到道具上，让白底单品图贴合实际商品
  // （extractor 同名合并时会保留 referenceImages；storyboard 经 prop_ids 引用同一道具）
  if (parseJsonArray(campaign.productImages).length) {
    await ensureProductProp(dramaId, episodeId, campaign)
  }

  await db.update(schema.campaignCreatives)
    .set({ status: 'in_production', episodeId, episodeNumber: nextNum, updatedAt: now() })
    .where(eq(schema.campaignCreatives.id, creative.id))

  return { dramaId, episodeNumber: nextNum }
}

/**
 * 预建「商品 prop」：名称 = campaign.productName（广告脚本按此名书写，extractor 按名合并复用），
 * referenceImages = campaign.productImages（/static/products/...，prop 生图时作为参考图传给适配器）。
 * 幂等：同名道具已存在则补缺失的参考图并关联新集，不重复创建。
 */
async function ensureProductProp(dramaId: number, episodeId: number, campaign: CampaignRow): Promise<void> {
  const images = parseJsonArray(campaign.productImages)
  const name = campaign.productName.trim()
  if (!images.length || !name) return
  const ts = now()
  const [existing] = await db.select().from(schema.props)
    .where(and(eq(schema.props.dramaId, dramaId), eq(schema.props.name, name), isNull(schema.props.deletedAt)))
  let propId: number
  if (existing) {
    propId = existing.id
    if (!existing.referenceImages) {
      await db.update(schema.props).set({ referenceImages: JSON.stringify(images), updatedAt: ts })
        .where(eq(schema.props.id, existing.id))
    }
  } else {
    const res = await db.insert(schema.props).values({
      dramaId,
      name,
      type: 'product',
      description: campaign.productDescription || '',
      referenceImages: JSON.stringify(images),
      createdAt: ts,
      updatedAt: ts,
    })
    propId = getInsertId(res)
  }
  const links = await db.select().from(schema.episodeProps)
    .where(and(eq(schema.episodeProps.episodeId, episodeId), eq(schema.episodeProps.propId, propId)))
  if (!links.length) {
    await db.insert(schema.episodeProps).values({ episodeId, propId, createdAt: ts })
  }
}

// ---------- Phase 3: Ad references (Recreate Viral Ad) ----------

type AdReferenceRow = typeof schema.campaignAdReferences.$inferSelect

function toAdReferenceJson(row: AdReferenceRow, opts: { analyzing?: boolean } = {}) {
  return {
    id: row.id,
    campaignId: row.campaignId,
    title: row.title,
    sourceUrl: row.sourceUrl,
    transcript: row.transcript,
    notes: row.notes,
    analysis: row.analysis,
    // status เป็น derived: analysis ไม่ว่าง = analyzed
    status: row.analysis ? 'analyzed' : 'draft',
    // async analyze (body {async:true}) กำลังรันอยู่
    analyzing: !!opts.analyzing,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function getAdReferenceRow(campaignId: number, referenceId: number): Promise<AdReferenceRow | null> {
  const [row] = await db.select().from(schema.campaignAdReferences)
    .where(and(eq(schema.campaignAdReferences.id, referenceId), eq(schema.campaignAdReferences.campaignId, campaignId)))
  return row ?? null
}

export async function createAdReference(campaignId: number, body: any) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''
  if (!transcript) throw new AppError('transcript 必填', 'E_INVALID_FIELD')
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    throw new AppError(`transcript ยาวเกิน ${MAX_TRANSCRIPT_LENGTH} ตัวอักษร`, 'E_INVALID_FIELD')
  }
  let sourceUrl: string | null = null
  if (body.sourceUrl !== undefined && body.sourceUrl !== null && isNonEmptyString(body.sourceUrl)) {
    const url = body.sourceUrl.trim()
    // เก็บอ้างอิงเท่านั้น — ห้ามดึงเนื้อหาจาก URL นี้; validate protocol กันข้อมูลมั่ว
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
      sourceUrl = url
    } catch {
      throw new AppError('sourceUrl ต้องเป็น http/https', 'E_INVALID_FIELD')
    }
  }
  // title default: โดเมนของ sourceUrl หรือ Reference #n (n = ลำดับใน campaign)
  let title = isNonEmptyString(body.title) ? body.title.trim() : ''
  if (!title && sourceUrl) {
    try { title = new URL(sourceUrl).hostname } catch { /* fallback ด้านล่าง */ }
  }
  if (!title) {
    const existing = await db.select().from(schema.campaignAdReferences)
      .where(eq(schema.campaignAdReferences.campaignId, campaignId))
    title = `Reference #${existing.length + 1}`
  }
  const ts = now()
  const res = await db.insert(schema.campaignAdReferences).values({
    campaignId,
    title,
    sourceUrl,
    transcript,
    notes: isNonEmptyString(body.notes) ? body.notes : null,
    analysis: null,
    createdAt: ts,
    updatedAt: ts,
  })
  const row = await getAdReferenceRow(campaignId, getInsertId(res))
  return row ? toAdReferenceJson(row) : null
}

export async function updateAdReference(campaignId: number, referenceId: number, body: any) {
  const row = await getAdReferenceRow(campaignId, referenceId)
  if (!row) return null
  const updates: Partial<typeof schema.campaignAdReferences.$inferInsert> = { updatedAt: now() }
  if (body.title !== undefined) {
    if (!isNonEmptyString(body.title)) throw new AppError('title 不能为空', 'E_INVALID_FIELD')
    updates.title = body.title.trim()
  }
  if (body.sourceUrl !== undefined) {
    if (body.sourceUrl === null || body.sourceUrl === '') updates.sourceUrl = null
    else {
      const url = String(body.sourceUrl).trim()
      try {
        const parsed = new URL(url)
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error()
        updates.sourceUrl = url
      } catch {
        throw new AppError('sourceUrl ต้องเป็น http/https', 'E_INVALID_FIELD')
      }
    }
  }
  const transcriptChanged = body.transcript !== undefined
  if (transcriptChanged) {
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''
    if (!transcript) throw new AppError('transcript 必填', 'E_INVALID_FIELD')
    if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
      throw new AppError(`transcript ยาวเกิน ${MAX_TRANSCRIPT_LENGTH} ตัวอักษร`, 'E_INVALID_FIELD')
    }
    updates.transcript = transcript
  }
  if (body.notes !== undefined) updates.notes = isNonEmptyString(body.notes) ? body.notes : null
  if (body.analysis !== undefined) updates.analysis = isNonEmptyString(body.analysis) ? body.analysis : null
  // แก้ transcript ⇒ analysis เดิมใช้ไม่ได้อีก → ล้างกลับเป็น draft
  if (transcriptChanged) updates.analysis = null
  await db.update(schema.campaignAdReferences).set(updates).where(eq(schema.campaignAdReferences.id, referenceId))
  const updated = await getAdReferenceRow(campaignId, referenceId)
  return updated ? toAdReferenceJson(updated) : null
}

export async function deleteAdReference(campaignId: number, referenceId: number): Promise<boolean> {
  const row = await getAdReferenceRow(campaignId, referenceId)
  if (!row) return false
  // hard delete; creative ที่อ้าง reference นี้คง referenceId เดิมไว้ (ไม่ cascade)
  await db.delete(schema.campaignAdReferences).where(eq(schema.campaignAdReferences.id, referenceId))
  return true
}

/** แกน agent ของ analyze (ใช้ทั้งโหมด sync และ async — ห้ามก๊อป logic แยก) */
async function runReferenceAnalysis(campaign: CampaignRow, reference: AdReferenceRow) {
  await requireTextModel()
  const agent = mastra.getAgent('ad_analyst')
  if (!agent) throw new AppError('ad_analyst Agent 不可用', 'E_AGENT_UNAVAILABLE')

  const requestContext = buildCampaignRequestContext({ campaignId: campaign.id, referenceId: reference.id })
  const message = [
    campaignSummaryBlock(campaign),
    `【Reference ad】\n- Title: ${reference.title}`,
    reference.sourceUrl ? `- Source URL: ${reference.sourceUrl} (reference only — never fetch this URL)` : '',
    reference.notes ? `- User notes: ${reference.notes}` : '',
    `【Transcript】\n${reference.transcript}`,
    'Analyze this reference ad\'s full structure and call save_reference_analysis ONCE with the complete Markdown (the six section headings verbatim). Never fetch anything from the source URL. If the transcript lacks information for a section, state that instead of guessing. After saving, summarize in one or two sentences.',
  ].filter(Boolean).join('\n\n')

  await agent.generate([{ role: 'user', content: message }], { maxSteps: 8, requestContext })
}

/** sync 分析：ad_analyst อ่าน transcript จาก user message → save_reference_analysis บันทึกลง DB */
export async function analyzeAdReference(campaignId: number, referenceId: number) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  assertNotBusy(campaign) // analyze ระหว่าง campaign *ing → E_CAMPAIGN_BUSY
  const reference = await getAdReferenceRow(campaignId, referenceId)
  if (!reference) return null

  logTaskStart('Marketer', 'analyze-reference', { campaignId, referenceId })
  await runReferenceAnalysis(campaign, reference)
  const updated = await getAdReferenceRow(campaignId, referenceId)
  return updated ? toAdReferenceJson(updated) : null
}

/** โหมด async ของ analyze (body {async:true}) — 202 + สถานะผ่าน pipeline_tasks (reference.analyzing) */
export async function analyzeAdReferenceAsync(campaignId: number, referenceId: number) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  assertNotBusy(campaign)
  const reference = await getAdReferenceRow(campaignId, referenceId)
  if (!reference) return null
  const key = `reference_analyze:${campaignId}:${referenceId}`
  const task = await startTask({ kind: 'reference_analyze', key, dramaId: campaign.dramaId ?? undefined })
  if (!task) throw new AppError('กำลังวิเคราะห์ reference นี้อยู่ กรุณารอสักครู่', 'E_CAMPAIGN_BUSY')
  logTaskStart('Marketer', 'analyze-reference-async', { campaignId, referenceId })
  ;(async () => runReferenceAnalysis(campaign, reference))()
    .then(async () => {
      await updateTask(key, { status: 'done', finishedAt: now() })
      logTaskSuccess('Marketer', 'analyze-reference-async', { campaignId, referenceId })
    })
    .catch(async (err: any) => {
      const raw = err?.message || 'reference analysis failed'
      const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
      await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
      logTaskError('Marketer', 'analyze-reference-async', { campaignId, referenceId, error: msg })
    })
  const updated = await getAdReferenceRow(campaignId, referenceId)
  return updated ? toAdReferenceJson(updated, { analyzing: true }) : null
}

// ---------- Phase 3: Product visuals (งานรูป แยกจาก agent pipeline — ไม่แตะ campaign.status) ----------

type VisualRow = typeof schema.campaignVisuals.$inferSelect

/** sys_task.status → VisualStatus（unknown = provider ทำหาย → failed, 前端按契约展示） */
function visualStatusFromTask(taskStatus: string | null | undefined): 'processing' | 'completed' | 'failed' {
  if (taskStatus === 'completed') return 'completed'
  if (taskStatus === 'failed' || taskStatus === 'unknown') return 'failed'
  return 'processing'
}

async function toVisualJson(row: VisualRow, productImages: string[]) {
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.taskId))
  const status = visualStatusFromTask(task?.status)
  // localPath ('static/images/x.png') คือไฟล์ถาวร — resultUrl เป็น URL provider ที่อาจหมดอายุ
  const rawImage = status === 'completed' ? (task?.localPath || task?.resultUrl || null) : null
  const imageUrl = rawImage ? (rawImage.startsWith('/') ? rawImage : `/${rawImage}`) : null
  const promoted = !!imageUrl && productImages.some(img => img.replace(/^\//, '') === imageUrl.replace(/^\//, ''))
  return {
    id: row.id,
    campaignId: row.campaignId,
    kind: row.kind,
    sourceImage: row.sourceImage,
    instruction: row.instruction,
    prompt: row.prompt,
    taskId: row.taskId,
    status,
    imageUrl,
    errorMsg: status === 'failed' ? (task?.errorMsg || 'image generation failed') : null,
    promoted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function generateVisuals(campaignId: number, body: any) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  const kind = body.kind
  if (typeof kind !== 'string' || !VISUAL_KINDS.includes(kind as VisualKind)) {
    throw new AppError(`kind 只支持 ${VISUAL_KINDS.join(' / ')}`, 'E_INVALID_FIELD')
  }
  const count = body.count ?? DEFAULT_VISUALS_COUNT
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new AppError('count 必须是 1-4 的整数', 'E_INVALID_FIELD')
  }
  const sourceImage = typeof body.sourceImage === 'string' ? body.sourceImage.trim() : ''
  const productImages = parseJsonArray(campaign.productImages)
  if (!sourceImage || !productImages.includes(sourceImage)) {
    throw new AppError('sourceImage 必须是 campaign.productImages 中的一张图', 'E_INVALID_FIELD')
  }
  const instruction = isNonEmptyString(body.instruction) ? body.instruction : null
  // งานรูปไม่ผ่าน pipeline_tasks / ไม่แตะ campaign.status — แต่ต้องมี image config
  const imageConfig = await getActiveConfig('image')
  if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')

  const prompt = buildVisualPrompt(kind as VisualKind, instruction)
  const size = visualSizeFor(campaign.aspectRatio, kind as VisualKind)
  logTaskStart('Marketer', 'visuals', { campaignId, kind, count, size })

  const rows: Awaited<ReturnType<typeof toVisualJson>>[] = []
  for (let i = 0; i < count; i++) {
    // dramaId มี ⇒ budget guard เดิมทำงาน; ไม่มี drama ⇒ ยังไม่มี budget guard (ค่าใช้จ่ายนับเมื่อ produce)
    const taskId = await generateImage({
      dramaId: campaign.dramaId ?? undefined,
      prompt,
      size,
      referenceImages: [sourceImage],
    })
    const ts = now()
    const res = await db.insert(schema.campaignVisuals).values({
      campaignId,
      kind: kind as VisualKind,
      sourceImage,
      instruction,
      prompt,
      taskId,
      createdAt: ts,
      updatedAt: ts,
    })
    const [row] = await db.select().from(schema.campaignVisuals).where(eq(schema.campaignVisuals.id, getInsertId(res)))
    if (row) rows.push(await toVisualJson(row, productImages))
  }
  logTaskSuccess('Marketer', 'visuals', { campaignId, created: rows.length })
  return rows
}

export async function deleteVisual(campaignId: number, visualId: number): Promise<boolean> {
  const [row] = await db.select().from(schema.campaignVisuals)
    .where(and(eq(schema.campaignVisuals.id, visualId), eq(schema.campaignVisuals.campaignId, campaignId)))
  if (!row) return false
  // ลบเฉพาะ row — ไม่ลบไฟล์ ไม่ถอดออกจาก productImages
  await db.delete(schema.campaignVisuals).where(eq(schema.campaignVisuals.id, visualId))
  return true
}

export async function promoteVisual(campaignId: number, visualId: number) {
  const campaign = await getCampaignRow(campaignId)
  if (!campaign) return null
  const [row] = await db.select().from(schema.campaignVisuals)
    .where(and(eq(schema.campaignVisuals.id, visualId), eq(schema.campaignVisuals.campaignId, campaignId)))
  if (!row) return null
  const productImages = parseJsonArray(campaign.productImages)
  const visual = await toVisualJson(row, productImages)
  if (visual.status !== 'completed' || !visual.imageUrl) {
    throw new AppError('visual ยังสร้างไม่เสร็จ (completed เท่านั้น)', 'E_VISUAL_NOT_READY')
  }
  if (!visual.promoted) {
    const next = [...productImages, visual.imageUrl]
    await db.update(schema.campaigns).set({ productImages: JSON.stringify(next), updatedAt: now() })
      .where(eq(schema.campaigns.id, campaignId))
    // promoted คำนวณจาก productImages — อ่านใหม่เพื่อ reflect ค่าล่าสุด
    const updated = await getCampaignRow(campaignId)
    const refreshed = await toVisualJson(row, parseJsonArray(updated!.productImages))
    return toCampaignJson(updated!)
  }
  return toCampaignJson(campaign)
}

/** boot 清理：进程重启后 *ing 状态不可能还在跑 → 标记失败（同 failStaleRunningTasks） */
export async function failStaleCampaigns(): Promise<number> {
  const res = await db.update(schema.campaigns)
    .set({ status: 'failed', errorMsg: 'E_TASK_INTERRUPTED: 服务重启，任务中断，请重试', updatedAt: now() })
    .where(inArray(schema.campaigns.status, ING_STATUSES))
  return res?.changes ?? 0
}
