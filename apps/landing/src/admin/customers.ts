import type { Env } from '../types';
import type { AdminActor } from './auth';
import { constantTimeEqual } from '../auth/common';
import { ledgerFor } from '../credits';
import { hashPassword, temporaryPassword } from '../auth/password';

const BASE = '/api/admin/customers';
const MONTH = 30 * 86400;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class AdminError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
const CUSTOMER_SQL = `SELECT u.id, u.display_name AS name, u.status, u.created_at AS createdAt,
  (SELECT provider_uid FROM auth_identities WHERE user_id = u.id AND provider = 'phone' ORDER BY id LIMIT 1) AS phone,
  (SELECT email FROM auth_identities WHERE user_id = u.id AND provider IN ('google', 'password') ORDER BY provider, id LIMIT 1) AS email,
  CASE WHEN s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1) THEN s.plan_id ELSE 'free' END AS planId,
  s.expires_at AS expiresAt,
  (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = u.id) AS credits
  FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id`;

async function customers(env: Env, url: URL): Promise<Response> {
  const query = (url.searchParams.get('q') ?? '').trim();
  if (query.length > 200) throw new AdminError(400, 'คำค้นต้องไม่เกิน 200 ตัวอักษร');
  const phone = query.replace(/[\s()-]/g, '');
  const normalized = /^0\d{9}$/.test(phone) ? '+66' + phone.slice(1) : phone;
  // instr treats % and _ literally. All identities participate in the search, not just the displayed one.
  const { results } = await env.DB.prepare(`${CUSTOMER_SQL}
    WHERE ?2 = '' OR instr(lower(u.id), lower(?2)) > 0 OR instr(lower(u.display_name), lower(?2)) > 0
      OR EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = u.id AND
        ((a.provider = 'phone' AND instr(a.provider_uid, ?3) > 0) OR instr(lower(a.email), lower(?2)) > 0))
    ORDER BY u.created_at DESC, u.id LIMIT 50`).bind(Math.floor(Date.now() / 1000), query, normalized || query).all();
  return json({ customers: results });
}

async function detail(env: Env, userId: string): Promise<Response> {
  const customer = await env.DB.prepare(`${CUSTOMER_SQL} WHERE u.id = ?2`)
    .bind(Math.floor(Date.now() / 1000), userId).first();
  if (!customer) throw new AdminError(404, 'ไม่พบลูกค้านี้');
  const [subscription, ledger, payments, receipts, socialAccounts, audit, plans] = await Promise.all([
    env.DB.prepare(`SELECT s.plan_id AS planId, p.name AS planName, s.status, s.expires_at AS expiresAt,
      s.billing_period AS period, s.next_credit_at AS nextCreditAt FROM subscriptions s
      JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ?`).bind(userId).first(),
    ledgerFor(env.DB, userId, 50),
    env.DB.prepare(`SELECT id, plan_id AS planId, period, amount_satang / 100.0 AS amount, method, status,
      created_at AS createdAt, paid_at AS paidAt FROM payments WHERE user_id = ? ORDER BY created_at DESC, id LIMIT 20`).bind(userId).all(),
    env.DB.prepare('SELECT id, number FROM receipts WHERE user_id = ? ORDER BY issued_at DESC, year DESC, seq DESC').bind(userId).all(),
    // Explicit allowlist: token_enc and provider credentials never leave this module.
    env.DB.prepare('SELECT id, platform, name, status FROM social_accounts WHERE user_id = ? ORDER BY created_at DESC, id').bind(userId).all(),
    env.DB.prepare('SELECT id, action, detail, note, actor, created_at AS createdAt FROM admin_audit WHERE user_id = ? ORDER BY created_at DESC, rowid DESC')
      .bind(userId).all<{ id: string; action: string; detail: string; note: string; createdAt: number }>(),
    env.DB.prepare("SELECT id, name, monthly_credits AS monthlyCredits, price_thb AS price FROM plans WHERE price_thb > 0 AND id <> 'free' ORDER BY price_thb, id").all(),
  ]);
  return json({ customer, subscription, ledger, payments: payments.results, receipts: receipts.results,
    socialAccounts: socialAccounts.results, audit: audit.results.map(row => ({ ...row, detail: JSON.parse(row.detail) })), plans: plans.results });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AdminError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  }
  if (Number(request.headers.get('Content-Length')) > 4096) throw new AdminError(413, 'ข้อมูลต้องไม่เกิน 4 KB');
  const reader = request.body?.getReader();
  if (!reader) throw new AdminError(400, 'กรุณากรอกข้อมูล');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new AdminError(413, 'ข้อมูลต้องไม่เกิน 4 KB'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* fall through to the public error */ }
  throw new AdminError(400, 'ข้อมูล JSON ไม่ถูกต้อง');
}

type Action = 'credits' | 'package' | 'status';

/** The audit INSERT reads before/after inside the transaction. Effects use that immutable snapshot,
 * so parallel requests cannot lose a renewal or record a stale balance. No UPDATE/DELETE of audit.
 */
async function change(request: Request, env: Env, userId: string, action: Action, who: string): Promise<Response> {
  const data = await body(request);
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (!note || note.length > 200) throw new AdminError(400, 'กรุณาระบุเหตุผล 1–200 ตัวอักษร');
  let input: Record<string, unknown>;
  if (action === 'credits') {
    if (!Number.isInteger(data.amount) || Number(data.amount) < 1 || Number(data.amount) > 10000) {
      throw new AdminError(400, 'จำนวนเครดิตต้องเป็นจำนวนเต็ม 1–10000');
    }
    input = { amount: data.amount, note };
  } else if (action === 'package') {
    if (typeof data.planId !== 'string' || !data.planId || data.planId.length > 100 ||
      !Number.isInteger(data.months) || Number(data.months) < 1 || Number(data.months) > 12) {
      throw new AdminError(400, 'กรุณาเลือกแพ็กเกจและจำนวนเดือน 1–12');
    }
    input = { planId: data.planId, months: data.months, note };
  } else {
    if (data.status !== 'active' && data.status !== 'disabled') throw new AdminError(400, 'สถานะบัญชีไม่ถูกต้อง');
    input = { status: data.status, note };
  }
  if (!await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()) throw new AdminError(404, 'ไม่พบลูกค้านี้');
  if (action === 'package' && !await env.DB.prepare("SELECT id FROM plans WHERE id = ? AND id <> 'free' AND price_thb > 0").bind(input.planId).first()) {
    throw new AdminError(400, 'กรุณาเลือกแพ็กเกจที่มีราคา');
  }
  const id = crypto.randomUUID();
  const t = Math.floor(Date.now() / 1000);
  // jsonb: `before || jsonb_build_object(…)` overwrites the changed keys, like SQLite's json_set did.
  const before = `jsonb_build_object('status', status, 'credits', credits, 'planId', plan_id,
    'subscriptionStatus', sub_status, 'expiresAt', expires_at, 'nextCreditAt', next_credit_at,
    'period', billing_period, 'sessions', sessions)`;
  let after: string;
  if (action === 'credits') after = `${before} || jsonb_build_object('credits', credits + (?3::jsonb->>'amount')::bigint)`;
  else if (action === 'status') after = `${before} || jsonb_build_object('status', ?3::jsonb->>'status',
    'sessions', CASE WHEN ?3::jsonb->>'status' = 'disabled' THEN 0 ELSE sessions END)`;
  else after = `${before} || jsonb_build_object('planId', p.id, 'subscriptionStatus', 'active', 'period', 'monthly',
    'expiresAt', CASE WHEN extending = 1 THEN expires_at ELSE ?5 END + (?3::jsonb->>'months')::bigint * ${MONTH},
    'nextCreditAt', CASE WHEN extending = 1 AND next_credit_at IS NOT NULL THEN next_credit_at ELSE ?5 + ${MONTH} END,
    'credits', CASE WHEN extending = 1 THEN credits ELSE GREATEST(credits, p.monthly_credits) END)`;
  const stateSql = `SELECT u.status, s.plan_id, s.status AS sub_status, s.expires_at, s.next_credit_at, s.billing_period,
    (SELECT COALESCE(SUM(delta), 0) FROM credit_ledger WHERE user_id = u.id) AS credits,
    (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) AS sessions,
    CASE WHEN s.plan_id = ?3::jsonb->>'planId' AND s.status = 'active' AND s.expires_at > ?5 THEN 1 ELSE 0 END AS extending
    FROM users u LEFT JOIN subscriptions s ON s.user_id = u.id WHERE u.id = ?2`;
  const statements = [env.DB.prepare(`WITH state AS (${stateSql})
    INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at)
    SELECT ?1, ?2, ?6, jsonb_build_object('input', ?3::jsonb, 'before', ${before}, 'after', ${after})::text, ?4, ?7, ?5
    FROM state ${action === 'package' ? "JOIN plans p ON p.id = ?3::jsonb->>'planId' AND p.id <> 'free' AND p.price_thb > 0" : ''}`)
    .bind(id, userId, JSON.stringify(input), note, t, action, who)];

  if (action === 'credits' || action === 'package') {
    // Same grant ledger semantics as grantCredits(..., 'grant', note), but its standalone
    // .run() cannot join an audit transaction. Keep this INSERT in the one atomic batch.
    statements.push(env.DB.prepare(`INSERT INTO credit_ledger (user_id, delta, reason, note)
      SELECT user_id, (detail::jsonb->'after'->>'credits')::bigint - (detail::jsonb->'before'->>'credits')::bigint, 'grant', note
      FROM admin_audit WHERE id = ? AND (detail::jsonb->'after'->>'credits')::bigint > (detail::jsonb->'before'->>'credits')::bigint`).bind(id));
  }
  if (action === 'package') statements.push(env.DB.prepare(`INSERT INTO subscriptions
    (user_id, plan_id, status, billing_period, expires_at, next_credit_at, provider_ref, updated_at)
    SELECT user_id, detail::jsonb->'after'->>'planId', 'active', 'monthly',
      (detail::jsonb->'after'->>'expiresAt')::bigint, (detail::jsonb->'after'->>'nextCreditAt')::bigint, 'admin:' || id, datetime('now')
    FROM admin_audit WHERE id = ?
    ON CONFLICT(user_id) DO UPDATE SET plan_id = excluded.plan_id, status = excluded.status,
      billing_period = excluded.billing_period, expires_at = excluded.expires_at, next_credit_at = excluded.next_credit_at,
      provider_ref = excluded.provider_ref, updated_at = excluded.updated_at`).bind(id));
  if (action === 'status') {
    statements.push(env.DB.prepare(`UPDATE users SET status = (SELECT detail::jsonb->'after'->>'status' FROM admin_audit WHERE id = ?1)
      WHERE id = ?2 AND EXISTS (SELECT 1 FROM admin_audit WHERE id = ?1)`).bind(id, userId));
    statements.push(env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?2 AND EXISTS
      (SELECT 1 FROM admin_audit WHERE id = ?1 AND detail::jsonb->'after'->>'status' = 'disabled')`).bind(id, userId));
  }
  const [audit] = await env.DB.batch(statements);
  if (audit.meta.changes !== 1) throw new AdminError(409, 'ข้อมูลลูกค้าหรือแพ็กเกจเปลี่ยนแล้ว กรุณาโหลดใหม่');
  // Do not read detail after commit: a failed refresh must never look like a failed mutation.
  return json({ ok: true, auditId: id });
}

/** A forgotten password: a new random one, returned once for the admin to give the customer, every
 * session signed out, and the reset audited in the same transaction. The password itself is never stored or logged. */
async function resetPassword(request: Request, env: Env, userId: string, who: string): Promise<Response> {
  const data = await body(request);
  const note = typeof data.note === 'string' ? data.note.trim() : '';
  if (!note || note.length > 200) throw new AdminError(400, 'กรุณาระบุเหตุผล 1–200 ตัวอักษร');
  const account = await env.DB.prepare(`SELECT i.provider_uid AS email, (SELECT COUNT(*) FROM sessions WHERE user_id = ?1) AS sessions
    FROM auth_identities i JOIN auth_passwords p ON p.user_id = i.user_id WHERE i.user_id = ?1 AND i.provider = 'password'`)
    .bind(userId).first<{ email: string; sessions: number }>();
  if (!account) {
    if (!await env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(userId).first()) throw new AdminError(404, 'ไม่พบลูกค้านี้');
    throw new AdminError(400, 'ลูกค้านี้ไม่ได้สมัครด้วยอีเมลและรหัสผ่าน');
  }
  const password = temporaryPassword();
  const id = crypto.randomUUID();
  const t = Math.floor(Date.now() / 1000);
  const detail = JSON.stringify({ input: { note }, before: { email: account.email, sessions: account.sessions }, after: { sessions: 0 } });
  const [audit] = await env.DB.batch([
    env.DB.prepare(`INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at)
      SELECT ?, ?, 'password', ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_passwords WHERE user_id = ?)`).bind(id, userId, detail, note, who, t, userId),
    env.DB.prepare('UPDATE auth_passwords SET hash = ?, updated_at = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)')
      .bind(await hashPassword(password), t, userId, id),
    env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM admin_audit WHERE id = ?)').bind(userId, id),
  ]);
  if (audit.meta.changes !== 1) throw new AdminError(409, 'ข้อมูลลูกค้าเปลี่ยนแล้ว กรุณาโหลดใหม่');
  return json({ ok: true, auditId: id, temporaryPassword: password });
}

/** `actor` comes from the shared router's checkAdmin(); mounted without it, only ADMIN_TOKEN gets in. */
export async function handleAdminCustomers(request: Request, env: Env, url: URL, actor?: AdminActor): Promise<Response | null> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  if (!actor) {
    if (!env.ADMIN_TOKEN || !constantTimeEqual(request.headers.get('Authorization') ?? '', `Bearer ${env.ADMIN_TOKEN}`)) {
      return json({ error: 'กรุณาเข้าสู่ระบบหลังร้านอีกครั้ง' }, 401);
    }
    actor = { kind: 'token', label: 'โทเคนฉุกเฉิน', userId: null };
  }
  const who = actor.label;
  try {
    if (request.method === 'POST' && request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) {
      throw new AdminError(403, 'คำขอไม่ถูกต้อง');
    }
    if ((url.pathname === BASE || url.pathname === BASE + '/') && request.method === 'GET') return await customers(env, url);
    const match = url.pathname.slice(BASE.length).match(/^\/([^/]+)(?:\/(credits|package|status|password))?$/);
    if (!match) return json({ error: 'ไม่พบรายการนี้' }, 404);
    let userId: string;
    try { userId = decodeURIComponent(match[1]); } catch { throw new AdminError(400, 'รหัสลูกค้าไม่ถูกต้อง'); }
    if (!userId || userId.length > 200) throw new AdminError(400, 'รหัสลูกค้าไม่ถูกต้อง');
    if (!match[2] && request.method === 'GET') return await detail(env, userId);
    if (match[2] === 'password' && request.method === 'POST') return await resetPassword(request, env, userId, who);
    if (match[2] && request.method === 'POST') return await change(request, env, userId, match[2] as Action, who);
    const response = json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
    response.headers.set('Allow', match[2] ? 'POST' : 'GET');
    return response;
  } catch (error) {
    if (error instanceof AdminError) return json({ error: error.message }, error.status);
    console.error('admin customers: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาโหลดข้อมูลล่าสุดก่อนลองอีกครั้ง' }, 500);
  }
}
