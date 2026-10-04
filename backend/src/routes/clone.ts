/**
 * Viral Clone Studio 路由 — /api/v1/clone (docs/viral-clone/PLAN.md ข้อ 3 + Notes from Agent B)
 * - JSON camelCase · async endpoints รับ `{ async: true }` → 202 + pipeline_tasks
 * - DELETE (เพิ่มจากสัญญา Agent B): บล็อกเมื่อ analyzing/rendering → 400 E_CLONE_BUSY
 * - create/update รับ `referencePath` (path จาก uploadAPI.video) — ไม่รับ multipart (Agent B ข้อ 4)
 */
import { Hono } from 'hono'
import { success, created, badRequest, notFound } from '../utils/response.js'
import type { Context } from 'hono'
import * as clone from '../services/clone.js'

const app = new Hono()

function requireId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id >= 1 ? id : null
}

function accepted(c: Context, data: unknown) {
  return c.json({ code: 202, data, message: 'accepted' }, 202)
}

// POST /clone/projects — สร้าง (transcript บังคับ; referencePath จาก upload ล่วงหน้า)
app.post('/projects', async (c) => {
  const body = await c.req.json()
  try {
    const project = await clone.createCloneProject(body)
    if (!project) return badRequest(c, 'สร้างโปรเจกต์ไม่สำเร็จ')
    return created(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างโปรเจกต์ไม่สำเร็จ', err?.errorCode)
  }
})

// GET /clone/projects — รายการ (ใหม่→เก่า)
app.get('/projects', async (c) => {
  return success(c, await clone.listCloneProjects())
})

// GET /clone/projects/:id — รายละเอียดรวม variants (frontend poll ตัวนี้ระหว่าง analyzing/rendering)
app.get('/projects/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const detail = await clone.getCloneProjectDetail(id)
  if (!detail) return notFound(c, 'โปรเจกต์ไม่พบ')
  return success(c, detail)
})

// PUT และ PATCH (PLAN ข้อ 3 เขียน PATCH, frontend ใช้ PUT — รองรับทั้งคู่, handler เดียว)
const updateHandler = async (c: any) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json()
  try {
    const project = await clone.updateCloneProject(id, body)
    if (!project) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'อัปเดตโปรเจกต์ไม่สำเร็จ', err?.errorCode)
  }
}
app.put('/projects/:id', updateHandler)
app.patch('/projects/:id', updateHandler)

// DELETE /clone/projects/:id — hard delete (บล็อกระหว่าง analyzing/rendering)
app.delete('/projects/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  try {
    const ok = await clone.deleteCloneProject(id)
    if (!ok) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c)
  } catch (err: any) {
    return badRequest(c, err?.message || 'ลบโปรเจกต์ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /clone/projects/:id/analyze — { async: true } → 202 (pattern เดียวกับ revise/analyze เดิม)
app.post('/projects/:id/analyze', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const project = await clone.analyzeCloneProject(id, { async: body.async === true })
    if (!project) return notFound(c, 'โปรเจกต์ไม่พบ')
    if (body.async === true) return accepted(c, project)
    return success(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'เริ่มวิเคราะห์ไม่สำเร็จ', err?.errorCode)
  }
})

// PUT /clone/projects/:id/blueprint — validate schema ก่อนเซฟ (ไม่ผ่าน → 400 พร้อม field ที่พัง)
app.put('/projects/:id/blueprint', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const project = await clone.saveCloneBlueprint(id, body?.blueprint ?? body)
    if (!project) return notFound(c, 'โปรเจกต์ไม่พบ')
    return success(c, project)
  } catch (err: any) {
    return badRequest(c, err?.message || 'บันทึก Blueprint ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /clone/projects/:id/variants — matrix Cartesian (cap 12 → 400 E_CLONE_MATRIX_TOO_LARGE)
app.post('/projects/:id/variants', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const variants = await clone.createCloneVariants(id, body)
    if (!variants) return notFound(c, 'โปรเจกต์ไม่พบ')
    return created(c, variants)
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างตัวแปรไม่สำเร็จ', err?.errorCode)
  }
})

// POST /clone/projects/:id/render-all — 202 + { queued }
app.post('/projects/:id/render-all', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid project ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await clone.startCloneRender({ projectId: id })
    if (!result) return notFound(c, 'โปรเจกต์ไม่พบ')
    if (body.async === false) return success(c, result)
    return accepted(c, result)
  } catch (err: any) {
    return badRequest(c, err?.message || 'เริ่ม render ไม่สำเร็จ', err?.errorCode)
  }
})

// POST /clone/variants/:id/render — 202
app.post('/variants/:id/render', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid variant ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    const result = await clone.startCloneRender({ variantId: id })
    if (!result) return notFound(c, 'ตัวแปรไม่พบ')
    const detail = await clone.getCloneVariantDetail(id)
    if (body.async === false) return success(c, detail)
    return accepted(c, detail)
  } catch (err: any) {
    return badRequest(c, err?.message || 'เริ่ม render ไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /clone/variants/:id — hard delete (บล็อกระหว่าง queued/rendering)
app.delete('/variants/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid variant ID')
  try {
    const ok = await clone.deleteCloneVariant(id)
    if (!ok) return notFound(c, 'ตัวแปรไม่พบ')
    return success(c)
  } catch (err: any) {
    return badRequest(c, err?.message || 'ลบตัวแปรไม่สำเร็จ', err?.errorCode)
  }
})

export default app
