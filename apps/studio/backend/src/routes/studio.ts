/**
 * Product Studio 路由 — /api/v1/studio (docs/product-studio/PLAN.md ข้อ 4)
 * Response helper เดิม; ความผิดพลาดทางธุรกิจส่ง errorCode (E_STUDIO_*, E_AVATAR_REQUIRED, ...)
 */
import { Hono } from 'hono'
import { success, created, badRequest, notFound } from '../core/http/response.js'
import * as studio from '../services/studio.js'
import * as influencerService from '../services/studio-influencer.js'
import { startAutoRender, cancelAutoRender } from '../services/studio-autorender.js'

const app = new Hono()

function requireId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id >= 1 ? id : null
}

// GET /studio/options — languages / markets / platforms + videoProvider capabilities (frontend ห้าม hardcode ซ้ำ)
app.get('/options', async (c) => {
  return success(c, {
    ...studio.getStudioOptions(),
    videoProvider: await studio.getActiveVideoProviderInfo(),
  })
})

// GET /studio/templates — Creative Gallery (12 เทมเพลต)
app.get('/templates', (c) => {
  return success(c, studio.getStudioTemplates())
})

// GET /studio/projects — list (ใหม่→เก่า)
app.get('/projects', async (c) => {
  return success(c, await studio.listProjects())
})

// POST /studio/projects — สร้าง (ต้องมี productName/productUrl + templateId)
app.post('/projects', async (c) => {
  const body = await c.req.json()
  try {
    const project = await studio.createProject(body)
    if (!project) return badRequest(c, 'สร้างโปรเจกต์ไม่สำเร็จ')
    return created(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างโปรเจกต์ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/ingest-url — SSRF-safe product ingest (service เดียวกับ Marketer)
app.post('/ingest-url', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  if (typeof body.url !== 'string' || !body.url.trim()) return badRequest(c, 'url 必填')
  try {
    return success(c, await studio.ingestStudioUrl(body.url.trim()))
  } catch (err: any) {
    return badRequest(c, err?.message || '产品页抓取失败', err?.errorCode || 'E_INGEST_FAILED')
  }
})

// POST /studio/projects/from-campaign — Marketer → Studio bridge
app.post('/projects/from-campaign', async (c) => {
  const body = await c.req.json()
  try {
    const project = await studio.createProjectFromCampaign(body)
    if (!project) return badRequest(c, 'สร้างโปรเจกต์ไม่สำเร็จ')
    return created(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างโปรเจกต์จาก campaign ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/projects/:id/auto-render — เริ่ม pipeline keyframes → videos → merge (202)
app.post('/projects/:id/auto-render', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const project = await startAutoRender(id, { force: !!body.force })
    if (!project) return notFound(c, 'โปรเจกต์ไม่พบ')
    return c.json({ code: 202, data: project, message: 'accepted' }, 202)
  } catch (err: any) {
    return badRequest(c, err?.message || 'เริ่ม auto-render ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/projects/:id/auto-render/cancel — งานที่ส่งแล้วปล่อยจบเอง ไม่ส่งเพิ่ม
app.post('/projects/:id/auto-render/cancel', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const project = await cancelAutoRender(id)
  if (!project) return notFound(c, 'โปรเจกต์ไม่พบ')
  return success(c, project)
})

// GET /studio/projects/:id — project + shots + images + latestMerge + avatar
app.get('/projects/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const detail = await studio.getProjectDetail(id)
  if (!detail) return notFound(c, 'โปรเจกต์ไม่พบ')
  return success(c, detail)
})

// PUT /studio/projects/:id
app.put('/projects/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json()
  try {
    const project = await studio.updateProject(id, body)
    if (!project) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'อัปเดตโปรเจกต์ไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /studio/projects/:id — soft delete (drama ที่ผูกไว้ไม่ลบ)
app.delete('/projects/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const ok = await studio.deleteProject(id)
  if (!ok) return notFound(c, 'โปรเจกต์ไม่พบ')
  return success(c)
})

// POST /studio/projects/:id/script — async เขียน shot list (review_director) → script_ready
app.post('/projects/:id/script', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await studio.startStudioScript(id, { instruction: typeof body.instruction === 'string' ? body.instruction : undefined })
    if (!result) return notFound(c, 'โปรเจกต์ไม่พบ')
    return c.json({ code: 202, data: { status: result.status }, message: 'accepted' }, 202)
  } catch (err: any) {
    return badRequest(c, err?.message || 'เริ่มเขียนบทไม่สำเร็จ', err?.errorCode)
  }
})

// PUT /studio/projects/:id/shots/:shotId — แก้บทพูด/ภาพ/ความยาว (prompts สร้างใหม่ deterministic)
app.put('/projects/:id/shots/:shotId', async (c) => {
  const id = requireId(c.req.param('id'))
  const shotId = requireId(c.req.param('shotId'))
  if (!id || !shotId) return badRequest(c, 'Invalid project/shot ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const shot = await studio.updateShot(id, shotId, body)
    if (!shot) return notFound(c, 'ช็อตไม่พบ')
    return success(c, shot)
  } catch (err: any) {
    return badRequest(c, err?.message || 'อัปเดตช็อตไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/projects/:id/render — { stage: 'keyframes' | 'videos', shotIds? } → { queued }
app.post('/projects/:id/render', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await studio.renderStage(id, body)
    if (!result) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c, result)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างสื่อไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/projects/:id/merge — ต่อวิดีโอทุกช็อต (FFmpeg เดิม)
app.post('/projects/:id/merge', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  try {
    const merge = await studio.mergeProject(id)
    if (!merge) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c, merge)
  } catch (err: any) {
    return badRequest(c, err?.message || 'ต่อวิดีโอไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/projects/:id/images/generate — ภาพสินค้า packshot/lifestyle/on_model/banner
app.post('/projects/:id/images/generate', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const images = await studio.generateProjectImages(id, body)
    if (!images) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c, images)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างภาพไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /studio/projects/:id/images/:imageId
app.delete('/projects/:id/images/:imageId', async (c) => {
  const id = requireId(c.req.param('id'))
  const imageId = requireId(c.req.param('imageId'))
  if (!id || !imageId) return badRequest(c, 'Invalid project/image ID')
  const ok = await studio.deleteProjectImage(id, imageId)
  if (!ok) return notFound(c, 'ภาพไม่พบ')
  return success(c)
})

// POST /studio/projects/:id/images/:imageId/promote — ต่อท้าย productImages
app.post('/projects/:id/images/:imageId/promote', async (c) => {
  const id = requireId(c.req.param('id'))
  const imageId = requireId(c.req.param('imageId'))
  if (!id || !imageId) return badRequest(c, 'Invalid project/image ID')
  try {
    const project = await studio.promoteProjectImage(id, imageId)
    if (!project) return notFound(c, 'ภาพไม่พบ')
    return success(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'promote ภาพไม่สำเร็จ', err?.errorCode)
  }
})

// GET /studio/avatars — คลัง avatar
app.get('/avatars', async (c) => {
  return success(c, await studio.listAvatars())
})

// POST /studio/avatars — สร้าง (imageUrl จาก uploadAPI เดิม หรือให้ AI สร้างภายหลัง)
app.post('/avatars', async (c) => {
  const body = await c.req.json()
  try {
    const avatar = await studio.createAvatar(body)
    return created(c, avatar)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้าง avatar ไม่สำเร็จ', err?.errorCode)
  }
})

// PUT /studio/avatars/:id
app.put('/avatars/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid avatar ID')
  const body = await c.req.json()
  try {
    const avatar = await studio.updateAvatar(id, body)
    if (!avatar) return notFound(c, 'Avatar ไม่พบ')
    return success(c, avatar)
  } catch (err: any) {
    return badRequest(c, err?.message || 'อัปเดต avatar ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/avatars/:id/generate-image — AI สร้างภาพ avatar (portrait ครึ่งตัว)
app.post('/avatars/:id/generate-image', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid avatar ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const avatar = await studio.generateAvatarImage(id, body)
    if (!avatar) return notFound(c, 'Avatar ไม่พบ')
    return success(c, avatar)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างภาพ avatar ไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /studio/avatars/:id — soft delete (โปรเจกต์ที่ใช้อยู่เก็บ id เดิม GET คืน null)
app.delete('/avatars/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid avatar ID')
  const ok = await studio.deleteAvatar(id)
  if (!ok) return notFound(c, 'Avatar ไม่พบ')
  return success(c)
})

// ===== AI Influencer (v14) — คลังพรีเซนเตอร์ AI สำหรับรีวิวสินค้า =====

// GET /studio/influencers — คลัง influencer
app.get('/influencers', async (c) => {
  return success(c, await influencerService.listInfluencers())
})

// POST /studio/influencers — สร้าง (imageUrl จาก uploadAPI หรือให้ AI สร้าง portrait ภายหลัง)
app.post('/influencers', async (c) => {
  const body = await c.req.json()
  try {
    return created(c, await influencerService.createInfluencer(body))
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้าง influencer ไม่สำเร็จ', err?.errorCode)
  }
})

// PUT /studio/influencers/:id
app.put('/influencers/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid influencer ID')
  const body = await c.req.json()
  try {
    const influencer = await influencerService.updateInfluencer(id, body)
    if (!influencer) return notFound(c, 'Influencer ไม่พบ')
    return success(c, influencer)
  } catch (err: any) {
    return badRequest(c, err?.message || 'อัปเดต influencer ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/influencers/:id/generate-image — AI สร้าง portrait (มีรูปอยู่แล้ว → ใช้เป็น reference คุมหน้าเดิม)
app.post('/influencers/:id/generate-image', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid influencer ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const influencer = await influencerService.generateInfluencerPortrait(id, body)
    if (!influencer) return notFound(c, 'Influencer ไม่พบ')
    return success(c, influencer)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างภาพ influencer ไม่สำเร็จ', err?.errorCode)
  }
})

// GET /studio/influencers/:id/contents — ภาพรีวิว + สคริปต์รีวิวทั้งหมด
app.get('/influencers/:id/contents', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid influencer ID')
  return success(c, await influencerService.listInfluencerContents(id))
})

// POST /studio/influencers/:id/contents/images — ภาพรีวิวสินค้า per scene (influencer × สินค้า, reference คุมหน้า/สินค้า)
app.post('/influencers/:id/contents/images', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid influencer ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const images = await influencerService.generateReviewImages(id, body)
    if (!images) return notFound(c, 'Influencer ไม่พบ')
    return success(c, images)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างภาพรีวิวไม่สำเร็จ', err?.errorCode)
  }
})

// POST /studio/influencers/:id/contents/script — async สคริปต์รีวิวสั้น (influencer_writer) → poll GET contents
app.post('/influencers/:id/contents/script', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid influencer ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const content = await influencerService.generateReviewScript(id, body)
    if (!content) return notFound(c, 'Influencer ไม่พบ')
    return success(c, content)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างสคริปต์รีวิวไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /studio/influencers/:id/contents/:contentId
app.delete('/influencers/:id/contents/:contentId', async (c) => {
  const id = requireId(c.req.param('id'))
  const contentId = requireId(c.req.param('contentId'))
  if (!id || !contentId) return badRequest(c, 'Invalid influencer/content ID')
  const ok = await influencerService.deleteInfluencerContent(id, contentId)
  if (!ok) return notFound(c, 'คอนเทนต์ไม่พบ')
  return success(c)
})

// DELETE /studio/influencers/:id — soft delete (โปรเจกต์ที่ใช้อยู่เก็บ id เดิม GET คืน null)
app.delete('/influencers/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid influencer ID')
  const ok = await influencerService.deleteInfluencer(id)
  if (!ok) return notFound(c, 'Influencer ไม่พบ')
  return success(c)
})

export default app
