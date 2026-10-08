/**
 * AI Marketer Agent 工具 — market_researcher / strategist / ad_scriptwriter
 * 模块级单例 — campaignId 经 CampaignRequestContext 按请求注入；
 * Agent 不直接解析原始数据：读 campaign/docs、写 docs/creatives 全部经由本模块工具完成。
 * docKinds / creativeQuota 由服务层按本次任务注入，工具内强制执行（防越权写入/超量生成）。
 * 常量（doc kinds / platforms / formats）定义在此处供 services/marketer.ts 复用，避免循环依赖。
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db, insertedId, schema } from '../../core/db/index.js'
import { now } from '../../core/http/response.js'
import { getCampaignId } from '../../core/agents/context.js'
import { registerAgentTools } from '../../core/agents/index.js'

export const MARKETER_DOC_KINDS = [
  'product_brief', 'market_research', 'audience_insight', 'message_map', 'campaign_plan', 'content_brief',
] as const
export const MARKETER_PLATFORMS = ['tiktok', 'reels', 'youtube_shorts', 'facebook', 'shopee', 'lazada'] as const
export const MARKETER_CREATIVE_FORMATS = [
  'ugc', 'product_demo', 'problem_solution', 'before_after', 'testimonial', 'unboxing',
] as const

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function toCampaignJson(row: typeof schema.campaigns.$inferSelect) {
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
    // Evidence จากผู้ใช้ที่เก็บไว้ตอนสั่ง research ครั้งล่าสุด (v7)
    researchNotes: row.researchNotes,
  }
}

/** เก็บสำเนาเนื้อหาเดิมลง campaign_doc_revisions ก่อนถูกเนื้อหาใหม่ทับ (v7) */
export async function snapshotDocRevision(docId: number, version: number, content: string, source: 'agent' | 'manual') {
  await db.insert(schema.campaignDocRevisions).values({
    docId,
    version,
    content,
    source,
    createdAt: now(),
  })
}

async function loadCampaign(campaignId: number | null) {
  if (!campaignId) return null
  const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId))
  return row ?? null
}

const readCampaign = createTool({
  id: 'read_campaign',
  description: 'Read the campaign context: product info, brand notes, market, platforms, audience, goal, plus a summary of existing docs.',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const row = await loadCampaign(getCampaignId(context?.requestContext))
    if (!row) return { error: 'Campaign not found (missing campaignId in request context?)' }
    const docs = await db.select().from(schema.campaignDocs)
      .where(eq(schema.campaignDocs.campaignId, row.id))
    return {
      campaign: toCampaignJson(row),
      existing_docs: docs.map(d => ({ kind: d.kind, version: d.version, status: d.status })),
    }
  },
})

const readCampaignDocs = createTool({
  id: 'read_campaign_docs',
  description: 'Read all existing campaign documents (kind, content in Markdown, version, status).',
  inputSchema: z.object({}),
  execute: async (_input, context) => {
    const row = await loadCampaign(getCampaignId(context?.requestContext))
    if (!row) return { error: 'Campaign not found (missing campaignId in request context?)' }
    const docs = await db.select().from(schema.campaignDocs)
      .where(eq(schema.campaignDocs.campaignId, row.id))
      .orderBy(schema.campaignDocs.id)
    return {
      docs: docs.map(d => ({ kind: d.kind, content: d.content, version: d.version, status: d.status })),
    }
  },
})

const saveCampaignDoc = createTool({
  id: 'save_campaign_doc',
  description: 'Create or update one campaign document (Markdown). One doc per kind; saving again bumps the version. Allowed kinds are limited to the current run.',
  inputSchema: z.object({
    kind: z.enum(MARKETER_DOC_KINDS).describe('Document kind to save'),
    content: z.string().min(1).describe('Full document content in Markdown (complete replacement, not a diff)'),
  }),
  execute: async ({ kind, content }, context) => {
    const row = await loadCampaign(getCampaignId(context?.requestContext))
    if (!row) return { error: 'Campaign not found (missing campaignId in request context?)' }
    const allowed = context?.requestContext?.get('docKinds' as never) as string[] | undefined
    if (allowed && !allowed.includes(kind)) {
      return { error: `Kind "${kind}" is not allowed in this run (allowed: ${allowed.join(', ')})` }
    }
    const ts = now()
    const [existing] = await db.select().from(schema.campaignDocs)
      .where(and(eq(schema.campaignDocs.campaignId, row.id), eq(schema.campaignDocs.kind, kind)))
    if (existing) {
      const version = existing.version + 1
      await snapshotDocRevision(existing.id, existing.version, existing.content, 'agent')
      await db.update(schema.campaignDocs)
        .set({ content, version, updatedAt: ts })
        .where(eq(schema.campaignDocs.id, existing.id))
      return { message: `Doc ${kind} saved (version ${version})`, doc_id: existing.id, kind, version }
    }
    const res = await db.insert(schema.campaignDocs).values({
      campaignId: row.id,
      kind,
      content,
      status: 'draft',
      version: 1,
      createdAt: ts,
      updatedAt: ts,
    }).returning({ id: schema.campaignDocs.id })
    return { message: `Doc ${kind} created`, doc_id: insertedId(res), kind, version: 1 }
  },
})

const saveCreatives = createTool({
  id: 'save_creatives',
  description: 'Save all ad creatives for this run in one call. Default replaces previous draft creatives; in append mode existing creatives are kept and new ones are added.',
  inputSchema: z.object({
    creatives: z.array(z.object({
      angle: z.string().min(1).describe('Creative angle, short and differentiated'),
      hook: z.string().min(1).describe('Opening hook — must land within the first 0-3 seconds'),
      format: z.enum(MARKETER_CREATIVE_FORMATS).describe('Creative format'),
      platform: z.enum(MARKETER_PLATFORMS).describe('Target platform'),
      durationSec: z.number().int().min(5).max(180).describe('Total video duration in seconds'),
      cta: z.string().nullable().optional().describe('Call to action at the end'),
      script: z.string().min(1).describe('Full formatted script: scene headers "## S1 | 内景/外景 · 地点 | 时间段", action paragraphs, dialogue "角色名：（状态）台词"'),
    })).min(1).max(20).describe('All creatives produced in this run'),
  }),
  execute: async ({ creatives }, context) => {
    const row = await loadCampaign(getCampaignId(context?.requestContext))
    if (!row) return { error: 'Campaign not found (missing campaignId in request context?)' }
    const rc = context?.requestContext
    const quota = rc?.get('creativeQuota' as never) as number | undefined
    if (typeof quota === 'number') {
      const savedSoFar = Number(rc?.get('creativesSaved') || 0)
      if (savedSoFar + creatives.length > quota) {
        return { error: `Quota exceeded: this run allows ${quota} creatives (already saved ${savedSoFar})` }
      }
      rc?.set('creativesSaved', savedSoFar + creatives.length)
    }
    const mode = (rc?.get('creativeMode' as never) as string | undefined) || 'replace'
    const ts = now()
    // replace: 覆盖旧 draft（approved / in_production 保留）；append: 全部保留，仅新增
    if (mode !== 'append') {
      await db.delete(schema.campaignCreatives)
        .where(and(eq(schema.campaignCreatives.campaignId, row.id), eq(schema.campaignCreatives.status, 'draft')))
    }
    const ids: number[] = []
    for (const cr of creatives) {
      const res = await db.insert(schema.campaignCreatives).values({
        campaignId: row.id,
        angle: cr.angle,
        hook: cr.hook,
        format: cr.format,
        platform: cr.platform,
        durationSec: cr.durationSec,
        cta: cr.cta ?? null,
        script: cr.script,
        status: 'draft',
        // recreate mode: creative นี้สร้างตามโครงของ reference ใด (rc มี referenceId เมื่อ generate ด้วย referenceId)
        referenceId: (rc?.get('referenceId' as never) as number | undefined) ?? null,
        createdAt: ts,
        updatedAt: ts,
      }).returning({ id: schema.campaignCreatives.id })
      ids.push(insertedId(res))
    }
    return { message: `${ids.length} creatives saved`, creative_ids: ids }
  },
})

const saveReferenceAnalysis = createTool({
  id: 'save_reference_analysis',
  description: 'Save the structural analysis of the ad reference (Markdown with the required sections) for the current run.',
  inputSchema: z.object({
    analysis: z.string().min(1).describe('Full analysis Markdown: Hook (0-3s) / Structure / Pacing & Format / Persuasion Levers / CTA / Reuse Template'),
  }),
  execute: async ({ analysis }, context) => {
    const rc = context?.requestContext
    const referenceId = rc?.get('referenceId' as never)
    if (typeof referenceId !== 'number') return { error: 'Missing referenceId in request context' }
    const [existing] = await db.select().from(schema.campaignAdReferences)
      .where(eq(schema.campaignAdReferences.id, referenceId))
    if (!existing) return { error: `Reference not found (id=${referenceId})` }
    await db.update(schema.campaignAdReferences)
      .set({ analysis, updatedAt: now() })
      .where(eq(schema.campaignAdReferences.id, referenceId))
    return { message: 'Reference analysis saved', reference_id: referenceId, length: analysis.length }
  },
})

export const marketerTools = { readCampaign, readCampaignDocs, saveCampaignDoc, saveCreatives, saveReferenceAnalysis }

// AI Marketer agents (campaignId / referenceId come in through the request context).
// Registered on import: services/marketer.ts imports this file before it runs any of these agents.
registerAgentTools('market_researcher', {
  readCampaign: marketerTools.readCampaign,
  readCampaignDocs: marketerTools.readCampaignDocs,
  saveCampaignDoc: marketerTools.saveCampaignDoc,
})
registerAgentTools('strategist', {
  readCampaign: marketerTools.readCampaign,
  readCampaignDocs: marketerTools.readCampaignDocs,
  saveCampaignDoc: marketerTools.saveCampaignDoc,
})
registerAgentTools('ad_scriptwriter', {
  readCampaign: marketerTools.readCampaign,
  readCampaignDocs: marketerTools.readCampaignDocs,
  saveCampaignDoc: marketerTools.saveCampaignDoc,
  saveCreatives: marketerTools.saveCreatives,
})
// Phase 3 Recreate Viral Ad: วิเคราะห์โครงสร้างโฆษณาอ้างอิงจาก transcript ที่ผู้ใช้วาง (sync, tool เดียว)
registerAgentTools('ad_analyst', {
  saveReferenceAnalysis: marketerTools.saveReferenceAnalysis,
})
