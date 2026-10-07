/**
 * Studio side of naka-ai SSO (src/auth/naka-sso.ts) against a fake naka-ai token endpoint,
 * plus a contract check with the real Worker side (kimyohant/naka-ai-landing src/auth/studio.ts, checked out
 * next to this repo or via NAKA_LANDING_DIR; skipped when absent).
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test, after } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-sso-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')
const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  initSqliteSchema(sqlite)
  sqlite.close()
}
const { Hono } = await import('hono')
const sso = await import('../src/auth/naka-sso.js')
const { adminGuard } = await import('../src/middleware/admin.js')
const { db, schema } = await import('../src/db/index.js')

const SECRET = 'x'.repeat(40)
const CODE = 'c'.repeat(43)
const calls: Array<{ auth: string; body: string }> = []
let reply: { status: number; body: unknown } = { status: 200, body: { user: { id: 'u-1', displayName: 'Noom', email: 'noom@example.com' }, admin: false } }
const naka = http.createServer((req, res) => {
  let body = ''
  req.on('data', d => (body += d))
  req.on('end', () => {
    if (req.url !== '/api/sso/studio/token' || req.method !== 'POST') { res.writeHead(404); return res.end() }
    calls.push({ auth: String(req.headers.authorization || ''), body })
    res.writeHead(reply.status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(reply.body))
  })
})
await new Promise<void>(r => naka.listen(0, '127.0.0.1', () => r()))
const NAKA = `http://127.0.0.1:${(naka.address() as any).port}`
after(() => naka.close())

const { isAdminRequest } = await import('../src/middleware/admin.js')
function makeApp() {
  const app = new Hono()
  app.use('/api/v1/*', sso.requireSession(() => [], isAdminRequest))
  app.use('/api/v1/*', adminGuard)
  app.route('/api/v1/auth/naka', sso.default)
  app.get('/api/v1/dramas', c => c.json({ user: sso.userOf(c) }))
  app.post('/api/v1/dramas', c => c.json({ ok: true }))
  app.get('/api/v1/prompts', c => c.json({ ok: true })) // admin-only path
  return app
}
const cookiesOf = (res: Response) => res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')

/** full browser round trip: login → (naka-ai authorize, simulated) → callback; returns the session cookie */
async function signIn(app: any, next = '/seller') {
  const login = await app.request(`/api/v1/auth/naka/login?next=${encodeURIComponent(next)}`)
  assert.equal(login.status, 302)
  const authorize = new URL(login.headers.get('location')!)
  assert.equal(authorize.origin + authorize.pathname, `${NAKA}/api/sso/studio/authorize`)
  const state = authorize.searchParams.get('state')!
  const cb = await app.request(`/api/v1/auth/naka/callback?code=${CODE}&state=${state}`, { headers: { Cookie: cookiesOf(login) } })
  return { cb, cookie: cookiesOf(cb) }
}

test('SSO off: single-user mode, nothing changes', async () => {
  delete process.env.NAKA_SSO_URL; delete process.env.NAKA_SSO_SECRET; delete process.env.ADMIN_TOKEN
  const app = makeApp()
  const res = await app.request('/api/v1/dramas')
  assert.equal(res.status, 200)
  assert.deepEqual((await res.json()).user, sso.LOCAL_USER)
  assert.equal((await app.request('/api/v1/prompts')).status, 200)
  const me = await (await app.request('/api/v1/auth/naka/me')).json()
  assert.equal(me.data.sso, false)
})

test('config is validated like the Worker does', () => {
  process.env.NAKA_SSO_URL = 'http://naka-ai.com'; process.env.NAKA_SSO_SECRET = SECRET
  assert.throws(() => sso.ssoConfig(), /https/)
  process.env.NAKA_SSO_URL = 'https://naka-ai.com'; process.env.NAKA_SSO_SECRET = 'short'
  assert.throws(() => sso.ssoConfig(), /32/)
  process.env.NAKA_SSO_SECRET = SECRET
  assert.equal(sso.ssoConfig()!.origin, 'https://naka-ai.com')
  assert.equal(sso.safeNext('//evil.com'), '/')
  assert.equal(sso.safeNext('https://evil.com'), '/')
  assert.equal(sso.safeNext('/drama/3?x=1'), '/drama/3?x=1')
})

test('SSO on: API needs a session; round trip creates one, stores the member, redirects to next', async () => {
  process.env.NAKA_SSO_URL = NAKA; process.env.NAKA_SSO_SECRET = SECRET
  const app = makeApp()
  const denied = await app.request('/api/v1/dramas')
  assert.equal(denied.status, 401)
  assert.equal((await denied.json()).errorCode, 'E_AUTH_REQUIRED')
  assert.equal((await app.request('/api/v1/health')).status, 404) // open path (not mounted here), not 401

  const { cb, cookie } = await signIn(app, '/seller/7')
  assert.equal(cb.status, 302)
  assert.equal(cb.headers.get('location'), '/seller/7')
  assert.equal(calls.at(-1)!.auth, `Bearer ${SECRET}`)
  assert.deepEqual(JSON.parse(calls.at(-1)!.body), { code: CODE })
  assert.match(cb.headers.getSetCookie().join(';'), /naka_studio_session=.*HttpOnly/i)

  const ok = await app.request('/api/v1/dramas', { headers: { Cookie: cookie } })
  assert.equal(ok.status, 200)
  assert.deepEqual((await ok.json()).user, { id: 'u-1', name: 'Noom', email: 'noom@example.com', admin: false })
  const [row] = await db.select().from(schema.users)
  assert.equal(row.id, 'u-1')
  assert.equal(row.isAdmin, false)

  // member is not an admin → settings API refused even without ADMIN_TOKEN
  assert.equal((await app.request('/api/v1/prompts', { headers: { Cookie: cookie } })).status, 401)
  // cross-site write refused; same-origin write accepted
  assert.equal((await app.request('/api/v1/dramas', { method: 'POST', headers: { Cookie: cookie, Origin: 'https://evil.example' } })).status, 403)
  assert.equal((await app.request('/api/v1/dramas', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://localhost' } })).status, 200)
  // tampered session
  assert.equal((await app.request('/api/v1/dramas', { headers: { Cookie: cookie.replace(/.$/, c => (c === 'a' ? 'b' : 'a')) } })).status, 401)
  // logout clears it
  const out = await app.request('/api/v1/auth/naka/logout', { method: 'POST', headers: { Cookie: cookie } })
  assert.match(out.headers.getSetCookie().join(';'), /naka_studio_session=;/)
})

test('admins from naka-ai pass the admin guard', async () => {
  process.env.NAKA_SSO_URL = NAKA; process.env.NAKA_SSO_SECRET = SECRET
  reply = { status: 200, body: { user: { id: 'admin-1', displayName: 'Owner', email: 'owner@example.com' }, admin: true } }
  const app = makeApp()
  const { cookie } = await signIn(app)
  assert.equal((await app.request('/api/v1/prompts', { headers: { Cookie: cookie } })).status, 200)
})

test('back-office ADMIN_TOKEN still works when SSO is on (no member session needed)', async () => {
  process.env.NAKA_SSO_URL = NAKA; process.env.NAKA_SSO_SECRET = SECRET
  process.env.ADMIN_TOKEN = 'admin-token-for-tests-0123456789'
  const app = makeApp()
  assert.equal((await app.request('/api/v1/prompts', { headers: { 'X-Admin-Token': 'admin-token-for-tests-0123456789' } })).status, 200)
  assert.equal((await app.request('/api/v1/prompts', { headers: { 'X-Admin-Token': 'wrong-token-xxxxxxxxxxxxxxxx' } })).status, 401)
  delete process.env.ADMIN_TOKEN
})

test('bad state, missing state cookie, denied member and naka-ai errors never create a session', async () => {
  process.env.NAKA_SSO_URL = NAKA; process.env.NAKA_SSO_SECRET = SECRET
  const app = makeApp()
  const login = await app.request('/api/v1/auth/naka/login')
  const state = new URL(login.headers.get('location')!).searchParams.get('state')!
  const wrong = await app.request(`/api/v1/auth/naka/callback?code=${CODE}&state=${'z'.repeat(43)}`, { headers: { Cookie: cookiesOf(login) } })
  assert.equal((await wrong.json()).errorCode, 'E_SSO_STATE')
  const noCookie = await app.request(`/api/v1/auth/naka/callback?code=${CODE}&state=${state}`)
  assert.equal((await noCookie.json()).errorCode, 'E_SSO_STATE')
  reply = { status: 403, body: { error: 'not allowed' } }
  const denied = await signIn(app)
  assert.equal(denied.cb.status, 403)
  assert.doesNotMatch(denied.cb.headers.getSetCookie().join(';'), /naka_studio_session=[^;]/)
  reply = { status: 400, body: { error: 'invalid code' } }
  assert.equal((await signIn(app)).cb.status, 400)
})

const WORKER_STUDIO = path.join(process.env.NAKA_LANDING_DIR
  || path.resolve(fileURLToPath(new URL('../../../naka-ai-landing/', import.meta.url))), 'src', 'auth', 'studio.ts')
test('contract with the Worker side (naka-ai-landing src/auth/studio.ts)',
  { skip: existsSync(WORKER_STUDIO) ? false : `${WORKER_STUDIO} not found (set NAKA_LANDING_DIR)` }, () => {
  const worker = readFileSync(WORKER_STUDIO, 'utf8')
  assert.match(worker, /'\/api\/sso\/studio\/authorize'/)
  assert.match(worker, /'\/api\/sso\/studio\/token'/)
  assert.match(worker, /new URL\('\/api\/v1\/auth\/naka\/callback', config\.origin\)/)
  assert.match(worker, /`Bearer \$\{shared\}`/)
  assert.match(worker, /const CODE = \/\^\[A-Za-z0-9_-\]\{43\}\$\//)
  assert.match(worker, /user: \{ id: user\.id, displayName: user\.displayName, email: user\.email \?\? null \}, admin: access\.admin/)
})
