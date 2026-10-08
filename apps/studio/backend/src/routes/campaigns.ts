/**
 * AI Marketer 路由 — /api/v1/campaigns（docs/ai-marketer/PLAN.md ข้อ 4 API Contract）
 * 对外 JSON 统一 camelCase；业务错误经 AppError.errorCode 下发
 * （E_CAMPAIGN_BUSY / E_INGEST_FAILED / E_STRATEGY_NEEDS_RESEARCH / E_CREATIVES_NEED_STRATEGY / E_NO_TEXT_MODEL）
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { success, created, badRequest, notFound } from '../core/http/response.js'
import * as marketer from '../services/marketer.js'

const app = new Hono()

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

/** 202 Accepted（research/strategy/creatives 异步受理，前端轮询 GET /campaigns/:id） */
function accepted(c: Context, status: string) {
  return c.json({ code: 202, data: { status }, message: 'accepted' }, 202)
}

function requireId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id >= 1 ? id : null
}

// GET /campaigns — 列表（可选 status / drama_id 过滤）
app.get('/', async (c) => {
  const status = c.req.query('status') || undefined
  const dramaIdRaw = Number(c.req.query('drama_id'))
  const dramaId = Number.isInteger(dramaIdRaw) && dramaIdRaw >= 1 ? dramaIdRaw : undefined
  return success(c, await marketer.listCampaigns({ status, dramaId }))
})

// POST /campaigns — 新建（须有 productName 或 productUrl）
app.post('/', async (c) => {
  const body = await c.req.json()
  try {
    const campaign = await marketer.createCampaign(body)
    if (!campaign) return badRequest(c, '创建活动失败')
    return created(c, campaign)
  } catch (err: any) {
    return badRequest(c, err?.message || '创建活动失败', err?.errorCode)
  }
})

// POST /campaigns/ingest-url — 抓取产品页（SSRF 安全），图片落盘后返回 /static/...
app.post('/ingest-url', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (!isNonEmptyString(body.url)) return badRequest(c, 'url 必填')
  try {
    return success(c, await marketer.ingestUrl(body.url.trim()))
  } catch (err: any) {
    return badRequest(c, err?.message || '产品页抓取失败', err?.errorCode || 'E_INGEST_FAILED')
  }
})

// GET /campaigns/:id — 详情（含 docs + creatives，前端异步轮询用）
app.get('/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const detail = await marketer.getCampaignDetail(id)
  if (!detail) return notFound(c, '活动不存在')
  return success(c, detail)
})

// PUT /campaigns/:id — 更新
app.put('/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const body = await c.req.json()
  try {
    const campaign = await marketer.updateCampaign(id, body)
    if (!campaign) return notFound(c, '活动不存在')
    return success(c, campaign)
  } catch (err: any) {
    return badRequest(c, err?.message || '更新活动失败', err?.errorCode)
  }
})

// DELETE /campaigns/:id — 软删除
app.delete('/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const ok = await marketer.deleteCampaign(id)
  if (!ok) return notFound(c, '活动不存在')
  return success(c)
})

// POST /campaigns/:id/research — 异步调研（product_brief + market_research → research_ready）
app.post('/:id/research', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await marketer.startResearch(id, isNonEmptyString(body.notes) ? body.notes : undefined)
    if (!result) return notFound(c, '活动不存在')
    return accepted(c, result.status)
  } catch (err: any) {
    return badRequest(c, err?.message || '启动调研失败', err?.errorCode)
  }
})

// POST /campaigns/:id/strategy — 异步策略（4 docs → strategy_ready）
app.post('/:id/strategy', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  try {
    const result = await marketer.startStrategy(id)
    if (!result) return notFound(c, '活动不存在')
    return accepted(c, result.status)
  } catch (err: any) {
    return badRequest(c, err?.message || '启动策略失败', err?.errorCode)
  }
})

// POST /campaigns/:id/references — สร้าง ad reference (Recreate Viral Ad, transcript ที่ผู้ใช้วางเอง)
app.post('/:id/references', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const reference = await marketer.createAdReference(id, body)
    if (!reference) return notFound(c, '活动不存在')
    return created(c, reference)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้าง reference ไม่สำเร็จ', err?.errorCode)
  }
})

// PUT /campaigns/:id/references/:rid — แก้ reference (แก้ transcript ⇒ ล้าง analysis กลับ draft)
app.put('/:id/references/:rid', async (c) => {
  const id = requireId(c.req.param('id'))
  const rid = requireId(c.req.param('rid'))
  if (!id || !rid) return badRequest(c, 'Invalid campaign/reference ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const reference = await marketer.updateAdReference(id, rid, body)
    if (!reference) return notFound(c, 'Reference 不存在')
    return success(c, reference)
  } catch (err: any) {
    return badRequest(c, err?.message || 'อัปเดต reference ไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /campaigns/:id/references/:rid — hard delete (ไม่ cascade ไป creative)
app.delete('/:id/references/:rid', async (c) => {
  const id = requireId(c.req.param('id'))
  const rid = requireId(c.req.param('rid'))
  if (!id || !rid) return badRequest(c, 'Invalid campaign/reference ID')
  const ok = await marketer.deleteAdReference(id, rid)
  if (!ok) return notFound(c, 'Reference 不存在')
  return success(c)
})

// POST /campaigns/:id/references/:rid/analyze — sync วิเคราะห์โครงสร้าง (ad_analyst → save_reference_analysis)
// body {async: true} → 202 + สถานะผ่าน pipeline_tasks (reference.analyzing) — sync เดิมไม่เปลี่ยน
app.post('/:id/references/:rid/analyze', async (c) => {
  const id = requireId(c.req.param('id'))
  const rid = requireId(c.req.param('rid'))
  if (!id || !rid) return badRequest(c, 'Invalid campaign/reference ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    if (body.async === true) {
      const reference = await marketer.analyzeAdReferenceAsync(id, rid)
      if (!reference) return notFound(c, 'Reference 不存在')
      return accepted(c, 'analyzing')
    }
    const reference = await marketer.analyzeAdReference(id, rid)
    if (!reference) return notFound(c, 'Reference 不存在')
    return success(c, reference)
  } catch (err: any) {
    return badRequest(c, err?.message || 'วิเคราะห์ reference ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /campaigns/:id/visuals/generate — สร้างงานรูปสินค้า 1-4 งาน (sys_task; ไม่แตะ campaign.status)
app.post('/:id/visuals/generate', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const visuals = await marketer.generateVisuals(id, body)
    if (!visuals) return notFound(c, '活动不存在')
    return success(c, visuals)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้าง visual ไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /campaigns/:id/visuals/:vid — ลบ row (ไม่ลบไฟล์ ไม่แตะ productImages)
app.delete('/:id/visuals/:vid', async (c) => {
  const id = requireId(c.req.param('id'))
  const vid = requireId(c.req.param('vid'))
  if (!id || !vid) return badRequest(c, 'Invalid campaign/visual ID')
  const ok = await marketer.deleteVisual(id, vid)
  if (!ok) return notFound(c, 'Visual 不存在')
  return success(c)
})

// POST /campaigns/:id/visuals/:vid/promote — ต่อท้าย imageUrl เข้า productImages (completed เท่านั้น)
app.post('/:id/visuals/:vid/promote', async (c) => {
  const id = requireId(c.req.param('id'))
  const vid = requireId(c.req.param('vid'))
  if (!id || !vid) return badRequest(c, 'Invalid campaign/visual ID')
  try {
    const campaign = await marketer.promoteVisual(id, vid)
    if (!campaign) return notFound(c, 'Visual 不存在')
    return success(c, campaign)
  } catch (err: any) {
    return badRequest(c, err?.message || 'promote visual ไม่สำเร็จ', err?.errorCode)
  }
})

// PUT /campaigns/:id/docs/:docId — 编辑文档（改 content = version+1；status 可置 approved）
app.put('/:id/docs/:docId', async (c) => {
  const id = requireId(c.req.param('id'))
  const docId = requireId(c.req.param('docId'))
  if (!id || !docId) return badRequest(c, 'Invalid campaign/doc ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const doc = await marketer.updateDoc(id, docId, body)
    if (!doc) return notFound(c, '文档不存在')
    return success(c, doc)
  } catch (err: any) {
    return badRequest(c, err?.message || '更新文档失败', err?.errorCode)
  }
})

// GET /campaigns/:id/docs/:docId/revisions — ประวัติเนื้อหาเอกสาร (agent revise / แก้มือ)
app.get('/:id/docs/:docId/revisions', async (c) => {
  const id = requireId(c.req.param('id'))
  const docId = requireId(c.req.param('docId'))
  if (!id || !docId) return badRequest(c, 'Invalid campaign/doc ID')
  const revisions = await marketer.listDocRevisions(id, docId)
  if (!revisions) return notFound(c, '文档不存在')
  return success(c, revisions)
})

// POST /campaigns/:id/docs/:docId/revisions/:revId/restore — กู้คืนเนื้อหาจาก revision (version+1)
app.post('/:id/docs/:docId/revisions/:revId/restore', async (c) => {
  const id = requireId(c.req.param('id'))
  const docId = requireId(c.req.param('docId'))
  const revId = requireId(c.req.param('revId'))
  if (!id || !docId || !revId) return badRequest(c, 'Invalid campaign/doc/revision ID')
  const result = await marketer.restoreDocRevision(id, docId, revId)
  if (result === null) return notFound(c, '文档不存在')
  if ('notFoundRevision' in result) return notFound(c, '修订版本不存在')
  return success(c, result.doc)
})

// POST /campaigns/:id/docs/:docId/revise — 同步修订（Agent 按 instruction 修改，version+1）
// body {async: true} → 202 + สถานะผ่าน pipeline_tasks (doc.revising) — sync เดิมไม่เปลี่ยน
app.post('/:id/docs/:docId/revise', async (c) => {
  const id = requireId(c.req.param('id'))
  const docId = requireId(c.req.param('docId'))
  if (!id || !docId) return badRequest(c, 'Invalid campaign/doc ID')
  const body = await c.req.json().catch(() => ({}))
  if (!isNonEmptyString(body.instruction)) return badRequest(c, 'instruction 必填')
  try {
    if (body.async === true) {
      const doc = await marketer.reviseDocAsync(id, docId, body.instruction)
      if (!doc) return notFound(c, '文档不存在')
      return accepted(c, 'revising')
    }
    const doc = await marketer.reviseDoc(id, docId, body.instruction)
    if (!doc) return notFound(c, '文档不存在')
    return success(c, doc)
  } catch (err: any) {
    return badRequest(c, err?.message || '文档修订失败', err?.errorCode)
  }
})

// POST /campaigns/:id/creatives/generate — 异步生成创意（→ writing → creatives_ready）
app.post('/:id/creatives/generate', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid campaign ID')
  const body = await c.req.json().catch(() => ({}))
  const count = body.count ?? marketer.DEFAULT_CREATIVES_COUNT
  if (!Number.isInteger(count) || count < 1 || count > 10) {
    return badRequest(c, 'count 必须是 1-10 的整数')
  }
  let formats: string[] | undefined
  let platforms: string[] | undefined
  if (body.mode !== undefined && body.mode !== 'replace' && body.mode !== 'append') {
    return badRequest(c, 'mode 只支持 replace / append')
  }
  try {
    if (body.formats !== undefined) formats = marketer.enumArrayForRoute(body.formats, marketer.CREATIVE_FORMATS, 'formats')
    if (body.platforms !== undefined) platforms = marketer.enumArrayForRoute(body.platforms, marketer.PLATFORMS, 'platforms')
  } catch (err: any) {
    return badRequest(c, err?.message || '参数错误', err?.errorCode)
  }
  // Phase 3 recreate: ส่ง referenceId ต่อให้ service (validate ใน service → E_REFERENCE_NOT_ANALYZED)
  const referenceId = body.referenceId !== undefined ? Number(body.referenceId) : undefined
  if (referenceId !== undefined && (!Number.isInteger(referenceId) || referenceId < 1)) {
    return badRequest(c, 'referenceId ไม่ถูกต้อง')
  }
  try {
    const result = await marketer.startCreatives(id, { count, formats, platforms, mode: body.mode, referenceId })
    if (!result) return notFound(c, '活动不存在')
    return accepted(c, result.status)
  } catch (err: any) {
    return badRequest(c, err?.message || '启动创意生成失败', err?.errorCode)
  }
})

// PUT /campaigns/:id/creatives/:cid — 编辑创意
app.put('/:id/creatives/:cid', async (c) => {
  const id = requireId(c.req.param('id'))
  const cid = requireId(c.req.param('cid'))
  if (!id || !cid) return badRequest(c, 'Invalid campaign/creative ID')
  const body = await c.req.json()
  try {
    const creative = await marketer.updateCreative(id, cid, body)
    if (!creative) return notFound(c, '创意不存在')
    return success(c, creative)
  } catch (err: any) {
    return badRequest(c, err?.message || '更新创意失败', err?.errorCode)
  }
})

// DELETE /campaigns/:id/creatives/:cid — 硬删除（已 produce 的拒绝）
app.delete('/:id/creatives/:cid', async (c) => {
  const id = requireId(c.req.param('id'))
  const cid = requireId(c.req.param('cid'))
  if (!id || !cid) return badRequest(c, 'Invalid campaign/creative ID')
  try {
    const ok = await marketer.deleteCreative(id, cid)
    if (!ok) return notFound(c, '创意不存在')
    return success(c)
  } catch (err: any) {
    return badRequest(c, err?.message || '删除创意失败', err?.errorCode)
  }
})

// POST /campaigns/:id/creatives/:cid/produce — 创意 → drama + episode
app.post('/:id/creatives/:cid/produce', async (c) => {
  const id = requireId(c.req.param('id'))
  const cid = requireId(c.req.param('cid'))
  if (!id || !cid) return badRequest(c, 'Invalid campaign/creative ID')
  try {
    const result = await marketer.produceCreative(id, cid)
    if (!result) return notFound(c, '创意不存在')
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err?.message || '创意生产失败', err?.errorCode)
  }
})

export default app
