// Who may use /api/admin/*: a Google account listed in ADMIN_EMAILS with a recent sign-in, or the
// ADMIN_TOKEN bearer kept as a break-glass for when Google sign-in is unavailable.
import type { Env } from '../types';
import { appOrigin, constantTimeEqual, cookie, now, sha256 } from '../auth/common';
import { SESSION_COOKIE } from '../auth/session';

/** An admin session must come from a Google sign-in this recent; older ones sign in again. */
export const ADMIN_SESSION_SECONDS = 12 * 60 * 60;

export interface AdminActor { kind: 'google' | 'token'; label: string; userId: string | null }
export type AdminCheck = { actor: AdminActor } | { status: 401 | 403; error: string; reason: string };

/** Lower-cased addresses from ADMIN_EMAILS (comma or whitespace separated). */
export function adminEmails(env: Pick<Env, 'ADMIN_EMAILS'>): Set<string> {
  return new Set((env.ADMIN_EMAILS ?? '').split(/[\s,]+/).map(e => e.trim().toLowerCase()).filter(e => /^[^\s@]+@[^\s@]+$/.test(e)));
}

export async function checkAdmin(request: Request, env: Env): Promise<AdminCheck> {
  const header = request.headers.get('Authorization') ?? '';
  // An empty "Bearer " (a page with no stored token) falls through to the session.
  if (header.trim() && header.trim() !== 'Bearer') {
    return env.ADMIN_TOKEN && constantTimeEqual(header, `Bearer ${env.ADMIN_TOKEN}`)
      ? { actor: { kind: 'token', label: 'โทเคนฉุกเฉิน', userId: null } }
      : { status: 401, error: 'โทเคนไม่ถูกต้อง', reason: 'token' };
  }
  const token = cookie(request, SESSION_COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return { status: 401, error: 'กรุณาเข้าสู่ระบบด้วย Google', reason: 'signin' };
  // The session cookie is SameSite=Lax; a write must also come from our own pages.
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    let origin: string | null = null;
    try { origin = appOrigin(env).origin; } catch { /* unusable APP_ORIGIN: refuse below */ }
    if (!origin || request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return { status: 403, error: 'คำขอไม่ถูกต้อง กรุณาลองใหม่จากหน้าหลังร้าน', reason: 'origin' };
    }
  }
  const t = now();
  const session = await env.DB.prepare(`SELECT s.user_id AS userId, s.created_at AS createdAt FROM sessions s
    JOIN users u ON u.id = s.user_id AND u.status = 'active' WHERE s.id = ? AND s.expires_at > ?`)
    .bind(await sha256(token), t).first<{ userId: string; createdAt: number }>();
  if (!session) return { status: 401, error: 'กรุณาเข้าสู่ระบบด้วย Google', reason: 'signin' };
  const allowed = adminEmails(env);
  // Only addresses Google verified at sign-in count; a password account with the same email does not.
  const { results } = await env.DB.prepare(`SELECT email FROM auth_identities
    WHERE user_id = ? AND provider = 'google' AND verified_at IS NOT NULL AND email IS NOT NULL`).bind(session.userId).all<{ email: string }>();
  const email = results.map(r => r.email.toLowerCase()).find(e => allowed.has(e));
  if (!email) return { status: 403, error: 'บัญชีนี้ไม่ได้เป็นผู้ดูแลระบบ', reason: 'not_admin' };
  if (session.createdAt < t - ADMIN_SESSION_SECONDS) {
    return { status: 401, error: 'เข้าสู่ระบบนานเกิน 12 ชั่วโมง กรุณาเข้าสู่ระบบด้วย Google อีกครั้ง', reason: 'reauth' };
  }
  return { actor: { kind: 'google', label: email, userId: session.userId } };
}
