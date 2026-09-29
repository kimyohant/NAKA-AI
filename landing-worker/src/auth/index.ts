import type { Env } from '../types';
import { getBalance } from '../credits';
import { appOrigin, AuthError, json, secret } from './common';
import { googleCallback, googleStart } from './google';
import { requestOtp, verifyOtp } from './otp';
import { logout, requireUser } from './session';

export { requireUser } from './session';

export async function handleAuth(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/auth' && !url.pathname.startsWith('/api/auth/')) return null;
  let response: Response;
  try {
    const paths: Record<string, string> = {
      '/api/auth/otp/request': 'POST', '/api/auth/otp/verify': 'POST',
      '/api/auth/google/start': 'GET', '/api/auth/google/callback': 'GET',
      '/api/auth/me': 'GET', '/api/auth/logout': 'POST', '/api/auth/config': 'GET',
    };
    const method = paths[url.pathname];
    if (!method) response = json({ error: 'ไม่พบเส้นทางที่ร้องขอ' }, 404);
    else if (request.method !== method) response = json({ error: 'วิธีเรียกใช้งานไม่ถูกต้อง' }, 405, { Allow: method });
    else {
      const origin = appOrigin(env).origin;
      secret(env);
      // Canonical origin prevents host-header redirects and cross-site login CSRF.
      if (new URL(request.url).origin !== origin) throw new AuthError(403, 'กรุณาเข้าสู่ระบบผ่านเว็บไซต์หลัก');
      if (method === 'POST' && (request.headers.get('Origin') !== origin ||
          request.headers.get('Sec-Fetch-Site') === 'cross-site')) throw new AuthError(403, 'คำขอไม่ถูกต้อง กรุณาลองใหม่จากเว็บไซต์');
      switch (url.pathname) {
        case '/api/auth/otp/request': response = await requestOtp(request, env); break;
        case '/api/auth/otp/verify': response = await verifyOtp(request, env); break;
        case '/api/auth/google/start': response = await googleStart(request, env); break;
        case '/api/auth/google/callback': response = await googleCallback(request, env, url); break;
        case '/api/auth/logout': response = await logout(request, env); break;
        // Public login settings. The Turnstile secret never leaves the Worker.
        case '/api/auth/config': response = json({ turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim() || null }); break;
        default: {
          const user = await requireUser(request, env);
          response = user ? json({ user, credits: await getBalance(env.DB, user.id) }) : json({ error: 'กรุณาเข้าสู่ระบบ' }, 401);
        }
      }
    }
  } catch (error) {
    if (error instanceof AuthError) {
      response = json({ error: error.message, ...(error.retryAfter === undefined ? {} : { retryAfter: error.retryAfter }) }, error.status,
        error.retryAfter === undefined ? {} : { 'Retry-After': String(error.retryAfter) });
    } else {
      // Do not log provider bodies, OAuth codes, phone numbers, or credentials.
      response = json({ error: 'ระบบเข้าสู่ระบบขัดข้อง กรุณาลองใหม่ภายหลัง' }, 500);
    }
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
