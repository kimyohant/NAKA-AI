/**
 * Admin guard — the system-settings API (AI services, styles, agent prompts/skills, storage, server update)
 * belongs to the back-office app (admin/), not to the user-facing app.
 *
 * - ADMIN_TOKEN (≥ 16 chars) turns the guard on; requests must send `X-Admin-Token: <token>`.
 *   Unset → guard off (backward compatible: dev and the single-user desktop build keep working).
 * - The user-facing app only needs reads that expose no secrets (AI config list — api_key is already
 *   stripped — and style presets) plus the viewer's own preferences (/settings/*), so those stay open.
 * - A valid admin token also satisfies the site-wide Basic Auth (NAKA_AUTH_PASSWORD), so a back-office app
 *   hosted on another origin only needs the token.
 */
import type { Context, Next } from 'hono'
import { timingSafeEqual } from 'node:crypto'
import { currentUser, ssoEnabled } from './naka-sso.js'

const MIN_TOKEN_LENGTH = 16

export function adminToken(): string {
  return process.env.ADMIN_TOKEN || ''
}

export function adminGuardEnabled(): boolean {
  return adminToken().length > 0
}

/** Fail fast on a weak token instead of silently running with a guessable one. */
export function assertAdminTokenConfig(): void {
  const token = adminToken()
  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`ADMIN_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`)
  }
}

export function isAdminRequest(c: Context): boolean {
  const expected = adminToken()
  if (!expected) return false
  const actual = c.req.header('X-Admin-Token') || ''
  const a = Buffer.from(actual)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

const ADMIN_ONLY_PREFIXES = ['/ai-providers', '/prompts', '/skills', '/storage', '/server-update', '/admin']

const under = (p: string, prefix: string) => p === prefix || p.startsWith(`${prefix}/`)

/** Does this API call (path relative to /api/v1) belong to the back-office only? */
export function needsAdmin(method: string, apiPath: string): boolean {
  const p = apiPath.replace(/\/+$/, '') || '/'
  const read = method === 'GET' || method === 'HEAD'
  // list without secrets is used by the app (model pickers, "AI not configured" banner)
  if (p === '/ai-configs') return !read
  if (under(p, '/ai-configs')) return true
  // the app reads presets for its style pickers; editing them is admin work
  if (under(p, '/style-presets')) return !read
  return ADMIN_ONLY_PREFIXES.some(prefix => under(p, prefix))
}

/** naka-ai admins (Google account in the Worker's ADMIN_EMAILS) signed in through SSO */
export function isSsoAdmin(c: Context): boolean {
  return ssoEnabled() && currentUser(c)?.admin === true
}

/** guard is on with ADMIN_TOKEN, and always when members sign in through SSO (members must not edit AI keys) */
export const guardOn = () => adminGuardEnabled() || ssoEnabled()

/** Mounted on /api/v1/* — 401 E_ADMIN_REQUIRED when an admin-only call has no valid token / admin session. */
export async function adminGuard(c: Context, next: Next) {
  if (!guardOn() || c.req.method === 'OPTIONS') return next()
  const apiPath = c.req.path.replace(/^\/api\/v1/, '')
  if (!needsAdmin(c.req.method, apiPath) || isAdminRequest(c) || isSsoAdmin(c)) return next()
  return c.json({ code: 401, message: 'ต้องเข้าสู่ระบบผู้ดูแล (admin token)', errorCode: 'E_ADMIN_REQUIRED' }, 401)
}
