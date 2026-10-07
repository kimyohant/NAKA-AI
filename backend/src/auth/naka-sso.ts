/**
 * Studio side of naka-ai single sign-on (landing-worker/docs/studio-sso.md, landing-worker/src/auth/studio.ts).
 * naka-ai.com is the sign-in server; the Studio engine never sees passwords.
 *
 *   GET  /api/v1/auth/naka/login?next=/path  → state cookie (10 min) → {NAKA_SSO_URL}/api/sso/studio/authorize?state
 *   GET  /api/v1/auth/naka/callback?code&state → server POSTs {NAKA_SSO_URL}/api/sso/studio/token (Bearer NAKA_SSO_SECRET)
 *                                               → signed session cookie (12 h) → redirect to `next`
 *   GET  /api/v1/auth/naka/me                 → the signed-in member (or the local user when SSO is off)
 *   POST /api/v1/auth/naka/logout             → clears the session
 *
 * Enabled when NAKA_SSO_URL (https, or http on localhost) and NAKA_SSO_SECRET (≥ 32 chars, same value as the Worker's
 * STUDIO_SSO_SECRET) are set. Then every /api/v1 call needs a session (401 E_AUTH_REQUIRED), the shared Basic Auth is
 * not used, and members the Worker marks as admin (Google account in ADMIN_EMAILS) pass the admin guard.
 * Off (dev / desktop) → one local user owns everything, exactly as before.
 */
import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export interface StudioUser {
  id: string
  name: string
  email: string | null
  admin: boolean
}

/** single-user mode (SSO off): everything belongs to this user */
export const LOCAL_USER: StudioUser = { id: 'local', name: 'Local', email: null, admin: true }
/** back-office calls authenticated with ADMIN_TOKEN (no member session) */
export const TOKEN_ADMIN: StudioUser = { id: 'admin-token', name: 'Admin', email: null, admin: true }

const SESSION_COOKIE = 'naka_studio_session'
const STATE_COOKIE = 'naka_studio_sso_state'
const SESSION_SECONDS = 12 * 60 * 60
const STATE_SECONDS = 10 * 60
const TOKEN_TIMEOUT_MS = 10_000
const CODE = /^[A-Za-z0-9_-]{43}$/
const STATE = /^[A-Za-z0-9_-]{16,128}$/

export interface SsoConfig { origin: string; secret: string; secure: boolean }

/** null = SSO off. Mirrors the Worker's rules: https only (http allowed for localhost), secret ≥ 32 url-safe chars. */
export function ssoConfig(): SsoConfig | null {
  const rawUrl = (process.env.NAKA_SSO_URL || '').trim()
  const secret = (process.env.NAKA_SSO_SECRET || '').trim()
  if (!rawUrl && !secret) return null
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new Error('NAKA_SSO_URL is not a valid URL') }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !local) throw new Error('NAKA_SSO_URL must be https (http only for localhost)')
  if (!/^[A-Za-z0-9_-]{32,}$/.test(secret)) throw new Error('NAKA_SSO_SECRET must be at least 32 characters of A-Z a-z 0-9 _ -')
  return { origin: url.origin, secret, secure: !local }
}

export const ssoEnabled = () => ssoConfig() !== null

// ---------- signed cookies ----------

const b64 = (buf: Buffer) => buf.toString('base64url')
const sessionKey = (secret: string) => createHmac('sha256', secret).update('naka-studio-session-v1').digest()

function sign(payload: object, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(payload)))
  const sig = b64(createHmac('sha256', sessionKey(secret)).update(body).digest())
  return `${body}.${sig}`
}

function verify<T extends { exp: number }>(value: string | undefined, secret: string): T | null {
  if (!value) return null
  const [body, sig] = value.split('.')
  if (!body || !sig) return null
  const expected = Buffer.from(b64(createHmac('sha256', sessionKey(secret)).update(body).digest()))
  const actual = Buffer.from(sig)
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T
    return typeof payload.exp === 'number' && payload.exp > Math.floor(Date.now() / 1000) ? payload : null
  } catch {
    return null
  }
}

/** only same-site relative paths (no //host, no schemes) */
export function safeNext(raw: unknown): string {
  const next = typeof raw === 'string' ? raw : ''
  return next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\') ? next : '/'
}

// ---------- session ----------

interface SessionPayload { uid: string; name: string; email: string | null; admin: boolean; exp: number }

/** The member behind this request: session user when SSO is on, LOCAL_USER when it is off, null when signed out. */
export function currentUser(c: Context): StudioUser | null {
  const config = ssoConfig()
  if (!config) return LOCAL_USER
  const s = verify<SessionPayload>(getCookie(c, SESSION_COOKIE), config.secret)
  return s ? { id: s.uid, name: s.name, email: s.email, admin: s.admin } : null
}

/** the user set by requireSession (falls back to resolving it, e.g. for code paths outside the middleware) */
export function userOf(c: Context): StudioUser {
  return (c.get('user' as never) as StudioUser | undefined) ?? currentUser(c) ?? LOCAL_USER
}

async function upsertUser(u: StudioUser) {
  const ts = now()
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id))
  if (row) {
    await db.update(schema.users).set({ displayName: u.name, email: u.email, isAdmin: u.admin, lastLoginAt: ts, updatedAt: ts })
      .where(eq(schema.users.id, u.id))
  } else {
    await db.insert(schema.users).values({ id: u.id, displayName: u.name, email: u.email, isAdmin: u.admin, lastLoginAt: ts, createdAt: ts, updatedAt: ts })
  }
}

// ---------- middleware ----------

const OPEN_PATHS = ['/api/v1/health', '/api/v1/auth/naka/']

/**
 * Mounted on /api/v1/*: with SSO on, every call needs a member session (401 E_AUTH_REQUIRED) and state-changing
 * calls must come from an allowed Origin. Sets c.var.user either way.
 */
export function requireSession(allowedOrigins: () => string[], isTokenAdmin: (c: Context) => boolean = () => false) {
  return async (c: Context, next: Next) => {
    if (ssoEnabled() && isTokenAdmin(c)) {
      c.set('user' as never, TOKEN_ADMIN as never)
      return next()
    }
    if (!ssoEnabled() || c.req.method === 'OPTIONS' || OPEN_PATHS.some(p => c.req.path === p || c.req.path.startsWith(p))) {
      c.set('user' as never, currentUser(c) as never)
      return next()
    }
    const user = currentUser(c)
    if (!user) return c.json({ code: 401, message: 'กรุณาเข้าสู่ระบบด้วยบัญชี naka-ai', errorCode: 'E_AUTH_REQUIRED' }, 401)
    if (!['GET', 'HEAD'].includes(c.req.method)) {
      const origin = c.req.header('Origin')
      const self = new URL(c.req.url).origin
      if (origin && origin !== self && !allowedOrigins().includes(origin)) {
        return c.json({ code: 403, message: 'origin not allowed', errorCode: 'E_ORIGIN' }, 403)
      }
    }
    c.set('user' as never, user as never)
    return next()
  }
}

// ---------- routes ----------

const app = new Hono()

app.get('/login', (c) => {
  const config = ssoConfig()
  if (!config) return c.redirect(safeNext(c.req.query('next')))
  const state = b64(randomBytes(32))
  setCookie(c, STATE_COOKIE, sign({ state, next: safeNext(c.req.query('next')), exp: Math.floor(Date.now() / 1000) + STATE_SECONDS }, config.secret), {
    httpOnly: true, secure: config.secure, sameSite: 'Lax', path: '/api/v1/auth/naka', maxAge: STATE_SECONDS,
  })
  const target = new URL('/api/sso/studio/authorize', config.origin)
  target.searchParams.set('state', state)
  c.header('Cache-Control', 'no-store')
  return c.redirect(target.toString())
})

app.get('/callback', async (c) => {
  const config = ssoConfig()
  if (!config) return c.redirect('/')
  c.header('Cache-Control', 'no-store')
  const code = c.req.query('code') || ''
  const state = c.req.query('state') || ''
  const pending = verify<{ state: string; next: string; exp: number }>(getCookie(c, STATE_COOKIE), config.secret)
  deleteCookie(c, STATE_COOKIE, { path: '/api/v1/auth/naka' })
  if (!pending || !STATE.test(state) || !CODE.test(code)
    || Buffer.byteLength(pending.state) !== Buffer.byteLength(state)
    || !timingSafeEqual(Buffer.from(pending.state), Buffer.from(state))) {
    return c.json({ code: 400, message: 'ลิงก์เข้าสู่ระบบหมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่', errorCode: 'E_SSO_STATE' }, 400)
  }
  let res: Response
  try {
    res = await fetch(new URL('/api/sso/studio/token', config.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.secret}` },
      body: JSON.stringify({ code }),
      redirect: 'error',
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
  } catch {
    return c.json({ code: 502, message: 'ติดต่อ naka-ai ไม่ได้ ลองใหม่อีกครั้ง', errorCode: 'E_SSO_UNREACHABLE' }, 502)
  }
  const data: any = await res.json().catch(() => null)
  if (res.status === 403) return c.json({ code: 403, message: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้ naka-studio', errorCode: 'E_SSO_DENIED' }, 403)
  const u = data?.user
  if (!res.ok || !u || typeof u.id !== 'string' || !u.id) {
    return c.json({ code: 400, message: 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่', errorCode: 'E_SSO_TOKEN' }, 400)
  }
  const user: StudioUser = {
    id: u.id.slice(0, 64),
    name: String(u.displayName || u.email || 'naka member').slice(0, 120),
    email: typeof u.email === 'string' ? u.email.slice(0, 200) : null,
    admin: data.admin === true,
  }
  await upsertUser(user)
  setCookie(c, SESSION_COOKIE, sign({ uid: user.id, name: user.name, email: user.email, admin: user.admin, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS }, config.secret), {
    httpOnly: true, secure: config.secure, sameSite: 'Lax', path: '/', maxAge: SESSION_SECONDS,
  })
  return c.redirect(pending.next)
})

app.get('/me', (c) => {
  const config = ssoConfig()
  const user = currentUser(c)
  c.header('Cache-Control', 'no-store')
  if (!user) return c.json({ code: 401, message: 'not signed in', errorCode: 'E_AUTH_REQUIRED', data: { sso: true } }, 401)
  return c.json({ code: 200, message: 'success', data: { user, sso: !!config, accountUrl: config ? `${config.origin}/app/` : null } })
})

app.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
  const config = ssoConfig()
  return c.json({ code: 200, message: 'success', data: { loggedOut: true, accountUrl: config ? `${config.origin}/app/` : null } })
})

export default app
