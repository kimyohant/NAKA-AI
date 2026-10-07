/**
 * AI นักขาย 路由 — /api/v1/seller (docs/ai-seller/PLAN.md)
 * - GET /options · GET/POST /posts · GET/PUT/DELETE /posts/:id
 * - POST /posts/:id/generate — AI เขียนแคปชั่น/แฮชแท็ก/คอมเมนต์ต่อช่องทาง (sync)
 * - POST /ingest-url — ดึงข้อมูลสินค้าจากลิงก์ · GET /studio-videos — วิดีโอที่เสร็จแล้วใน Product Studio
 */
import { Hono } from 'hono'
import type { Context } from 'hono'
import { success, created, badRequest, notFound } from '../utils/response.js'
import * as seller from '../services/seller.js'

const app = new Hono()

function requireId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id >= 1 ? id : null
}

const body = async (c: Context) => c.req.json().catch(() => ({} as Record<string, unknown>))

app.get('/options', c => success(c, seller.getSellerOptions()))

app.get('/posts', async c => success(c, await seller.listPosts()))

app.post('/posts', async (c) => {
  try {
    return created(c, await seller.createPost(await body(c)))
  } catch (err: any) {
    return badRequest(c, err?.message || 'สร้างโพสต์ไม่สำเร็จ', err?.errorCode)
  }
})

app.get('/posts/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid post ID')
  const post = await seller.getPost(id)
  return post ? success(c, post) : notFound(c, 'ไม่พบโพสต์')
})

app.put('/posts/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid post ID')
  try {
    const post = await seller.updatePost(id, await body(c))
    return post ? success(c, post) : notFound(c, 'ไม่พบโพสต์')
  } catch (err: any) {
    return badRequest(c, err?.message || 'บันทึกไม่สำเร็จ', err?.errorCode)
  }
})

app.delete('/posts/:id', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid post ID')
  return (await seller.deletePost(id)) ? success(c, null) : notFound(c, 'ไม่พบโพสต์')
})

app.post('/posts/:id/generate', async (c) => {
  const id = requireId(c.req.param('id'))
  if (!id) return badRequest(c, 'Invalid post ID')
  try {
    const post = await seller.generateCopy(id, await body(c))
    return post ? success(c, post) : notFound(c, 'ไม่พบโพสต์')
  } catch (err: any) {
    return badRequest(c, err?.message || 'AI เขียนแคปชั่นไม่สำเร็จ', err?.errorCode)
  }
})

app.post('/ingest-url', async (c) => {
  const b = await body(c)
  if (typeof b.url !== 'string' || !b.url.trim()) return badRequest(c, 'url 必填')
  try {
    return success(c, await seller.ingestSellerUrl(b.url.trim()))
  } catch (err: any) {
    return badRequest(c, err?.message || 'ดึงข้อมูลสินค้าไม่สำเร็จ', err?.errorCode || 'E_INGEST_FAILED')
  }
})

app.get('/studio-videos', async c => success(c, await seller.listStudioVideos()))

export default app
