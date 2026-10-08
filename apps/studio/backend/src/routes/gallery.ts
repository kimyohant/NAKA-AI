/**
 * Creative Gallery 路由 — /api/v1/gallery（docs/ai-marketer/GALLERY.md §3）
 * อ่านรวมผลงานทุกแคมเปญ + upsert/ลบผลตอบรับต่อ creative (manual analytics — ผู้ใช้กรอกเอง)
 */
import { Hono } from 'hono'
import { success, badRequest, notFound } from '../utils/response.js'
import * as gallery from '../services/gallery.js'

const app = new Hono()

function requireId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id >= 1 ? id : null
}

// GET /gallery — { entries, summary }
app.get('/', async (c) => {
  return success(c, await gallery.listGalleryEntries())
})

// PUT /gallery/creatives/:cid/result — upsert ผลตอบรับ (1:1 ต่อ creative)
app.put('/creatives/:cid/result', async (c) => {
  const cid = requireId(c.req.param('cid'))
  if (!cid) return badRequest(c, 'Invalid creative ID')
  const body = await c.req.json().catch(() => ({}))
  try {
    return success(c, await gallery.upsertCreativeResult(cid, body))
  } catch (err: any) {
    if (err?.errorCode === 'E_INVALID_FIELD' && /ไม่มีอยู่/.test(err?.message || '')) {
      return notFound(c, err.message, err.errorCode)
    }
    return badRequest(c, err?.message || 'บันทึกผลตอบรับไม่สำเร็จ', err?.errorCode)
  }
})

// DELETE /gallery/creatives/:cid/result — ลบผลตอบรับ (ไม่แตะ creative)
app.delete('/creatives/:cid/result', async (c) => {
  const cid = requireId(c.req.param('cid'))
  if (!cid) return badRequest(c, 'Invalid creative ID')
  const ok = await gallery.deleteCreativeResult(cid)
  if (!ok) return notFound(c, 'ไม่พบผลตอบรับของ creative นี้')
  return success(c)
})

export default app
