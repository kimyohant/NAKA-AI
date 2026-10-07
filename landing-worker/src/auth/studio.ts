// naka-studio single sign-on (docs/studio-sso.md). naka-ai is the sign-in server:
//   1. naka-studio sends the browser to GET /api/sso/studio/authorize?state=…
//   2. naka-ai signs the member in if needed, checks STUDIO_ACCESS, and redirects back to
//      {STUDIO_URL}/api/v1/auth/naka/callback?code=…&state=… with a one-time code (60 s, stored hashed)
//   3. naka-studio's server redeems the code at POST /api/sso/studio/token with STUDIO_SSO_SECRET
//      and gets the member's id, name, email and admin flag — the browser never sees the secret.
import type { Env, User } from '../types';
import { adminEmails } from '../admin/auth';
import { constantTimeEqual, json, now, randomToken, readJson, sha256 } from './common';
import { getUser, requireUser } from './session';

const CODE_SECONDS = 60;
const STATE = /^[A-Za-z0-9_-]{16,128}$/;
const CODE = /^[A-Za-z0-9_-]{43}$/;
const NO_STORE = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

export type StudioAccess = 'admins' | 'members';

/** The studio origin and who may use it, or null while the link is off or misconfigured. */
export function studioConfig(env: Env): { origin: string; access: StudioAccess } | null {
  const access = (env.STUDIO_ACCESS ?? '').trim();
  if (access === 'off') return null;
  let url: URL;
  try { url = new URL((env.STUDIO_URL ?? '').trim()); } catch { return null; }
  const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !local) return null;
  return { origin: url.origin, access: access === 'members' ? 'members' : 'admins' };
}

/** Same rule as the admin panel: a Google-verified address listed in ADMIN_EMAILS. */
async function isAdmin(env: Env, userId: string): Promise<boolean> {
  const allowed = adminEmails(env);
  if (!allowed.size) return false;
  const { results } = await env.DB.prepare(`SELECT email FROM auth_identities
    WHERE user_id = ? AND provider = 'google' AND verified_at IS NOT NULL AND email IS NOT NULL`).bind(userId).all<{ email: string }>();
  return results.some(r => allowed.has(r.email.toLowerCase()));
}

async function mayUseStudio(env: Env, user: User): Promise<{ allowed: boolean; admin: boolean }> {
  const config = studioConfig(env);
  const admin = await isAdmin(env, user.id);
  return { allowed: !!config && (config.access === 'members' || admin), admin };
}

/** For /api/auth/me: the studio address when this member may open it. */
export async function studioLink(env: Env, user: User): Promise<{ studio?: { url: string } }> {
  const config = studioConfig(env);
  if (!config || !(await mayUseStudio(env, user)).allowed) return {};
  return { studio: { url: config.origin + '/' } };
}

const redirect = (location: string) => new Response(null, { status: 302, headers: { Location: location, ...NO_STORE } });

async function authorize(request: Request, env: Env, url: URL): Promise<Response> {
  const config = studioConfig(env);
  if (!config) return redirect('/app/?studio=off');
  const state = url.searchParams.get('state') ?? '';
  if (!STATE.test(state)) return json({ error: 'คำขอเข้า naka-studio ไม่ถูกต้อง' }, 400, NO_STORE);
  const user = await requireUser(request, env);
  if (!user) return redirect('/login/?next=' + encodeURIComponent(url.pathname + url.search));
  if (!(await mayUseStudio(env, user)).allowed) return redirect('/app/?studio=denied');
  const code = randomToken();
  const t = now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM studio_sso_codes WHERE expires_at <= ?').bind(t),
    env.DB.prepare('INSERT INTO studio_sso_codes (code_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(code), user.id, t + CODE_SECONDS, t),
  ]);
  const back = new URL('/api/v1/auth/naka/callback', config.origin);
  back.searchParams.set('code', code);
  back.searchParams.set('state', state);
  return redirect(back.toString());
}

async function token(request: Request, env: Env): Promise<Response> {
  const config = studioConfig(env);
  const shared = (env.STUDIO_SSO_SECRET ?? '').trim();
  if (!config || shared.length < 32) return json({ error: 'studio sign-in is not configured' }, 503, NO_STORE);
  if (!constantTimeEqual(request.headers.get('Authorization') ?? '', `Bearer ${shared}`)) {
    return json({ error: 'unauthorized' }, 401, NO_STORE);
  }
  let body: Record<string, unknown>;
  try { body = await readJson(request, 512); } catch { return json({ error: 'invalid body' }, 400, NO_STORE); }
  const code = typeof body.code === 'string' ? body.code : '';
  if (!CODE.test(code)) return json({ error: 'invalid code' }, 400, NO_STORE);
  // Redeem and delete in one statement, so a code works once even under concurrent requests.
  const row = await env.DB.prepare('DELETE FROM studio_sso_codes WHERE code_hash = ? AND expires_at > ? RETURNING user_id')
    .bind(await sha256(code), now()).first<{ user_id: string }>();
  const user = row && await getUser(env.DB, row.user_id);
  if (!user) return json({ error: 'invalid code' }, 400, NO_STORE);
  const access = await mayUseStudio(env, user);
  if (!access.allowed) return json({ error: 'not allowed' }, 403, NO_STORE);
  return json({ user: { id: user.id, displayName: user.displayName, email: user.email ?? null }, admin: access.admin }, 200, NO_STORE);
}

export async function handleStudioSso(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname === '/api/sso/studio/authorize') {
    return request.method === 'GET' ? authorize(request, env, url) : json({ error: 'method not allowed' }, 405, { Allow: 'GET' });
  }
  if (url.pathname === '/api/sso/studio/token') {
    return request.method === 'POST' ? token(request, env) : json({ error: 'method not allowed' }, 405, { Allow: 'POST' });
  }
  return null;
}
