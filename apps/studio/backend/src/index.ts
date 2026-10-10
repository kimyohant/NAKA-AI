import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'url'
import { existsSync } from 'node:fs'

import tasks from './core/routes/tasks.js'
import upload from './core/routes/upload.js'
import aiConfigs, { aiProviders } from './core/routes/aiConfigs.js'
import stylePresets from './core/routes/stylePresets.js'
import prompts from './core/routes/prompts.js'
import agent from './core/routes/agent.js'
import skills from './core/routes/skills.js'
import settings from './core/routes/settings.js'
import system from './core/routes/system.js'
import { requestLogger, errorHandler } from './core/http/logger.js'
import { adminGuard, assertAdminTokenConfig, guardOn, isAdminRequest } from './core/auth/admin.js'
import nakaSso, { requireSession, ssoConfig, ssoEnabled } from './core/auth/naka-sso.js'
import { ownership } from './core/auth/ownership.js'
import { entitlementGuard } from './core/auth/entitlements.js'
import { failStaleRunningTasks } from './core/tasks/pipeline-tasks.js'
import { recoverGenerationTasks } from './core/generation/generation.js'
import { studioModules, recoverModules } from './modules.js'
import { DATA_ROOT } from './core/utils/paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()
const hostname = process.env.NAKA_HOST || '127.0.0.1'
const authUser = process.env.NAKA_AUTH_USER || 'admin'
const authPassword = process.env.NAKA_AUTH_PASSWORD || ''
const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(hostname)
ssoConfig() // throws on a half/invalid NAKA_SSO_URL / NAKA_SSO_SECRET instead of silently running open
if (!isLoopback && !authPassword && !ssoEnabled()) {
  throw new Error('NAKA_AUTH_PASSWORD (or naka-ai SSO: NAKA_SSO_URL + NAKA_SSO_SECRET) is required when NAKA_HOST is not loopback')
}
assertAdminTokenConfig()
if (!isLoopback && !guardOn()) {
  console.warn('⚠️ ADMIN_TOKEN is not set — the settings API (AI keys, models, prompts) is open to every signed-in user')
}

function matchesCredential(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Middleware
app.use('*', async (c, next) => {
  // members sign in through naka-ai SSO instead of the shared Basic Auth (requireSession below)
  if (!authPassword || ssoEnabled() || c.req.path === '/api/v1/health' || c.req.method === 'OPTIONS') return next()
  if (isAdminRequest(c)) return next() // admin token is a stronger credential than the shared Basic Auth
  const header = c.req.header('Authorization') || ''
  let username = ''
  let password = ''
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const separator = decoded.indexOf(':')
    if (separator >= 0) {
      username = decoded.slice(0, separator)
      password = decoded.slice(separator + 1)
    }
  }
  if (!matchesCredential(username, authUser) || !matchesCredential(password, authPassword)) {
    c.header('WWW-Authenticate', 'Basic realm="NAKA-AI"')
    return c.text('Authentication required', 401)
  }
  return next()
})
app.use('*', cors({
  origin: ['http://localhost:3013', 'http://localhost:5679'],
  allowHeaders: ['Content-Type', 'Authorization', 'X-Admin-Token'],
  credentials: true,
}))
app.use('*', requestLogger)
app.use('*', errorHandler)

// Health check（version 供部署巡检/更新检查核对当前运行版本）
app.get('/api/v1/health', (c) => c.json({
  status: 'ok',
  version: process.env.NAKA_VERSION || undefined,
  timestamp: new Date().toISOString(),
}))

// API routes
// members (naka-ai SSO) → each member's own data (auth/ownership.ts) → system-settings API for admins only (middleware/admin.ts)
app.use('/api/v1/*', requireSession(() => ['http://localhost:3013'], isAdminRequest))
app.use('/api/v1/*', ownership)
// menus outside the member's plan → 403 E_FEATURE_DISABLED (core/auth/entitlements.ts, docs/entitlements.md)
app.use('/api/v1/*', entitlementGuard)
app.use('/api/v1/*', adminGuard)
const api = new Hono()
// back-office login check: 401 E_ADMIN_REQUIRED unless the token is valid (guard off → always ok)
api.get('/admin/session', c => c.json({ code: 200, data: { admin: true, guard: guardOn(), sso: ssoEnabled() }, message: 'success' }))
api.route('/auth/naka', nakaSso)
// shared (core) routes — used by every menu
api.route('/tasks', tasks)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/style-presets', stylePresets)
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/skills', skills)
api.route('/settings', settings)
// version, disk use and video queues for the naka-ai back office (/admin/studio-system/), admins only
api.route('/system', system)
// product menus (drama, marketer, product-studio, seller, viral-clone, live, social) — src/modules.ts
for (const m of studioModules) m.mount(api)

app.route('/api/v1', api)

// Serve static files (storage)
// 生成的图片/视频按 uuid 命名、内容不变，标记为 immutable 让浏览器长缓存
app.use('/static/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('/static/*', serveStatic({ root: DATA_ROOT }))

// System settings used to be a separate back-office app at /admin; they are /settings in the app now.
// Old links and bookmarks keep working, including the section: /admin/?tab=styles → /settings?tab=styles
app.get('/admin', c => c.redirect(settingsPath(c.req.query('tab')), 301))
app.get('/admin/*', c => c.redirect(settingsPath(c.req.query('tab')), 301))

// Serve the user-facing frontend (`npm run generate`) — FRONTEND_DIST overrides
// (desktop: main process injects resources/frontend; Docker: /app/frontend-dist).
// Default: frontend/dist (published by scripts/redeploy.ps1), else frontend/.output/public.
const publishedDist = path.join(projectRoot, 'frontend', 'dist')
const distPath = process.env.FRONTEND_DIST
  || (existsSync(publishedDist) ? publishedDist : path.join(projectRoot, 'frontend', '.output', 'public'))
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

const port = Number(process.env.PORT || 5679)

function settingsPath(tab?: string): string {
  return tab && /^[a-z]{2,20}$/.test(tab) ? `/settings?tab=${tab}` : '/settings'
}
console.log(`🚀 NAKA-AI server on http://${hostname}:${port}`)

try {
  const counts = await recoverGenerationTasks()
  console.log('🔁 Generation task recovery:', counts)
} catch (err: any) {
  console.error('Generation task recovery failed:', err?.message)
}

// 同理：agent pipeline 任务（提取/视频提示词批量）的 running 行
try {
  const n = await failStaleRunningTasks()
  if (n > 0) console.log(`🔁 已清理 ${n} 个中断的 pipeline 任务`)
} catch (err: any) {
  console.error('清理中断 pipeline 任务失败:', err?.message)
}

// Each menu's startup recovery (src/modules.ts): every failStale first (marketer campaigns,
// product-studio scripting, viral-clone analyzes stuck in *ing states), then every resume in
// module order (product-studio auto-render → seller videos → viral-clone renders).
await recoverModules('failStale')
await recoverModules('resume')
// background work a menu keeps running (the Social Auto Reply poller)
for (const m of studioModules) m.start?.()

serve({ fetch: app.fetch, port, hostname })
