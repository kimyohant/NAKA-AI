/**
 * Admin guard (middleware/admin.ts) — system-settings API belongs to the back-office app (admin/)
 * ตรวจ: กฎ path ไหนต้องเป็น admin, ปิด guard เมื่อไม่ตั้ง ADMIN_TOKEN, token ผิด/ไม่มี → 401 E_ADMIN_REQUIRED,
 * token ถูก → ผ่าน, การอ่านที่แอปผู้ใช้ต้องใช้ (รายการ AI config / style presets / ค่าส่วนตัว) ยังเปิดอยู่
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Hono } from 'hono'
import { adminGuard, assertAdminTokenConfig, needsAdmin } from '../src/middleware/admin.js'

const TOKEN = 'admin-token-for-tests-0123456789'

function makeApp() {
  const app = new Hono()
  app.use('/api/v1/*', adminGuard)
  app.all('/api/v1/*', c => c.json({ ok: true }))
  return app
}

test('needsAdmin: settings API is admin-only, app reads and user prefs stay open', () => {
  // open for the user-facing app
  assert.equal(needsAdmin('GET', '/ai-configs'), false)
  assert.equal(needsAdmin('GET', '/style-presets'), false)
  assert.equal(needsAdmin('GET', '/settings/content-language'), false)
  assert.equal(needsAdmin('PUT', '/settings/content-language'), false)
  assert.equal(needsAdmin('PUT', '/settings/tours-seen'), false)
  assert.equal(needsAdmin('POST', '/seller/posts'), false)
  assert.equal(needsAdmin('GET', '/dramas'), false)
  // back-office only
  for (const [m, p] of [
    ['POST', '/ai-configs'], ['PUT', '/ai-configs/3'], ['DELETE', '/ai-configs/3'], ['POST', '/ai-configs/test'], ['GET', '/ai-configs/3'],
    ['GET', '/ai-providers'], ['POST', '/style-presets'], ['PUT', '/style-presets/1'], ['DELETE', '/style-presets/1'],
    ['POST', '/style-presets/import-builtin'], ['GET', '/prompts'], ['PUT', '/prompts/extractor'], ['GET', '/skills'],
    ['POST', '/skills/library/x'], ['GET', '/storage'], ['POST', '/server-update/apply'], ['GET', '/admin/session'],
  ] as const) assert.equal(needsAdmin(m, p), true, `${m} ${p}`)
  // prefix must be a whole segment
  assert.equal(needsAdmin('GET', '/skillsx'), false)
  assert.equal(needsAdmin('GET', '/ai-configs/'), false) // trailing slash = the list
})

test('guard off when ADMIN_TOKEN is unset (dev/desktop keep working)', async () => {
  delete process.env.ADMIN_TOKEN
  const res = await makeApp().request('/api/v1/ai-configs', { method: 'POST' })
  assert.equal(res.status, 200)
})

test('guard on: missing/wrong token → 401 E_ADMIN_REQUIRED; right token → through; app reads stay open', async () => {
  process.env.ADMIN_TOKEN = TOKEN
  const app = makeApp()
  const denied = await app.request('/api/v1/prompts')
  assert.equal(denied.status, 401)
  assert.equal((await denied.json()).errorCode, 'E_ADMIN_REQUIRED')
  assert.equal((await app.request('/api/v1/ai-configs/1', { method: 'PUT', headers: { 'X-Admin-Token': 'wrong' } })).status, 401)
  assert.equal((await app.request('/api/v1/ai-configs/1', { method: 'PUT', headers: { 'X-Admin-Token': TOKEN } })).status, 200)
  assert.equal((await app.request('/api/v1/admin/session', { headers: { 'X-Admin-Token': TOKEN } })).status, 200)
  assert.equal((await app.request('/api/v1/ai-configs')).status, 200)
  assert.equal((await app.request('/api/v1/style-presets')).status, 200)
  assert.equal((await app.request('/api/v1/settings/tours-seen', { method: 'PUT' })).status, 200)
  assert.equal((await app.request('/api/v1/prompts', { method: 'OPTIONS' })).status, 200) // CORS preflight
  delete process.env.ADMIN_TOKEN
})

test('weak ADMIN_TOKEN is rejected at startup', () => {
  process.env.ADMIN_TOKEN = 'short'
  assert.throws(() => assertAdminTokenConfig(), /at least 16/)
  process.env.ADMIN_TOKEN = TOKEN
  assert.doesNotThrow(() => assertAdminTokenConfig())
  delete process.env.ADMIN_TOKEN
})
