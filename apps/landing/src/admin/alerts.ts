// LINE alerts for admins (migrations/pg/0007_admin_alerts.sql, page /admin/alerts/, docs/admin-backoffice.md).
//
// - Pairing: the page makes a one-time six-digit code; the admin sends "แจ้งเตือน 123456" to the shop's
//   LINE OA, and the webhook (handleAlertCommand) adds that LINE account as a recipient. "หยุดแจ้งเตือน"
//   removes it. Wrong codes count against every open code; five strikes close them.
// - The check (runAdminAlerts, every five minutes from the cron) looks at failed jobs, naka-studio, the
//   queue and payments, and pushes ONE message with whatever is new. A problem still there is repeated
//   after a two-hour cool-down; the studio and the queue also say when they are back to normal.
// - The admin API under /api/admin/alerts: read, pairing code, remove a recipient, rules, test message.
import type { Env } from '../types';
import type { AdminActor } from './auth';
import { readBodyBytes, sha256 } from '../auth/common';
import { pushText } from '../line';
import { studio, StudioSystemError } from './studio-system';

const BASE = '/api/admin/alerts';
const PAIRING_SECONDS = 10 * 60;
const MAX_WRONG_CODES = 5;
export const ALERT_COOLDOWN = 2 * 3600;
const WINDOW = 30 * 60; // failures counted in the last half hour
const STUCK_AFTER = 15 * 60;
const now = () => Math.floor(Date.now() / 1000);
const utcText = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class AlertError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export const ALERT_RULES = [
  { key: 'jobs_failed', label: 'งานสร้างล้มเหลว', help: 'งานของ naka-ai หรือ Naka Studio ล้มเหลวในครึ่งชั่วโมงล่าสุด' },
  { key: 'studio', label: 'Naka Studio มีปัญหา', help: 'เชื่อมต่อ studio ไม่ได้ หรือมีงานวิดีโอสถานะไม่ทราบผลยึดคิวไว้ และแจ้งเมื่อกลับมาปกติ' },
  { key: 'queue_stuck', label: 'คิวงานค้าง', help: 'งานของ naka-ai รอคิวเกิน 15 นาที (ตัวทำงานอาจหยุด) และแจ้งเมื่อกลับมาปกติ' },
  { key: 'payment_failed', label: 'ชำระเงินไม่สำเร็จ', help: 'มีการชำระเงินที่ไม่สำเร็จในครึ่งชั่วโมงล่าสุด' },
  { key: 'payment_paid', label: 'มีคนจ่ายเงิน', help: 'แจ้งทุกครั้งที่ชำระเงินสำเร็จ ใช้โควตาข้อความ LINE มากขึ้น' },
] as const;
type RuleKey = typeof ALERT_RULES[number]['key'];
const RULE_KEYS = new Set<string>(ALERT_RULES.map(r => r.key));
/** Conditions that also announce their recovery. */
const RECOVERS = new Set<string>(['studio', 'queue_stuck']);

const lineReady = (env: Env) => !!env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
const audit = (env: Env, who: string, target: string, action: string, detail: unknown) =>
  env.DB.prepare(`INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, 'alert', ?, ?, ?, '', ?, ?)`)
    .bind(crypto.randomUUID(), target, action, JSON.stringify(detail), who, now());

async function recipients(env: Env) {
  const { results } = await env.DB.prepare(`SELECT line_user_id AS id, display_name AS name, added_by AS "addedBy", created_at AS "createdAt"
    FROM admin_alert_recipients ORDER BY created_at, line_user_id`).all<{ id: string; name: string; addedBy: string; createdAt: number }>();
  return results;
}

/** Push one text to every recipient; answers how many LINE accepted. */
async function broadcast(env: Env, text: string, to: { id: string }[]): Promise<number> {
  let delivered = 0;
  for (const r of to) if (await pushText(env, r.id, text).catch(() => false)) delivered++;
  await env.DB.prepare('INSERT INTO admin_alert_log (text, recipients, delivered, created_at) VALUES (?, ?, ?, ?)')
    .bind(text, to.length, delivered, now()).run();
  return delivered;
}

// ---------- the five-minute check ----------

interface Condition { key: RuleKey; text: string }
interface StateRow { key: string; active: number; last_sent_at: number | null; seen_until: number | null }

async function conditions(env: Env, rules: Set<string>, t: number): Promise<Condition[]> {
  const found: Condition[] = [];
  const studioConfigured = !!env.STUDIO_INTERNAL_URL?.trim() && !!env.STUDIO_ADMIN_TOKEN?.trim();

  if (rules.has('jobs_failed')) {
    const landing = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND updated_at >= ?`)
      .bind(utcText(t - WINDOW)).first<{ n: number }>();
    let studioFailed = 0;
    if (studioConfigured) {
      try {
        const data = await studio(env, '/system/failed-tasks?days=1', 'GET', 6000) as { tasks?: { updatedAt?: string }[] } | null;
        studioFailed = (data?.tasks ?? []).filter(task => Date.parse(task.updatedAt ?? '') >= (t - WINDOW) * 1000).length;
      } catch { /* the studio rule reports an unreachable studio */ }
    }
    const total = (landing?.n ?? 0) + studioFailed;
    if (total) found.push({ key: 'jobs_failed', text: `งานล้มเหลว ${total} งานในครึ่งชั่วโมงล่าสุด (naka-ai ${landing?.n ?? 0}, Studio ${studioFailed})` });
  }

  if (rules.has('studio') && studioConfigured) {
    try {
      const overview = await studio(env, '/system/overview', 'GET', 6000) as { videoQueues?: { unknown?: number }[] } | null;
      if (!Array.isArray(overview?.videoQueues)) throw new StudioSystemError(502, 'naka-studio ตอบข้อมูลไม่ครบ');
      const unknown = overview.videoQueues.reduce((n, q) => n + (Number(q.unknown) || 0), 0);
      if (unknown) found.push({ key: 'studio', text: `Naka Studio มีงานวิดีโอสถานะไม่ทราบผล ${unknown} งาน ยึดคิวไว้ ยกเลิกได้ที่หน้า ระบบ Studio` });
    } catch (error) {
      found.push({ key: 'studio', text: `เชื่อมต่อ Naka Studio ไม่ได้: ${error instanceof StudioSystemError ? error.message : 'ไม่ทราบสาเหตุ'}` });
    }
  }

  if (rules.has('queue_stuck')) {
    const stuck = await env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued' AND run_after <= ?`)
      .bind(utcText(t - STUCK_AFTER)).first<{ n: number }>();
    if (stuck?.n) found.push({ key: 'queue_stuck', text: `งานรอคิวเกิน 15 นาที ${stuck.n} งาน ตัวทำงาน (cron) อาจหยุดอยู่` });
  }

  if (rules.has('payment_failed')) {
    const failed = await env.DB.prepare(`SELECT COUNT(*) AS n FROM payments WHERE status = 'failed' AND created_at >= ?`).bind(t - WINDOW).first<{ n: number }>();
    if (failed?.n) found.push({ key: 'payment_failed', text: `ชำระเงินไม่สำเร็จ ${failed.n} รายการในครึ่งชั่วโมงล่าสุด` });
  }
  return found;
}

/** Successful payments paid after `since`, as lines for the message (at most five, then a count). */
async function newPayments(env: Env, since: number, t: number): Promise<{ lines: string[]; until: number }> {
  const { results } = await env.DB.prepare(`SELECT p.amount_satang AS satang, COALESCE(p.paid_at, p.created_at) AS paid, pl.name AS plan, u.display_name AS name
    FROM payments p LEFT JOIN plans pl ON pl.id = p.plan_id LEFT JOIN users u ON u.id = p.user_id
    WHERE p.status = 'successful' AND COALESCE(p.paid_at, p.created_at) > ?1 AND COALESCE(p.paid_at, p.created_at) <= ?2
    ORDER BY paid, p.id`).bind(since, t).all<{ satang: number; paid: number; plan: string | null; name: string | null }>();
  const lines = results.slice(0, 5).map(p => `รับเงิน ฿${(p.satang / 100).toLocaleString('en-US')} แพ็กเกจ${p.plan ?? ''} จาก ${p.name || 'ลูกค้า'}`);
  if (results.length > 5) lines.push(`และรับเงินอีก ${results.length - 5} รายการ`);
  return { lines, until: t };
}

/** The cron's alert check. Never throws: a broken alert must not stop the other scheduled work. */
export async function runAdminAlerts(env: Env, t = now()): Promise<{ sent: boolean; lines: number }> {
  const db = env.DB;
  const [ruleRows, stateRows, to] = await Promise.all([
    db.prepare('SELECT key, enabled FROM admin_alert_rules').all<{ key: string; enabled: number }>(),
    db.prepare('SELECT key, active, last_sent_at, seen_until FROM admin_alert_state').all<StateRow>(),
    recipients(env),
  ]);
  const rules = new Set(ruleRows.results.filter(r => r.enabled === 1).map(r => r.key));
  const state = new Map(stateRows.results.map(r => [r.key, r]));
  const updates: D1PreparedStatement[] = [];
  const setState = (key: string, active: number, lastSent: number | null, seenUntil: number | null) => updates.push(
    db.prepare(`INSERT INTO admin_alert_state (key, active, last_sent_at, seen_until) VALUES (?, ?, ?, ?)
      ON CONFLICT (key) DO UPDATE SET active = excluded.active, last_sent_at = excluded.last_sent_at, seen_until = excluded.seen_until`)
      .bind(key, active, lastSent, seenUntil));

  // nobody to tell or no way to tell them: remember where payments are, so pairing later does not replay history
  if (!to.length || !lineReady(env)) {
    const paid = state.get('payment_paid');
    if (!paid || (paid.seen_until ?? 0) < t) setState('payment_paid', 0, paid?.last_sent_at ?? null, t);
    for (const row of state.values()) if (row.active && row.key !== 'payment_paid') setState(row.key, 0, row.last_sent_at, null);
    if (updates.length) await db.batch(updates);
    return { sent: false, lines: 0 };
  }

  const lines: string[] = [];
  const active = await conditions(env, rules, t);
  const activeKeys = new Set(active.map(c => c.key));
  for (const c of active) {
    const before = state.get(c.key);
    const due = !before?.active || before.last_sent_at === null || t - before.last_sent_at >= ALERT_COOLDOWN;
    if (due) lines.push(c.text);
    setState(c.key, 1, due ? t : before!.last_sent_at, null);
  }
  for (const row of state.values()) {
    if (row.key === 'payment_paid' || !row.active || activeKeys.has(row.key as RuleKey)) continue;
    if (RECOVERS.has(row.key) && rules.has(row.key)) lines.push(row.key === 'studio' ? 'Naka Studio กลับมาปกติแล้ว' : 'คิวงานกลับมาเดินปกติแล้ว');
    setState(row.key, 0, row.last_sent_at, null);
  }
  const paid = state.get('payment_paid');
  if (rules.has('payment_paid')) {
    const news = await newPayments(env, paid?.seen_until ?? t, t);
    lines.push(...news.lines);
    setState('payment_paid', 0, news.lines.length ? t : paid?.last_sent_at ?? null, news.until);
  } else setState('payment_paid', 0, paid?.last_sent_at ?? null, t);

  if (lines.length) {
    const origin = (env.APP_ORIGIN ?? '').replace(/\/+$/, '');
    await broadcast(env, ['แจ้งเตือนหลังร้าน naka-ai', ...lines.map(l => '• ' + l), origin ? `ดูที่ ${origin}/admin/` : ''].filter(Boolean).join('\n'), to);
  }
  await db.batch(updates);
  return { sent: lines.length > 0, lines: lines.length };
}

// ---------- LINE OA commands: pairing and stopping ----------

interface LineTextEvent { type: string; replyToken?: string; source: { type: string; userId?: string }; message?: { type: string; text?: string } }
const PAIR = /^\s*(?:แจ้งเตือน|alert)\s*[:#]?\s*(\d{6})\s*$/i;
const STOP = /^\s*(?:หยุดแจ้งเตือน|stop alerts?)\s*$/i;

async function reply(env: Env, replyToken: string, text: string) {
  await fetch('https://api.line.me/v2/bot/message/reply', { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}` },
    body: JSON.stringify({ replyToken, messages: [{ type: 'text', text }] }) }).catch(() => undefined);
}

/** A pairing or stop message for the admin alerts; true when the event was one (the sales bot then stays out). */
export async function handleAlertCommand(env: Env, event: LineTextEvent, displayName: (userId: string) => Promise<string>): Promise<boolean> {
  const text = event.type === 'message' && event.message?.type === 'text' ? event.message.text ?? '' : '';
  const userId = event.source.type === 'user' ? event.source.userId : undefined;
  if (!userId || !event.replyToken || !/^U[0-9a-f]{32}$/.test(userId)) return false;
  const t = now();
  if (STOP.test(text)) {
    const removed = await env.DB.prepare(`WITH gone AS (DELETE FROM admin_alert_recipients WHERE line_user_id = ?1 RETURNING line_user_id, display_name)
      INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
      SELECT ?2, 'alert', line_user_id, 'remove', jsonb_build_object('by', 'line', 'name', display_name)::text, '', 'LINE: ' || display_name, ?3 FROM gone`)
      .bind(userId, crypto.randomUUID(), t).run();
    if (!removed.meta.changes) return false; // not an admin: let the shop bot answer as usual
    await reply(env, event.replyToken, 'หยุดส่งแจ้งเตือนหลังร้านให้บัญชีนี้แล้ว');
    return true;
  }
  const code = PAIR.exec(text)?.[1];
  if (!code) return false;
  const hash = await sha256('admin-alert:' + code);
  const [taken] = await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_alert_pairings WHERE code_hash = ? AND expires_at > ? AND attempts < ? RETURNING created_by').bind(hash, t, MAX_WRONG_CODES),
    env.DB.prepare('DELETE FROM admin_alert_pairings WHERE expires_at <= ?').bind(t),
  ]);
  const createdBy = (taken.results[0] as { created_by?: string } | undefined)?.created_by;
  if (createdBy === undefined) {
    // a wrong guess counts against every open code
    await env.DB.batch([
      env.DB.prepare('UPDATE admin_alert_pairings SET attempts = attempts + 1').bind(),
      env.DB.prepare('DELETE FROM admin_alert_pairings WHERE attempts >= ?').bind(MAX_WRONG_CODES),
    ]);
    await reply(env, event.replyToken, 'รหัสไม่ถูกต้องหรือหมดอายุแล้ว สร้างรหัสใหม่ได้ที่หลังร้าน หน้าแจ้งเตือน LINE');
    return true;
  }
  const name = (await displayName(userId).catch(() => '')).slice(0, 100);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO admin_alert_recipients (line_user_id, display_name, added_by, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT (line_user_id) DO UPDATE SET display_name = excluded.display_name`).bind(userId, name, createdBy, t),
    audit(env, createdBy, userId, 'create', { name }),
  ]);
  await reply(env, event.replyToken, 'เชื่อมการแจ้งเตือนหลังร้าน naka-ai กับบัญชีนี้แล้ว\nพิมพ์ "หยุดแจ้งเตือน" เมื่อไม่ต้องการรับอีก');
  return true;
}

// ---------- admin API ----------

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new AlertError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  const bytes = await readBodyBytes(request, 4096);
  if (bytes === null) throw new AlertError(413, 'ข้อมูลต้องไม่เกิน 4 KB');
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* below */ }
  throw new AlertError(400, 'ข้อมูลไม่ถูกต้อง');
}

async function view(env: Env): Promise<Response> {
  const [list, rules, log, open] = await Promise.all([
    recipients(env),
    env.DB.prepare('SELECT key, enabled FROM admin_alert_rules').all<{ key: string; enabled: number }>(),
    env.DB.prepare(`SELECT id, text, recipients, delivered, created_at AS "createdAt" FROM admin_alert_log ORDER BY created_at DESC, id DESC LIMIT 20`).all(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM admin_alert_pairings WHERE expires_at > ? AND attempts < ?').bind(now(), MAX_WRONG_CODES).first<{ n: number }>(),
  ]);
  const enabled = new Map(rules.results.map(r => [r.key, r.enabled === 1]));
  return json({
    lineReady: lineReady(env),
    recipients: list,
    rules: ALERT_RULES.map(r => ({ ...r, enabled: enabled.get(r.key) ?? false })),
    log: log.results,
    openCodes: open?.n ?? 0,
  });
}

/** `actor` comes from the shared router's checkAdmin() (admin Google account or ADMIN_TOKEN, Origin checked for writes). */
export async function handleAdminAlerts(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  const path = url.pathname.slice(BASE.length);
  const method = request.method;
  const who = actor.label;
  try {
    if (path === '' && method === 'GET') return await view(env);
    if (path === '/pairing' && method === 'POST') {
      if (!lineReady(env)) throw new AlertError(409, 'ยังไม่ได้ตั้ง LINE OA Channel Access Token ในหน้าตั้งค่าระบบ');
      const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
      const code = String(digits).padStart(6, '0');
      const t = now();
      await env.DB.batch([
        env.DB.prepare('INSERT INTO admin_alert_pairings (code_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (code_hash) DO UPDATE SET expires_at = excluded.expires_at, attempts = 0, created_by = excluded.created_by')
          .bind(await sha256('admin-alert:' + code), t + PAIRING_SECONDS, who, t),
        audit(env, who, 'pairing', 'create', { expiresAt: t + PAIRING_SECONDS }),
      ]);
      return json({ code, expiresAt: t + PAIRING_SECONDS });
    }
    const remove = path.match(/^\/recipients\/(U[0-9a-f]{32})$/);
    if (remove && method === 'DELETE') {
      // one statement: the audit row exists exactly when a recipient was removed
      const deleted = await env.DB.prepare(`WITH gone AS (DELETE FROM admin_alert_recipients WHERE line_user_id = ?1 RETURNING line_user_id, display_name)
        INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
        SELECT ?2, 'alert', line_user_id, 'remove', jsonb_build_object('by', 'admin', 'name', display_name)::text, '', ?3, ?4 FROM gone`)
        .bind(remove[1], crypto.randomUUID(), who, now()).run();
      if (!deleted.meta.changes) throw new AlertError(404, 'ไม่พบผู้รับนี้ อาจถูกลบไปแล้ว');
      return await view(env);
    }
    if (path === '/rules' && method === 'PUT') {
      const input = await body(request);
      const changes = Object.entries(input).filter(([key]) => RULE_KEYS.has(key));
      if (!changes.length || changes.some(([, value]) => typeof value !== 'boolean')) throw new AlertError(400, 'ส่งเป็น { ชื่อการแจ้งเตือน: true หรือ false }');
      const t = now();
      await env.DB.batch([
        ...changes.map(([key, value]) => env.DB.prepare('UPDATE admin_alert_rules SET enabled = ?, updated_at = ? WHERE key = ?').bind(value ? 1 : 0, t, key)),
        audit(env, who, 'rules', 'update', { after: Object.fromEntries(changes) }),
      ]);
      return await view(env);
    }
    if (path === '/test' && method === 'POST') {
      if (!lineReady(env)) throw new AlertError(409, 'ยังไม่ได้ตั้ง LINE OA Channel Access Token ในหน้าตั้งค่าระบบ');
      const to = await recipients(env);
      if (!to.length) throw new AlertError(409, 'ยังไม่มีผู้รับแจ้งเตือน เพิ่มผู้รับก่อน');
      const delivered = await broadcast(env, `ทดสอบการแจ้งเตือนหลังร้าน naka-ai (ส่งโดย ${who})`, to);
      await audit(env, who, 'test', 'test', { recipients: to.length, delivered }).run();
      return json({ recipients: to.length, delivered });
    }
    return json({ error: 'ไม่พบรายการนี้' }, 404);
  } catch (error) {
    if (error instanceof AlertError) return json({ error: error.message }, error.status);
    console.error('admin alerts: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
