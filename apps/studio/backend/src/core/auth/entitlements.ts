/**
 * Which studio menus a member may use, and the monthly AI-video quota (docs/entitlements.md at the repo root).
 *
 * The answer is not stored here: the account side owns it. account.member_features(user) and
 * account.use_feature(user, feature, n) (apps/landing/migrations/pg/0003_entitlements.sql) are granted to
 * studio_app, so a plan change or an admin override on naka-ai.com applies on the member's next request.
 *
 * Checked only for naka-ai members: off in single-user mode (no SSO), never for admins, and off when
 * NAKA_ENTITLEMENTS=off (a studio not attached to the shared database).
 */
import type { Context, Next } from 'hono'
import { eq } from 'drizzle-orm'
import { db, rawQuery, schema } from '../db/index.js'
import { AppError } from '../http/response.js'
import { LOCAL_OWNER, currentOwnerId, ownerScope } from './owner-context.js'
import { ssoEnabled, userOf } from './naka-sso.js'

export type StudioFeature =
  | 'studio.drama' | 'studio.marketer' | 'studio.seller' | 'studio.product_studio' | 'studio.viral_clone'
  | 'studio.live' | 'studio.video' | 'studio.social'

export interface MemberFeature {
  key: StudioFeature
  label: string
  quotaUnit: string | null
  enabled: boolean
  monthlyLimit: number | null
  used: number
}

const ACCOUNT_SCHEMA = (process.env.ACCOUNT_SCHEMA || 'account').replace(/"/g, '')
const CACHE_MS = 10_000

export const entitlementsOn = (): boolean => ssoEnabled() && process.env.NAKA_ENTITLEMENTS !== 'off'

const cache = new Map<string, { at: number; features: MemberFeature[] }>()
/** forget cached answers (after a use changed the counts; tests) */
export function clearEntitlementCache(userId?: string): void {
  if (userId) cache.delete(userId)
  else cache.clear()
}

export async function memberFeatures(userId: string): Promise<MemberFeature[]> {
  const hit = cache.get(userId)
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.features
  const rows = await rawQuery(
    `SELECT feature_key, label, quota_unit, enabled, monthly_limit, used FROM "${ACCOUNT_SCHEMA}".member_features($1) WHERE app = 'studio'`,
    [userId],
  )
  const features = rows.map(r => ({
    key: String(r.feature_key) as StudioFeature,
    label: String(r.label),
    quotaUnit: r.quota_unit == null ? null : String(r.quota_unit),
    enabled: r.enabled === true || r.enabled === 't',
    monthlyLimit: r.monthly_limit == null ? null : Number(r.monthly_limit),
    used: Number(r.used ?? 0),
  }))
  cache.set(userId, { at: Date.now(), features })
  return features
}

// ---------- menus ----------

/** Shared timeline routes (episodes, storyboards, tasks…) serve several menus: any studio menu opens them. */
const ANY_MENU: StudioFeature[] = ['studio.drama', 'studio.marketer', 'studio.seller', 'studio.product_studio', 'studio.viral_clone', 'studio.live', 'studio.social']

/**
 * API prefix → the menus that use it. A member needs one of them. Drama's list/create also serves the marketer
 * (a creative becomes a drama episode); Product Studio's routes also serve seller videos and Viral Clone
 * (templates, avatars, their video projects). Routes not listed (settings, AI configs, auth) are not menus.
 */
export const ROUTE_FEATURES: Array<[string, StudioFeature[]]> = [
  ['/api/v1/dramas', ['studio.drama', 'studio.marketer']],
  ['/api/v1/campaigns', ['studio.marketer']],
  ['/api/v1/trending-videos', ['studio.marketer']],
  ['/api/v1/gallery', ['studio.marketer']],
  ['/api/v1/marketer', ['studio.marketer']],
  ['/api/v1/studio', ['studio.product_studio', 'studio.seller', 'studio.viral_clone']],
  ['/api/v1/seller', ['studio.seller']],
  ['/api/v1/clone', ['studio.viral_clone']],
  ['/api/v1/live', ['studio.live']],
  ['/api/v1/social', ['studio.social']],
  ...['episodes', 'storyboards', 'scenes', 'characters', 'props', 'merge', 'tasks', 'upload', 'agent']
    .map(p => [`/api/v1/${p}`, ANY_MENU] as [string, StudioFeature[]]),
]

export function featuresForPath(path: string): StudioFeature[] | null {
  const rule = ROUTE_FEATURES.find(([prefix]) => path === prefix || path.startsWith(prefix + '/'))
  return rule ? rule[1] : null
}

let unavailableLogged = false

/** Mounted on /api/v1/* after requireSession: 403 E_FEATURE_DISABLED for a menu outside the member's plan. */
export async function entitlementGuard(c: Context, next: Next) {
  if (!entitlementsOn() || c.req.method === 'OPTIONS') return next()
  const needed = featuresForPath(c.req.path)
  if (!needed) return next()
  const user = userOf(c)
  if (user.admin || user.id === LOCAL_OWNER) return next()
  let features: MemberFeature[]
  try {
    features = await memberFeatures(user.id)
  } catch (err: any) {
    if (!unavailableLogged) { console.error('entitlements: account.member_features unavailable:', err?.message); unavailableLogged = true }
    return c.json({ code: 503, message: 'ตรวจสิทธิ์การใช้งานไม่ได้ชั่วคราว กรุณาลองใหม่', errorCode: 'E_ENTITLEMENTS_UNAVAILABLE' }, 503)
  }
  if (needed.some(key => features.find(f => f.key === key)?.enabled)) return next()
  return c.json({
    code: 403,
    message: 'แพ็กเกจของคุณยังไม่รวมเมนูนี้ อัปเกรดแพ็กเกจที่ naka-ai.com',
    errorCode: 'E_FEATURE_DISABLED',
    data: { features: needed },
  }, 403)
}

async function isStudioAdmin(userId: string): Promise<boolean> {
  const [row] = await db.select({ isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.id, userId))
  return row?.isAdmin === true
}

/**
 * Background work done for a member (the Social Auto Reply poller): whether the owner's plan still includes
 * `key`. True when entitlements are off, for single-user rows and admins. A failed check answers false, so
 * nothing is sent on a member's behalf while the account side cannot say yes.
 */
export async function ownerHasFeature(owner: string | null | undefined, key: StudioFeature): Promise<boolean> {
  if (!entitlementsOn() || !owner || owner === LOCAL_OWNER) return true
  try {
    if (await isStudioAdmin(owner)) return true
    return (await memberFeatures(owner)).some(f => f.key === key && f.enabled)
  } catch (err: any) {
    if (!unavailableLogged) { console.error('entitlements: account.member_features unavailable:', err?.message); unavailableLogged = true }
    return false
  }
}

// ---------- AI video quota ----------

export interface FeatureUse { owner: string; feature: StudioFeature; period: string }

/**
 * Count one AI video against the owner's monthly quota before the task is created; null when nothing is
 * counted (entitlements off, single-user rows, admins). Refused → AppError E_FEATURE_DISABLED / E_FEATURE_QUOTA.
 * Never call inside an open db.transaction: PGlite has one connection.
 */
export async function useVideoQuota(owner: string = currentOwnerId()): Promise<FeatureUse | null> {
  if (!entitlementsOn() || !owner || owner === LOCAL_OWNER) return null
  if (ownerScope()?.admin || await isStudioAdmin(owner)) return null
  const [row] = await rawQuery(`SELECT ok, reason, used, monthly_limit, period FROM "${ACCOUNT_SCHEMA}".use_feature($1, $2, 1)`, [owner, 'studio.video'])
  clearEntitlementCache(owner)
  if (row?.ok === true || row?.ok === 't') return { owner, feature: 'studio.video', period: String(row.period) }
  if (row?.reason === 'quota') {
    throw new AppError(`สร้างวิดีโอ AI ครบ ${row.monthly_limit} คลิปของเดือนนี้แล้ว อัปเกรดแพ็กเกจหรือรอเดือนหน้า`, 'E_FEATURE_QUOTA')
  }
  throw new AppError('แพ็กเกจของคุณยังไม่รวมการสร้างวิดีโอ AI ในสตูดิโอ', 'E_FEATURE_DISABLED')
}

/** Give back a use whose task was never created. */
export async function releaseFeatureUse(use: FeatureUse | null): Promise<void> {
  if (!use) return
  await rawQuery(`SELECT "${ACCOUNT_SCHEMA}".release_feature($1, $2, 1, $3)`, [use.owner, use.feature, use.period])
  clearEntitlementCache(use.owner)
}
