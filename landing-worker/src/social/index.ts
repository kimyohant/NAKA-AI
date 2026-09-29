import type { Env } from '../types';
import { appOrigin, json, now, SocialError } from './common';
import { serveMedia, upload } from './media';
import { metaCallback, metaStart } from './oauth';
import { listPosts, schedule } from './posts';
export { publishDuePosts } from './posts';

export async function handleSocial(request: Request, env: Env, url: URL, userId: string | null): Promise<Response | null> {
  if (url.pathname !== '/api/social' && !url.pathname.startsWith('/api/social/')) return null;
  let response: Response;
  try {
    const origin = appOrigin(env).origin;
    if (new URL(request.url).origin !== origin || url.origin !== origin) throw new SocialError(403, 'กรุณาใช้งานผ่านเว็บไซต์หลัก');
    const media = url.pathname.match(/^\/api\/social\/media\/([^/]+)$/);
    const account = url.pathname.match(/^\/api\/social\/accounts\/([^/]+)$/);
    const route = url.pathname.slice('/api/social/'.length);
    const allowed = media ? 'GET' : account ? 'DELETE' : ({ 'meta/start': 'GET', 'meta/callback': 'GET', accounts: 'GET', uploads: 'POST', posts: 'GET, POST' } as Record<string, string>)[route];
    if (!allowed) throw new SocialError(404, 'ไม่พบเส้นทางที่ร้องขอ');
    if (!allowed.split(', ').includes(request.method)) response = json({ error: 'วิธีเรียกใช้งานไม่ถูกต้อง' }, 405, { Allow: allowed });
    else if (media) response = await serveMedia(env, url, media[1]);
    else {
      if (!userId) throw new SocialError(401, 'กรุณาเข้าสู่ระบบ');
      if (['POST', 'DELETE'].includes(request.method) && (request.headers.get('Origin') !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site'))
        throw new SocialError(403, 'คำขอไม่ถูกต้อง กรุณาลองใหม่จากเว็บไซต์');
      if (route === 'meta/start') response = await metaStart(env, userId);
      else if (route === 'meta/callback') response = await metaCallback(request, env, url, userId);
      else if (route === 'accounts') response = json({ accounts: (await env.DB.prepare('SELECT id, platform, name, status FROM social_accounts WHERE user_id = ? ORDER BY created_at, id').bind(userId).all()).results });
      else if (account) {
        await env.DB.batch([
          env.DB.prepare("UPDATE social_accounts SET token_enc = '', token_expires_at = NULL, status = 'revoked' WHERE id = ? AND user_id = ?").bind(account[1], userId),
          env.DB.prepare("UPDATE scheduled_posts SET status = 'failed', error = 'account_disconnected', updated_at = ? WHERE social_account_id = ? AND user_id = ? AND status = 'queued'").bind(now(), account[1], userId),
        ]);
        response = new Response(null, { status: 204 });
      } else if (route === 'uploads') response = await upload(request, env, userId);
      else response = request.method === 'POST' ? await schedule(request, env, userId) : await listPosts(env, userId);
    }
  } catch (error) {
    response = error instanceof SocialError ? json({ error: error.message }, error.status) : json({ error: 'ระบบโซเชียลขัดข้อง กรุณาลองใหม่ภายหลัง' }, 500);
  }
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  return response;
}
