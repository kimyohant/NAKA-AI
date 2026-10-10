// Announcements to customers (page /admin/content/, table announcements): one line at the top of the site's
// pages, e.g. planned maintenance or a promotion. GET /api/announcement answers the newest active one in its
// time window; /announce.js (loaded by /account-menu.js on the home, member and login pages) shows it, and a
// customer can close it for themselves.
import type { Env } from '../types';
import type { AdminActor } from '../admin/auth';

const TONES = ['info', 'promo', 'warning'];
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200, cache = 'no-store') => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache },
});
class AnnouncementError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

interface Row { id: string; message: string; link_url: string | null; link_label: string; tone: string; starts_at: number; ends_at: number | null; active: number; created_by: string; created_at: number }

/** GET /api/announcement: public, cached a minute by browsers and proxies. */
export async function handleAnnouncement(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== '/api/announcement') return null;
  if (request.method !== 'GET') return json({ error: 'method not allowed' }, 405);
  try {
    const t = now();
    const row = await env.DB.prepare(`SELECT id, message, link_url, link_label, tone FROM announcements
      WHERE active = 1 AND starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1) ORDER BY starts_at DESC, created_at DESC LIMIT 1`).bind(t).first<Row>();
    return json({ announcement: row ? { id: row.id, message: row.message, linkUrl: row.link_url, linkLabel: row.link_label, tone: row.tone } : null },
      200, 'public, max-age=60');
  } catch {
    return json({ announcement: null }, 200, 'no-store'); // a broken announcement must never break a page
  }
}

const audit = (env: Env, who: string, target: string, action: string, detail: unknown) =>
  env.DB.prepare(`INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, 'content', ?, ?, ?, '', ?, ?)`)
    .bind(crypto.randomUUID(), target, action, JSON.stringify(detail), who, now());

function fields(input: Record<string, unknown>) {
  const message = typeof input.message === 'string' ? input.message.trim() : '';
  if (!message || message.length > 200 || /[\u0000-\u001f\u007f]/.test(message)) throw new AnnouncementError(400, 'ข้อความต้องยาว 1 ถึง 200 ตัวอักษร ไม่ขึ้นบรรทัดใหม่');
  const linkUrl = typeof input.linkUrl === 'string' && input.linkUrl.trim() ? input.linkUrl.trim() : null;
  if (linkUrl && (linkUrl.length > 500 || !/^(https:\/\/[^\s<>"]+|\/[^/\s<>"][^\s<>"]*)$/.test(linkUrl))) {
    throw new AnnouncementError(400, 'ลิงก์ต้องขึ้นต้นด้วย https:// หรือเป็นหน้าในเว็บ เช่น /pricing/');
  }
  const linkLabel = typeof input.linkLabel === 'string' ? input.linkLabel.trim() : '';
  if (linkLabel.length > 30) throw new AnnouncementError(400, 'ข้อความบนลิงก์ต้องไม่เกิน 30 ตัวอักษร');
  if (linkUrl && !linkLabel) throw new AnnouncementError(400, 'กรุณาใส่ข้อความบนลิงก์ เช่น "ดูรายละเอียด"');
  const tone = typeof input.tone === 'string' && TONES.includes(input.tone) ? input.tone : null;
  if (!tone) throw new AnnouncementError(400, 'รูปแบบประกาศไม่ถูกต้อง');
  const startsAt = input.startsAt === undefined || input.startsAt === null ? now() : input.startsAt;
  const endsAt = input.endsAt === undefined || input.endsAt === null ? null : input.endsAt;
  if (typeof startsAt !== 'number' || !Number.isInteger(startsAt) || startsAt < 0) throw new AnnouncementError(400, 'เวลาเริ่มไม่ถูกต้อง');
  if (endsAt !== null && (typeof endsAt !== 'number' || !Number.isInteger(endsAt) || endsAt <= startsAt)) throw new AnnouncementError(400, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  return { message, linkUrl, linkLabel: linkUrl ? linkLabel : '', tone, startsAt, endsAt: endsAt as number | null };
}

async function list(env: Env): Promise<Response> {
  const t = now();
  const { results } = await env.DB.prepare(`SELECT * FROM announcements ORDER BY starts_at DESC, created_at DESC, id DESC LIMIT 50`).all<Row>();
  const live = await env.DB.prepare(`SELECT id FROM announcements WHERE active = 1 AND starts_at <= ?1 AND (ends_at IS NULL OR ends_at > ?1)
    ORDER BY starts_at DESC, created_at DESC LIMIT 1`).bind(t).first<{ id: string }>();
  return json({ announcements: results.map(r => ({
    id: r.id, message: r.message, linkUrl: r.link_url, linkLabel: r.link_label, tone: r.tone, startsAt: r.starts_at, endsAt: r.ends_at,
    active: r.active === 1, createdBy: r.created_by, createdAt: r.created_at,
    // what customers see right now: only the newest live one is shown
    state: r.id === live?.id ? 'showing' : r.active !== 1 ? 'off' : r.ends_at !== null && r.ends_at <= t ? 'ended' : r.starts_at > t ? 'scheduled' : 'covered',
  })) });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AnnouncementError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  const raw = await request.text();
  if (raw.length > 8192) throw new AnnouncementError(413, 'ข้อมูลต้องไม่เกิน 8 KB');
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* below */ }
  throw new AnnouncementError(400, 'ข้อมูลไม่ถูกต้อง');
}

export async function handleAdminAnnouncements(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  const BASE = '/api/admin/content/announcements';
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  const path = url.pathname.slice(BASE.length), method = request.method, who = actor.label;
  try {
    if (path === '' && method === 'GET') return await list(env);
    if (path === '' && method === 'POST') {
      const f = fields(await body(request));
      const id = crypto.randomUUID(), t = now();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO announcements (id, message, link_url, link_label, tone, starts_at, ends_at, active, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).bind(id, f.message, f.linkUrl, f.linkLabel, f.tone, f.startsAt, f.endsAt, who, t, t),
        audit(env, who, 'announcement:' + id, 'create', { after: f }),
      ]);
      return await list(env);
    }
    const one = path.match(/^\/([0-9a-f-]{36})$/);
    if (one && method === 'PUT') {
      const input = await body(request);
      if (typeof input.active !== 'boolean') throw new AnnouncementError(400, 'ส่ง { active: true หรือ false }');
      const changed = await env.DB.prepare(`WITH c AS (UPDATE announcements SET active = ?2, updated_at = ?3 WHERE id = ?1 RETURNING id, message)
        INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
        SELECT ?4, 'content', 'announcement:' || id, 'update', jsonb_build_object('message', message, 'after', jsonb_build_object('active', ?2 = 1))::text, '', ?5, ?3 FROM c`)
        .bind(one[1], input.active ? 1 : 0, now(), crypto.randomUUID(), who).run();
      if (!changed.meta.changes) throw new AnnouncementError(404, 'ไม่พบประกาศนี้');
      return await list(env);
    }
    if (one && method === 'DELETE') {
      const gone = await env.DB.prepare(`WITH c AS (DELETE FROM announcements WHERE id = ?1 RETURNING id, message)
        INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
        SELECT ?2, 'content', 'announcement:' || id, 'remove', jsonb_build_object('message', message)::text, '', ?3, ?4 FROM c`)
        .bind(one[1], crypto.randomUUID(), who, now()).run();
      if (!gone.meta.changes) throw new AnnouncementError(404, 'ไม่พบประกาศนี้');
      return await list(env);
    }
    return json({ error: 'ไม่พบรายการนี้' }, 404);
  } catch (error) {
    if (error instanceof AnnouncementError) return json({ error: error.message }, error.status);
    console.error('admin announcements: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
