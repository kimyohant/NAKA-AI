import type { Env } from '../types';
import { appOrigin, AuthError, constantTimeEqual, cookie, cookieValue, now, randomToken, sha256 } from './common';
import { createSession, identityUser } from './session';

const STATE_COOKIE = 'naka_oauth_state';
const STATE_SECONDS = 600;
const CALLBACK = '/api/auth/google/callback';

function googleConfig(env: Env): string {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new AuthError(503, 'ระบบเข้าสู่ระบบด้วย Google ยังไม่พร้อมใช้งาน');
  return new URL(CALLBACK, appOrigin(env)).href;
}

export async function googleStart(request: Request, env: Env): Promise<Response> {
  const redirectUri = googleConfig(env);
  const state = randomToken();
  const verifier = randomToken();
  const previous = cookie(request, STATE_COOKIE);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_oauth_states WHERE expires_at <= ? OR id = ?').bind(now(), previous ? await sha256(previous) : ''),
    env.DB.prepare('INSERT INTO auth_oauth_states (id, verifier, expires_at) VALUES (?, ?, ?)').bind(await sha256(state), verifier, now() + STATE_SECONDS),
  ]);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: 'code',
    scope: 'openid email profile', state, code_challenge: await sha256(verifier), code_challenge_method: 'S256',
  }).toString();
  return new Response(null, { status: 302, headers: { Location: url.href, 'Set-Cookie': cookieValue(env, STATE_COOKIE, state, STATE_SECONDS) } });
}

export async function googleCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const headers = new Headers({ 'Set-Cookie': cookieValue(env, STATE_COOKIE, '', 0) });
  try {
    const redirectUri = googleConfig(env);
    const state = url.searchParams.get('state');
    const boundState = cookie(request, STATE_COOKIE);
    if (!state || !boundState || !/^[A-Za-z0-9_-]{43}$/.test(state) || !constantTimeEqual(state, boundState) || url.searchParams.getAll('state').length !== 1) throw new Error();
    const flow = await env.DB.prepare('DELETE FROM auth_oauth_states WHERE id = ? AND expires_at > ? RETURNING verifier')
      .bind(await sha256(state), now()).first<{ verifier: string }>();
    const code = url.searchParams.get('code');
    if (!flow || !code || code.length > 4096 || url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1) throw new Error();
    const tokens = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: flow.verifier }),
    });
    if (!tokens.ok) throw new Error();
    const token = await tokens.json() as { access_token?: string; token_type?: string };
    if (typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 8192 || token.token_type?.toLowerCase() !== 'bearer') throw new Error();
    // Identity comes only from Google's userinfo endpoint using the access token
    // obtained by our server's code exchange. No client-supplied JWT is trusted.
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Authorization: `Bearer ${token.access_token}` },
    });
    if (!response.ok) throw new Error();
    const profile = await response.json() as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
    if (typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255 ||
        typeof profile.email !== 'string' || profile.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(profile.email) || profile.email_verified !== true) throw new Error();
    const name = typeof profile.name === 'string' && profile.name.trim() ? profile.name.trim().slice(0, 160) : 'สมาชิก NAKA-AI';
    // Stable Google sub is the identity key. Never merge accounts by email.
    const user = await identityUser(env, 'google', profile.sub, name, profile.email);
    headers.append('Set-Cookie', await createSession(request, env, user));
    headers.set('Location', new URL('/app/', appOrigin(env)).href);
  } catch {
    headers.set('Location', new URL('/login/?error=google', appOrigin(env)).href);
  }
  return new Response(null, { status: 302, headers });
}
