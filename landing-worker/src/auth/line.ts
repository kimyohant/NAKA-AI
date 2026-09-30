import type { Env } from '../types';
import { appOrigin, AuthError, constantTimeEqual, cookie, cookieValue, now, randomToken, sha256 } from './common';
import { createSession, identityUser } from './session';

// LINE Login v2.1: https://developers.line.biz/en/docs/line-login/integrate-line-login/
// Token and ID-token verification: https://developers.line.biz/en/reference/line-login/
// PKCE parameters: https://developers.line.biz/en/docs/line-login/integrate-pkce/
const STATE_COOKIE = 'naka_line_state';
const STATE_SECONDS = 600;
const CALLBACK = '/api/auth/line/callback';

function lineConfig(env: Env): { channelId: string; channelSecret: string; redirectUri: string } {
  const channelId = env.LINE_LOGIN_CHANNEL_ID?.trim();
  const channelSecret = env.LINE_LOGIN_CHANNEL_SECRET?.trim();
  if (!channelId || !channelSecret) throw new AuthError(503, 'ระบบเข้าสู่ระบบด้วย LINE ยังไม่พร้อมใช้งาน');
  return { channelId, channelSecret, redirectUri: new URL(CALLBACK, appOrigin(env)).href };
}

// LINE documents state as an alphanumeric string. 32 random bytes give 64 hex characters.
function randomState(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function lineStart(request: Request, env: Env): Promise<Response> {
  const { channelId, redirectUri } = lineConfig(env);
  const state = randomState();
  const nonce = randomState();
  const verifier = randomToken();
  const previous = cookie(request, STATE_COOKIE);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_oauth_states WHERE expires_at <= ? OR id = ?').bind(now(), previous ? await sha256(previous) : ''),
    env.DB.prepare('INSERT INTO auth_oauth_states (id, verifier, expires_at) VALUES (?, ?, ?)')
      .bind(await sha256(state), JSON.stringify({ verifier, nonce }), now() + STATE_SECONDS),
  ]);
  const url = new URL('https://access.line.me/oauth2/v2.1/authorize');
  url.search = new URLSearchParams({
    response_type: 'code', client_id: channelId, redirect_uri: redirectUri,
    state, scope: 'openid profile', nonce,
    code_challenge: await sha256(verifier), code_challenge_method: 'S256',
  }).toString();
  return new Response(null, { status: 302, headers: {
    Location: url.href, 'Set-Cookie': cookieValue(env, STATE_COOKIE, state, STATE_SECONDS),
  } });
}

export async function lineCallback(request: Request, env: Env, url: URL): Promise<Response> {
  const headers = new Headers({ 'Set-Cookie': cookieValue(env, STATE_COOKIE, '', 0) });
  try {
    const { channelId, channelSecret, redirectUri } = lineConfig(env);
    const state = url.searchParams.get('state');
    const boundState = cookie(request, STATE_COOKIE);
    if (!state || !boundState || !/^[a-f0-9]{64}$/.test(state) ||
        !constantTimeEqual(state, boundState) || url.searchParams.getAll('state').length !== 1) throw new Error();
    const row = await env.DB.prepare('DELETE FROM auth_oauth_states WHERE id = ? AND expires_at > ? RETURNING verifier')
      .bind(await sha256(state), now()).first<{ verifier: string }>();
    const code = url.searchParams.get('code');
    if (!row || !code || code.length > 4096 || url.searchParams.has('error') || url.searchParams.getAll('code').length !== 1) throw new Error();
    const flow: unknown = JSON.parse(row.verifier);
    if (!flow || typeof flow !== 'object' || Array.isArray(flow)) throw new Error();
    const { verifier, nonce } = flow as Record<string, unknown>;
    if (typeof verifier !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(verifier) ||
        typeof nonce !== 'string' || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error();

    const tokens = await fetch('https://api.line.me/oauth2/v2.1/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: channelId, client_secret: channelSecret, code_verifier: verifier }),
    });
    if (!tokens.ok) throw new Error();
    const token = await tokens.json() as { id_token?: unknown; token_type?: unknown };
    if (typeof token.id_token !== 'string' || !token.id_token || token.id_token.length > 8192 ||
        typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') throw new Error();

    // Never decode a client-supplied JWT. LINE verifies its signature and expected client_id/nonce.
    const verified = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: token.id_token, client_id: channelId, nonce }),
    });
    if (!verified.ok) throw new Error();
    const profile = await verified.json() as { iss?: unknown; sub?: unknown; aud?: unknown; exp?: unknown; nonce?: unknown; name?: unknown };
    if (profile.iss !== 'https://access.line.me' || profile.aud !== channelId ||
        typeof profile.exp !== 'number' || !Number.isFinite(profile.exp) || profile.exp <= now() ||
        profile.nonce !== nonce || typeof profile.sub !== 'string' || !profile.sub || profile.sub.length > 255) throw new Error();
    const name = typeof profile.name === 'string' && profile.name.trim()
      ? Array.from(profile.name.trim()).slice(0, 160).join('') : 'สมาชิก NAKA-AI';
    // LINE sub is the identity key; matching names or emails never merge accounts.
    const user = await identityUser(env, 'line', profile.sub, name);
    headers.append('Set-Cookie', await createSession(request, env, user));
    headers.set('Location', new URL('/app/', appOrigin(env)).href);
  } catch {
    // Codes, tokens, and provider data must never reach logs or the browser.
    headers.set('Location', new URL('/login/?error=line', appOrigin(env)).href);
  }
  return new Response(null, { status: 302, headers });
}
