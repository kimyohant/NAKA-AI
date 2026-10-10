// /api/admin/studio-system/* — the back office's "ระบบ Studio" page (public/admin/studio-system/): the naka-studio
// version, disk use and video queues, and cancelling a stuck video task. naka-studio is read server to
// server (STUDIO_INTERNAL_URL, e.g. http://studio:5679 on the Docker network) with its ADMIN_TOKEN
// (STUDIO_ADMIN_TOKEN); the browser never talks to the studio or sees the token.
import type { Env } from '../types';
import type { AdminActor } from './auth';

const BASE = '/api/admin/studio-system';
const TIMEOUT_MS = 10_000;
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

/** naka-studio's response envelope: { code, data, message } */
interface StudioBody { data?: unknown; message?: unknown }

export class StudioSystemError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function target(env: Env): { base: string; token: string } {
  const base = (env.STUDIO_INTERNAL_URL ?? '').trim().replace(/\/+$/, '');
  const token = (env.STUDIO_ADMIN_TOKEN ?? '').trim();
  if (!base || !token) {
    throw new StudioSystemError(503, 'ยังไม่ได้เชื่อมต่อ naka-studio: ตั้ง "ที่อยู่ภายในของ naka-studio" และ "โทเคนแอดมินของ naka-studio" ในหน้าตั้งค่าระบบ');
  }
  if (!/^https?:\/\//i.test(base)) throw new StudioSystemError(503, 'ที่อยู่ภายในของ naka-studio ต้องขึ้นต้นด้วย http:// หรือ https://');
  return { base, token };
}

/** One call to the studio's /api/v1; answers its `data`, or throws a message the admin can act on. */
export async function studio(env: Env, path: string, method: 'GET' | 'POST' = 'GET', timeoutMs = TIMEOUT_MS): Promise<unknown> {
  const { base, token } = target(env);
  let response: Response;
  try {
    response = await fetch(`${base}/api/v1${path}`, {
      method,
      // the token must never follow a redirect to another host
      redirect: 'error',
      headers: { 'X-Admin-Token': token, Accept: 'application/json', ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      body: method === 'POST' ? '{}' : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new StudioSystemError(502, 'เชื่อมต่อ naka-studio ไม่ได้ ตรวจว่า studio ทำงานอยู่และที่อยู่ภายในถูกต้อง');
  }
  if (response.status === 401 || response.status === 403) {
    throw new StudioSystemError(502, 'naka-studio ไม่รับโทเคน ตรวจว่า "โทเคนแอดมินของ naka-studio" ตรงกับ ADMIN_TOKEN ของ studio');
  }
  let body: StudioBody | null = null;
  try { body = await response.json() as StudioBody; } catch { /* not JSON */ }
  if (!response.ok) {
    const message = typeof body?.message === 'string' ? body.message.slice(0, 300) : `HTTP ${response.status}`;
    throw new StudioSystemError(response.status === 400 ? 409 : 502, `naka-studio: ${message}`);
  }
  return body?.data ?? null;
}

/** `actor` comes from the shared router's checkAdmin() (admin Google account or ADMIN_TOKEN, Origin checked). */
export async function handleAdminStudioSystem(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  const path = url.pathname.slice(BASE.length);
  try {
    if (path === '' && request.method === 'GET') return json({ overview: await studio(env, '/system/overview') });
    const cancel = path.match(/^\/tasks\/([1-9]\d{0,15})\/cancel$/);
    if (cancel && request.method === 'POST') {
      const taskId = Number(cancel[1]);
      await studio(env, `/tasks/${taskId}/cancel`, 'POST');
      await env.DB.prepare('INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(crypto.randomUUID(), 'studio', `task:${taskId}`, 'cancel', JSON.stringify({ taskId }), '', actor.label, now()).run();
      return json({ ok: true, taskId });
    }
    return json({ error: 'not found' }, 404);
  } catch (error) {
    if (error instanceof StudioSystemError) return json({ error: error.message }, error.status);
    console.error('studio system admin error'); // no detail: requests here carry the studio token
    return json({ error: 'internal error' }, 500);
  }
}
