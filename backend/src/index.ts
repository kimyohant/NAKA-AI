import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'url'
import { existsSync } from 'node:fs'

import dramas from './routes/dramas.js'
import episodes from './routes/episodes.js'
import storyboards from './routes/storyboards.js'
import scenes from './routes/scenes.js'
import characters from './routes/characters.js'
import tasks from './routes/tasks.js'
import upload from './routes/upload.js'
import aiConfigs, { aiProviders } from './routes/aiConfigs.js'
import stylePresets from './routes/stylePresets.js'
import prompts from './routes/prompts.js'
import agent from './routes/agent.js'
import merge from './routes/merge.js'
import skills from './routes/skills.js'
import props from './routes/props.js'
import settings from './routes/settings.js'
import campaigns from './routes/campaigns.js'
import trending from './routes/trending.js'
import gallery from './routes/gallery.js'
import studio from './routes/studio.js'
import clone from './routes/clone.js'
import live from './routes/live.js'
import seller from './routes/seller.js'
import social from './routes/social.js'
import storage from './routes/storage.js'
import serverUpdate from './routes/serverUpdate.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { adminGuard, assertAdminTokenConfig, guardOn, isAdminRequest } from './middleware/admin.js'
import nakaSso, { requireSession, ssoConfig, ssoEnabled } from './auth/naka-sso.js'
import { ownership } from './auth/ownership.js'
import { failStaleRunningTasks } from './services/pipeline-tasks.js'
import { failStaleCampaigns } from './services/marketer.js'
import { failStaleStudioProjects } from './services/studio.js'
import { failStaleCloneAnalyzes, resumeStaleCloneRenders } from './services/clone.js'
import { resumeStaleAutoRenders } from './services/studio-autorender.js'
import { resumeSellerVideos } from './services/seller.js'
import { recoverGenerationTasks } from './services/generation.js'
import { startSocialPoller } from './services/social/poller.js'
import './services/social/facebook.js' // registers the `facebook` adapter
import { DATA_ROOT } from './utils/paths.js'

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
// back-office app (admin/) hosted on another origin: comma-separated origins
const adminOrigins = (process.env.ADMIN_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean)

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
  origin: ['http://localhost:3013', 'http://localhost:5679', 'http://localhost:3014', ...adminOrigins],
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
app.use('/api/v1/*', requireSession(() => ['http://localhost:3013', 'http://localhost:3014', ...adminOrigins], isAdminRequest))
app.use('/api/v1/*', ownership)
app.use('/api/v1/*', adminGuard)
const api = new Hono()
// back-office login check: 401 E_ADMIN_REQUIRED unless the token is valid (guard off → always ok)
api.get('/admin/session', c => c.json({ code: 200, data: { admin: true, guard: guardOn(), sso: ssoEnabled() }, message: 'success' }))
api.route('/auth/naka', nakaSso)
api.route('/dramas', dramas)
api.route('/episodes', episodes)
api.route('/storyboards', storyboards)
api.route('/scenes', scenes)
api.route('/characters', characters)
api.route('/tasks', tasks)
api.route('/upload', upload)
api.route('/ai-configs', aiConfigs)
api.route('/ai-providers', aiProviders)
api.route('/style-presets', stylePresets)
api.route('/prompts', prompts)
api.route('/agent', agent)
api.route('/merge', merge)
api.route('/skills', skills)
api.route('/props', props)
api.route('/storage', storage)
api.route('/settings', settings)
api.route('/campaigns', campaigns)
api.route('/trending-videos', trending)
api.route('/gallery', gallery)
api.route('/studio', studio)
api.route('/clone', clone)
api.route('/live', live)
api.route('/seller', seller)
api.route('/social', social)
api.route('/server-update', serverUpdate)

app.route('/api/v1', api)

// Serve static files (storage)
// 生成的图片/视频按 uuid 命名、内容不变，标记为 immutable 让浏览器长缓存
app.use('/static/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('/static/*', serveStatic({ root: DATA_ROOT }))

// Back-office build (admin/ in this repo, built with base /admin/) at /admin —
// ADMIN_DIST overrides; default admin/.output/public when it has been built
const defaultAdminDist = path.join(projectRoot, 'admin', '.output', 'public')
const adminDist = process.env.ADMIN_DIST || (existsSync(defaultAdminDist) ? defaultAdminDist : '')
if (adminDist) {
  const toAdminFile = (p: string) => p.replace(/^\/admin/, '') || '/'
  app.get('/admin', c => c.redirect('/admin/'))
  app.use('/admin/*', serveStatic({ root: adminDist, rewriteRequestPath: toAdminFile }))
  app.get('/admin/*', serveStatic({ root: adminDist, path: 'index.html' }))
}

// Serve the user-facing frontend (`npm run generate`) — FRONTEND_DIST overrides
// (desktop: main process injects resources/frontend; Docker: /app/frontend-dist).
// Default: frontend/dist (published by scripts/redeploy.ps1), else frontend/.output/public.
const publishedDist = path.join(projectRoot, 'frontend', 'dist')
const distPath = process.env.FRONTEND_DIST
  || (existsSync(publishedDist) ? publishedDist : path.join(projectRoot, 'frontend', '.output', 'public'))
app.use('*', serveStatic({ root: distPath }))
app.get('*', serveStatic({ root: distPath, path: 'index.html' }))

const port = Number(process.env.PORT || 5679)
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

// 同理：AI Marketer 活动 *ing 状态（researching/strategizing/writing）重启后不可能还在跑
try {
  const n = await failStaleCampaigns()
  if (n > 0) console.log(`🔁 已清理 ${n} 个中断的 campaign 任务`)
} catch (err: any) {
  console.error('清理中断 campaign 任务失败:', err?.message)
}

// 同理：Product Studio scripting ค้างหลัง restart
try {
  const n = await failStaleStudioProjects()
  if (n > 0) console.log(`🔁 已清理 ${n} 个中断的 studio 任务`)
} catch (err: any) {
  console.error('清理中断 studio 任务失败:', err?.message)
}

// Viral Clone: analyzing ค้างที่ pipeline row หายแล้ว → error (failStaleRunningTasks เคลียร์ row ก่อนหน้านี้แล้ว)
try {
  const n = await failStaleCloneAnalyzes()
  if (n > 0) console.log(`🔁 已清理 ${n} 个中断的 clone 分析任务`)
} catch (err: any) {
  console.error('清理中断 clone analyze 失败:', err?.message)
}

// Phase 2: auto-render pipeline ค้างหลัง restart — วิ่งต่อจาก stage เดิม (recover งาน provider แล้ว)
try {
  const n = await resumeStaleAutoRenders()
  if (n > 0) console.log(`🔁 resumed ${n} studio auto-render pipelines`)
} catch (err: any) {
  console.error('resume studio auto-render failed:', err?.message)
}

// AI นักขาย: โพสต์ที่รอวิดีโอจากคลังสกิล — วน driver ต่อ (หลัง auto-render resume แล้ว)
try {
  const n = await resumeSellerVideos()
  if (n > 0) console.log(`🔁 resumed ${n} seller video jobs`)
} catch (err: any) {
  console.error('resume seller videos failed:', err?.message)
}

// Viral Clone: render batch ค้างหลัง restart — driver วนเก็บ variant queued ต่อ (sys_task recover แล้ว)
try {
  const n = await resumeStaleCloneRenders()
  if (n > 0) console.log(`🔁 resumed ${n} clone render pipelines`)
} catch (err: any) {
  console.error('resume clone render failed:', err?.message)
}

// Social Auto Reply poller: one timer, first round right after boot, no-op
// when no Social Account is connected and watching.
startSocialPoller()

serve({ fetch: app.fetch, port, hostname })
