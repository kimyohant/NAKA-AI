/**
 * AI Marketer quick start — /api/v1/marketer (ย้ายจาก naka-ai studio 05)
 * GET /catalog · GET/POST /insights · GET/DELETE /insights/:id
 */
import { Hono } from 'hono'
import { success, notFound, badRequest } from '../../../core/http/response.js'
import * as quick from '../services/marketer-quick.js'

const app = new Hono()

function requireId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id >= 1 ? id : null
}

app.get('/catalog', (c) => success(c, quick.quickCatalog()))

app.get('/insights', async (c) => success(c, await quick.listInsights()))

// 202: รายงานเขียนเบื้องหลัง — หน้าบ้าน poll GET /insights/:id จน status ไม่ใช่ processing
app.post('/insights', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  try {
    const insight = await quick.createInsight(body)
    return c.json({ code: 202, data: insight, message: 'accepted' }, 202)
  } catch (err: any) {
    // E_NO_TEXT_MODEL / E_INVALID_FIELD → 400 + errorCode (หน้าบ้านแปลด้วย toastError)
    return badRequest(c, err?.message || 'สร้างงานวิเคราะห์ไม่สำเร็จ', err?.errorCode)
  }
})

app.get('/insights/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  const insight = id ? await quick.getInsight(id) : null
  return insight ? success(c, insight) : notFound(c, 'ไม่พบงานวิเคราะห์นี้')
})

app.delete('/insights/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  return id && await quick.deleteInsight(id) ? success(c, { deleted: true }) : notFound(c, 'ไม่พบงานวิเคราะห์นี้')
})

export default app
