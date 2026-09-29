import type { Env } from '../types';
import { appOrigin, AuthError } from './common';

const FAILURE = 'ยืนยันว่าไม่ใช่บอตไม่สำเร็จ กรุณาลองใหม่';
// Contract: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
export async function verifyTurnstile(request: Request, env: Env, token: unknown): Promise<void> {
  const origin = appOrigin(env);
  if (!env.TURNSTILE_SECRET_KEY?.trim()) {
    if (origin.protocol === 'http:') return; // appOrigin allows loopback HTTP only.
    throw new AuthError(503, 'ระบบยืนยันว่าไม่ใช่บอตยังไม่พร้อมใช้งาน');
  }
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) throw new AuthError(400, FAILURE);
  try {
    const body = new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token });
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body, redirect: 'manual', signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error();
    const result = await response.json() as { success?: unknown; hostname?: unknown; action?: unknown };
    if (result.success !== true || result.hostname !== origin.hostname || result.action !== 'otp_request') throw new Error();
  } catch { throw new AuthError(400, FAILURE); }
}
