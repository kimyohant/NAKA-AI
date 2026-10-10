// GET /api/admin/audit: every admin action in one list, newest first (page /admin/audit/, docs/admin-backoffice.md).
// Two tables feed it, neither ever updated or deleted: admin_audit (one customer: credits, package, status,
// password, feature) and system_audit (settings, plans, studio cancels, LINE alerts, site content). Filters: source, actor
// and a search over the target, the customer's name and the note. 50 per page, keyset paged.
import type { Env } from '../types';

const BASE = '/api/admin/audit';
const PAGE = 50;
const SOURCES = ['customer', 'setting', 'plan', 'studio', 'alert', 'content', 'coupon', 'staff'];
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

// secrets never reach these tables (settings keep a hint only, src/system/admin.ts), so detail is safe to show
const UNION = `SELECT 'customer' AS source, a.id, a.action, a.user_id AS target, u.display_name AS "targetName",
    a.detail, a.note, a.actor, a.created_at AS "createdAt"
  FROM admin_audit a LEFT JOIN users u ON u.id = a.user_id
  UNION ALL
  SELECT s.area, s.id, s.action, s.target, NULL, s.detail, s.note, s.actor, s.created_at FROM system_audit s`;

export async function handleAdminAudit(request: Request, env: Env, url: URL): Promise<Response | null> {
  if (url.pathname !== BASE) return null;
  if (request.method !== 'GET') {
    const response = json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
    response.headers.set('Allow', 'GET');
    return response;
  }
  const source = url.searchParams.get('source') ?? '';
  const actor = url.searchParams.get('actor') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();
  const cursor = url.searchParams.get('cursor') ?? '';
  const match = /^(\d{1,12})\.([\w-]{1,100})$/.exec(cursor);
  if (source && !SOURCES.includes(source)) return json({ error: 'ประเภทไม่ถูกต้อง' }, 400);
  if (actor.length > 200 || q.length > 200) return json({ error: 'คำค้นต้องไม่เกิน 200 ตัวอักษร' }, 400);
  if (cursor && !match) return json({ error: 'ตำแหน่งหน้าไม่ถูกต้อง' }, 400);
  try {
    const [rows, actors] = await Promise.all([
      env.DB.prepare(`SELECT * FROM (${UNION}) x
        WHERE (?1 = '' OR source = ?1) AND (?2 = '' OR actor = ?2)
          AND (?3 = '' OR instr(lower(target), lower(?3)) > 0 OR instr(lower(COALESCE("targetName", '')), lower(?3)) > 0 OR instr(lower(note), lower(?3)) > 0)
          AND (?4 = 0 OR "createdAt" < ?4 OR ("createdAt" = ?4 AND id < ?5))
        ORDER BY "createdAt" DESC, id DESC LIMIT ?6`)
        .bind(source, actor, q, match ? Number(match[1]) : 0, match ? match[2] : '', PAGE + 1)
        .all<{ id: string; detail: string; createdAt: number }>(),
      env.DB.prepare(`SELECT actor FROM (SELECT actor FROM admin_audit UNION SELECT actor FROM system_audit) x WHERE actor <> '' ORDER BY actor`)
        .all<{ actor: string }>(),
    ]);
    const more = rows.results.length > PAGE;
    const list = rows.results.slice(0, PAGE);
    const last = list[list.length - 1];
    return json({
      entries: list.map(row => {
        let detail: unknown = null;
        try { detail = JSON.parse(row.detail); } catch { /* CHECK (json_valid) makes this unreachable */ }
        return { ...row, detail };
      }),
      actors: actors.results.map(r => r.actor),
      nextCursor: more && last ? `${last.createdAt}.${last.id}` : null,
    });
  } catch {
    console.error('admin audit: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
