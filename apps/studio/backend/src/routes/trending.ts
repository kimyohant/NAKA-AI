/**
 * Trending Videos (Thailand) 路由 — /api/v1/trending-videos（docs/ai-marketer/TRENDING.md §4）
 * คลังเทรนด์ไทยแบบ curated อ่านอย่างเดียว — filter/sort ที่ฝั่ง service
 */
import { Hono } from 'hono'
import { success, badRequest } from '../core/http/response.js'
import { listTrendVideos } from '../services/trending.js'

const app = new Hono()

// GET /trending-videos?industry=&sort=&q= — { entries, industries, curatedAt }
app.get('/', (c) => {
  const industry = c.req.query('industry') || undefined
  const sort = c.req.query('sort') || undefined
  const q = c.req.query('q') || undefined
  try {
    return success(c, listTrendVideos({ industry, sort, q }))
  } catch (err: any) {
    return badRequest(c, err?.message || 'พารามิเตอร์ไม่ถูกต้อง', err?.errorCode)
  }
})

export default app
