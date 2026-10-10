/**
 * GET /api/v1/system/overview — what the naka-ai back office (/admin/studio-system/ on the landing app)
 * shows about this studio: version, disk use, and the per-provider video queues. Admin only
 * (core/auth/admin.ts); the landing app calls it server to server with ADMIN_TOKEN.
 *
 * Replaces the in-app "storage" and "about & update" settings tabs, which belonged to the retired desktop
 * app (moving the data folder, a self-updater, Watchtower). Updating a Docker deploy is `git pull` +
 * `docker compose up -d --build`, so there is nothing to trigger from here.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Hono } from 'hono'
import { DATA_ROOT } from '../utils/paths.js'
import { rawQuery } from '../db/index.js'
import { dirUsage, volumeFreeBytes } from '../utils/dirsize.js'
import { badRequest, success } from '../http/response.js'

const app = new Hono()

function currentVersion(): string {
  if (process.env.NAKA_VERSION) return process.env.NAKA_VERSION.replace(/^v/, '')
  try {
    const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../package.json')
    return JSON.parse(readFileSync(pkg, 'utf-8')).version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// ---------- disk use: walking the data folder is slow, so cache it for a minute ----------
const USAGE_TTL_MS = 60_000
interface UsageCache {
  usage: Awaited<ReturnType<typeof dirUsage>> | null
  computedAt: string | null
  computing: boolean
}
const cache: UsageCache = { usage: null, computedAt: null, computing: false }

async function computeUsage() {
  if (cache.computing) return
  cache.computing = true
  try {
    const usage = await dirUsage(DATA_ROOT)
    // the database is PostgreSQL: count this app's schema (tables + indexes + TOAST)
    const [size] = await rawQuery(`SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relkind = 'r'`)
    usage.db = Number(size?.bytes ?? 0)
    usage.total += usage.db
    cache.usage = usage
    cache.computedAt = new Date().toISOString()
  } finally {
    cache.computing = false
  }
}

const warmup = setTimeout(() => { void computeUsage() }, 10_000)
warmup.unref?.()

/** Usage, never older than a minute when it is answered from a fresh computation; a stale value is
 * answered at once while it is recomputed in the background. */
async function storageInfo() {
  const fresh = cache.computedAt && (Date.now() - new Date(cache.computedAt).getTime()) < USAGE_TTL_MS
  let stale = false
  if (!fresh) {
    if (cache.usage) { stale = true; void computeUsage() } else await computeUsage()
  }
  return { usage: cache.usage, stale: stale || cache.computing, computedAt: cache.computedAt, freeBytes: await volumeFreeBytes(DATA_ROOT) }
}

// ---------- video queues: one row per configured video provider ----------
const STUCK_LIST_LIMIT = 20

async function videoQueues() {
  const [counts, stuck] = await Promise.all([
    rawQuery(`SELECT c.id AS config_id, c.name, c.provider,
        COUNT(t.id) FILTER (WHERE t.status = 'queued')::int AS queued,
        COUNT(t.id) FILTER (WHERE t.status IN ('submitting', 'processing'))::int AS running,
        COUNT(t.id) FILTER (WHERE t.status = 'unknown')::int AS unknown,
        COUNT(t.id) FILTER (WHERE t.status = 'completed' AND t.completed_at >= $1)::int AS completed_24h,
        COUNT(t.id) FILTER (WHERE t.status = 'failed' AND t.updated_at >= $1)::int AS failed_24h
      FROM ai_service_configs c
      LEFT JOIN sys_task t ON t.config_id = c.id AND t.type = 'video'
      WHERE c.service_type = 'video'
      GROUP BY c.id, c.name, c.provider
      ORDER BY c.id`, [new Date(Date.now() - 86_400_000).toISOString()]),
    // tasks an admin may need to act on: unknown ones hold their provider's slot until cancelled
    rawQuery(`SELECT id, config_id, status, storyboard_id, drama_id, error_msg, created_at, updated_at
      FROM sys_task WHERE type = 'video' AND status IN ('unknown', 'queued')
      ORDER BY (status = 'unknown') DESC, created_at ASC LIMIT ${STUCK_LIST_LIMIT}`),
  ])
  return counts.map(row => ({
    configId: Number(row.config_id),
    name: row.name,
    provider: row.provider,
    queued: Number(row.queued),
    running: Number(row.running),
    unknown: Number(row.unknown),
    completed24h: Number(row.completed_24h),
    failed24h: Number(row.failed_24h),
    waiting: stuck.filter(t => Number(t.config_id) === Number(row.config_id)).map(t => ({
      id: Number(t.id),
      status: t.status,
      storyboardId: t.storyboard_id == null ? null : Number(t.storyboard_id),
      dramaId: t.drama_id == null ? null : Number(t.drama_id),
      error: t.error_msg ? String(t.error_msg).slice(0, 300) : null,
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
  }))
}

// ---------- failed tasks: what the back office's "งานที่ล้มเหลว" page lists for support ----------
const FAILED_LIMIT = 100

/** Image and video tasks that failed in the last `days` days, newest first, with their owner (a naka-ai
 * user id) so support can find the customer. The prompt and provider keys are never included. */
async function failedTasks(days: number) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const [rows, [total]] = await Promise.all([
    rawQuery(`SELECT t.id, t.type, t.owner_user_id, t.provider, c.name AS config_name, t.drama_id, d.title AS drama_title,
        t.storyboard_id, t.error_msg, t.error_code, t.credit_hold_id, t.created_at, t.updated_at
      FROM sys_task t
      LEFT JOIN ai_service_configs c ON c.id = t.config_id
      LEFT JOIN dramas d ON d.id = t.drama_id
      WHERE t.status = 'failed' AND t.updated_at >= $1
      ORDER BY t.updated_at DESC, t.id DESC LIMIT ${FAILED_LIMIT}`, [since]),
    rawQuery(`SELECT COUNT(*)::int AS n FROM sys_task WHERE status = 'failed' AND updated_at >= $1`, [since]),
  ])
  return {
    days,
    total: Number(total?.n ?? 0),
    tasks: rows.map(t => ({
      id: Number(t.id),
      type: t.type,
      ownerUserId: t.owner_user_id ?? null,
      provider: t.provider ?? null,
      configName: t.config_name ?? null,
      dramaId: t.drama_id == null ? null : Number(t.drama_id),
      dramaTitle: t.drama_title ?? null,
      storyboardId: t.storyboard_id == null ? null : Number(t.storyboard_id),
      error: t.error_msg ? String(t.error_msg).slice(0, 300) : null,
      errorCode: t.error_code ?? null,
      // the naka-ai credit hold (credits.ts); the landing reads whether it was refunded from account.credit_holds
      creditHoldId: t.credit_hold_id == null ? null : Number(t.credit_hold_id),
      createdAt: t.created_at,
      updatedAt: t.updated_at,
    })),
  }
}

app.get('/failed-tasks', async (c) => {
  const days = Math.min(30, Math.max(1, Math.trunc(Number(c.req.query('days'))) || 7))
  return success(c, await failedTasks(days))
})

app.get('/overview', async (c) => {
  const [storage, queues] = await Promise.all([storageInfo(), videoQueues()])
  return success(c, {
    version: currentVersion(),
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    database: 'PostgreSQL (schema studio)',
    storage,
    videoQueues: queues,
  })
})

// ---------- a member's latest works, for their naka-ai dashboard (/app/, the landing's /api/me/works) ----------

/** kind → the studio page that opens it (frontend/menus/<menu>/routes.ts) */
const WORK_PATHS: Record<string, string> = {
  drama: '/drama/', product_video: '/studio/', seller: '/seller/', viral_clone: '/viral-clone/', campaign: '/marketer/',
}

/**
 * What the member made, newest first. A piece of work that is only the inside of another is left out, so each thing
 * the member started shows once: the drama behind a product video, a campaign or a viral-clone variant, and the
 * product-video project behind a seller post.
 */
const MEMBER_WORKS_SQL = `
  SELECT kind, id, title, status, updated_at FROM (
    SELECT 'drama' AS kind, d.id, d.title, d.status, d.updated_at FROM dramas d
     WHERE d.owner_user_id = $1 AND d.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM studio_projects p WHERE p.drama_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM campaigns c WHERE c.drama_id = d.id)
       AND NOT EXISTS (SELECT 1 FROM clone_variants v JOIN episodes e ON e.id = v.episode_id WHERE e.drama_id = d.id)
    UNION ALL
    SELECT 'product_video', p.id, p.title, p.status, p.updated_at FROM studio_projects p
     WHERE p.owner_user_id = $1 AND p.deleted_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM seller_posts s WHERE s.studio_project_id = p.id)
    UNION ALL
    SELECT 'seller', s.id, coalesce(nullif(s.title, ''), nullif(s.product_name, ''), 'โพสต์ขาย'), s.status, s.updated_at FROM seller_posts s
     WHERE s.owner_user_id = $1 AND s.deleted_at IS NULL
    UNION ALL
    SELECT 'viral_clone', c.id, c.name, c.status, c.updated_at FROM clone_projects c WHERE c.owner_user_id = $1
    UNION ALL
    SELECT 'campaign', c.id, c.title, c.status, c.updated_at FROM campaigns c WHERE c.owner_user_id = $1 AND c.deleted_at IS NULL
  ) w ORDER BY updated_at DESC, kind, id DESC LIMIT $2`

// GET /system/member-works?owner=<naka-ai user id>&limit=5 — admin only like the rest of /system (auth/admin.ts):
// the landing asks server to server with ADMIN_TOKEN for the signed-in member, never for whoever the browser names.
app.get('/member-works', async (c) => {
  const owner = c.req.query('owner') ?? ''
  if (!/^[^\s'"\\]{1,128}$/.test(owner) || owner === 'local') return badRequest(c, 'owner is required')
  const limit = Math.min(20, Math.max(1, Number(c.req.query('limit')) || 5))
  const rows = await rawQuery(MEMBER_WORKS_SQL, [owner, limit])
  return success(c, {
    works: rows.map(r => ({
      kind: String(r.kind),
      id: Number(r.id),
      title: String(r.title ?? '').slice(0, 120),
      status: String(r.status ?? ''),
      updatedAt: String(r.updated_at ?? ''),
      path: WORK_PATHS[String(r.kind)] + Number(r.id),
    })),
  })
})

export default app
