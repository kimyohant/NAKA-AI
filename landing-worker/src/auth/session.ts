import type { Env, User } from '../types';
import { signupBonusStatement, signupCredits } from '../onboarding/signup';
import { AuthError, cookie, cookieValue, now, randomToken, sha256 } from './common';

export const SESSION_SECONDS = 30 * 24 * 60 * 60;
export const SESSION_COOKIE = 'naka_session';

export async function getUser(db: D1Database, id: string): Promise<User | null> {
  return db.prepare(`SELECT u.id, u.display_name AS displayName,
    (SELECT provider_uid FROM auth_identities WHERE user_id = u.id AND provider = 'phone' LIMIT 1) AS phone,
    (SELECT email FROM auth_identities WHERE user_id = u.id AND provider = 'google' LIMIT 1) AS email
    FROM users u WHERE u.id = ? AND u.status = 'active'`).bind(id).first<User>();
}

export async function identityUser(env: Env, provider: 'phone' | 'google' | 'line', uid: string, name: string, email: string | null = null): Promise<User> {
  const id = crypto.randomUUID();
  // D1 batches are transactions; the guarded insert avoids orphan users on races.
  const statements = [
    env.DB.prepare(`INSERT INTO users (id, display_name, created_at)
      SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM auth_identities WHERE provider = ? AND provider_uid = ?)`)
      .bind(id, name, now(), provider, uid),
    env.DB.prepare(`INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(provider, provider_uid) DO UPDATE SET email = excluded.email, verified_at = excluded.verified_at`)
      .bind(crypto.randomUUID(), id, provider, uid, email, now()),
  ];
  // Signup bonus (docs/phase5-onboarding.md): only when SIGNUP_CREDITS is a
  // positive integer, in the same transaction as the new user row.
  const bonus = signupCredits(env);
  if (bonus > 0) statements.push(signupBonusStatement(env.DB, id, bonus));
  await env.DB.batch(statements);
  const identity = await env.DB.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND provider_uid = ?').bind(provider, uid).first<{ user_id: string }>();
  const user = identity && await getUser(env.DB, identity.user_id);
  if (!user) throw new AuthError(403, 'บัญชีนี้ไม่สามารถเข้าสู่ระบบได้');
  return user;
}

export async function createSession(request: Request, env: Env, user: User): Promise<string> {
  const token = randomToken();
  const timestamp = now();
  const old = cookie(request, SESSION_COOKIE);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE id = ? OR expires_at <= ?').bind(old ? await sha256(old) : '', timestamp),
    env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), user.id, timestamp + SESSION_SECONDS, timestamp),
  ]);
  return cookieValue(env, SESSION_COOKIE, token, SESSION_SECONDS);
}

export async function requireUser(request: Request, env: Env): Promise<User | null> {
  const token = cookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const session = await env.DB.prepare('SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?')
    .bind(await sha256(token), now()).first<{ user_id: string }>();
  return session ? getUser(env.DB, session.user_id) : null;
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = cookie(request, SESSION_COOKIE);
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookieValue(env, SESSION_COOKIE, '', 0) } });
}
