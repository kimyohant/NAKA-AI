import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import path from 'path'
import { timingSafeEqual } from 'node:crypto'
import { fileURLToPath } from 'url'

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
import studio from './routes/studio.js'
import storage from './routes/storage.js'
import serverUpdate from './routes/serverUpdate.js'
import { requestLogger, errorHandler } from './middleware/logger.js'
import { failStaleRunningTasks } from './services/pipeline-tasks.js'
import { failStaleCampaigns } from './services/marketer.js'
import { failStaleStudioProjects } from './services/studio.js'
import { recoverGenerationTasks } from './services/generation.js'
import { DATA_ROOT } from './utils/paths.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '../..')

const app = new Hono()
const hostname = process.env.NAKA_HOST || '127.0.0.1'
const authUser = process.env.NAKA_AUTH_USER || 'admin'
const authPassword = process.env.NAKA_AUTH_PASSWORD || ''
const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(hostname)
if (!isLoopback && !authPassword) {
  throw new Error('NAKA_AUTH_PASSWORD is required when NAKA_HOST is not loopback')
}

function matchesCredential(actual: string, expected: string): boolean {
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Middleware
app.use('*', async (c, next) => {
  if (!authPassword || c.req.path === '/api/v1/health' || c.req.method === 'OPTIONS') return next()
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
const api = new Hono()
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
api.route('/studio', studio)
api.route('/server-update', serverUpdate)

app.route('/api/v1', api)

// Serve static files (storage)
// 生成的图片/视频按 uuid 命名、内容不变，标记为 immutable 让浏览器长缓存
app.use('/static/*', async (c, next) => {
  await next()
  if (c.res.ok) c.header('Cache-Control', 'public, max-age=31536000, immutable')
})
app.use('/static/*', serveStatic({ root: DATA_ROOT }))

// Serve frontend (production build) — 桌面版由主进程注入 FRONTEND_DIST（resources/frontend）
const distPath = process.env.FRONTEND_DIST || path.join(projectRoot, 'frontend', 'dist')
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

serve({ fetch: app.fetch, port, hostname })
