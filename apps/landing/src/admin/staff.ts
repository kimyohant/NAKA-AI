// /api/admin/staff: owners add or remove support staff (page /admin/staff/). Owners themselves are ADMIN_EMAILS in the
// server config and are only listed here. A support account signs in with Google like an owner; what it may do is
// supportMay() in src/admin/auth.ts. Changes are recorded in system_audit under area 'staff'.
import type { Env } from '../types';
import { adminEmails, type AdminActor } from './auth';

const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

async function list(env: Env): Promise<Response> {
  const { results } = await env.DB.prepare(`SELECT email, role, note, added_by AS "addedBy", created_at AS "createdAt" FROM admin_staff ORDER BY created_at, email`).all();
  return json({ owners: [...adminEmails(env)].sort(), staff: results });
}

export async function handleAdminStaff(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  const BASE = '/api/admin/staff';
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  const path = url.pathname.slice(BASE.length), method = request.method;
  try {
    if (path === '' && method === 'GET') return await list(env);
    if (path === '' && method === 'POST') {
      let input: Record<string, unknown> = {};
      try { input = await request.json() as Record<string, unknown>; } catch { return json({ error: 'ข้อมูลไม่ถูกต้อง' }, 400); }
      const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
      const note = typeof input.note === 'string' ? input.note.trim() : '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return json({ error: 'กรุณากรอกอีเมล Google ให้ถูกต้อง' }, 400);
      if (note.length > 200) return json({ error: 'หมายเหตุต้องไม่เกิน 200 ตัวอักษร' }, 400);
      if (adminEmails(env).has(email)) return json({ error: 'อีเมลนี้เป็นเจ้าของระบบอยู่แล้ว (ADMIN_EMAILS)' }, 409);
      const added = await env.DB.prepare(`WITH s AS (INSERT INTO admin_staff (email, role, note, added_by, created_at) VALUES (?1, 'support', ?2, ?3, ?4)
          ON CONFLICT (email) DO NOTHING RETURNING email)
        INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
        SELECT ?5, 'staff', email, 'create', jsonb_build_object('role', 'support', 'note', ?2::text)::text, '', ?3, ?4 FROM s`)
        .bind(email, note, actor.label, now(), crypto.randomUUID()).run();
      if (!added.meta.changes) return json({ error: 'มีผู้ช่วยอีเมลนี้แล้ว' }, 409);
      return await list(env);
    }
    const one = path.match(/^\/([^/]{3,200})$/);
    if (one && method === 'DELETE') {
      let email: string;
      try { email = decodeURIComponent(one[1]).toLowerCase(); } catch { return json({ error: 'อีเมลไม่ถูกต้อง' }, 400); }
      const removed = await env.DB.prepare(`WITH s AS (DELETE FROM admin_staff WHERE email = ?1 RETURNING email, role)
        INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
        SELECT ?2, 'staff', email, 'remove', jsonb_build_object('role', role)::text, '', ?3, ?4 FROM s`)
        .bind(email, crypto.randomUUID(), actor.label, now()).run();
      if (!removed.meta.changes) return json({ error: 'ไม่พบผู้ช่วยนี้' }, 404);
      // the removed account's sign-in stops working at its next request: checkAdmin reads admin_staff every time
      return await list(env);
    }
    return json({ error: 'ไม่พบรายการนี้' }, 404);
  } catch {
    console.error('admin staff: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
