// The back office's read-only views across all customers (docs/admin-backoffice.md):
//   GET /api/admin/overview      ภาพรวม: sign-ups, revenue, packages, credits, queues, naka-studio health
//   GET /api/admin/payments      การเงิน: every payment, filtered, newest first, 50 per page
//   GET /api/admin/payments.csv  the same filter as a CSV file for accounting (up to 10,000 rows)
//   GET /api/admin/jobs          งานที่ล้มเหลว: failed landing jobs (credits refunded?) and naka-studio tasks
// Days and months are Thailand days (UTC+7), as the reporting views count them (infra/postgres/init/03-reporting.sql).
import type { Env } from '../types';
import type { AdminActor } from './auth';
import { studio, StudioSystemError } from './studio-system';

const BKK = 7 * 3600;
const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
class InsightError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Start of the Thailand day that contains `t` (unix seconds). */
export const bangkokDay = (t: number) => Math.floor((t + BKK) / DAY) * DAY - BKK;
/** Start of the Thailand month that contains `t`, `offset` months later (negative = earlier). */
export function bangkokMonth(t: number, offset = 0): number {
  const d = new Date((t + BKK) * 1000);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1) / 1000 - BKK;
}
/** credit_ledger and jobs keep SQLite-style text times in UTC: 'YYYY-MM-DD HH:MM:SS'. */
const utcText = (t: number) => new Date(t * 1000).toISOString().slice(0, 19).replace('T', ' ');
/** 'YYYY-MM-DD' of a Thailand day. */
const dayKey = (t: number) => new Date((t + BKK) * 1000).toISOString().slice(0, 10);
/** A 'YYYY-MM-DD' from a query string as the start of that Thailand day, or null. */
function parseDay(value: string | null, label: string): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const t = match ? Date.UTC(+match[1], +match[2] - 1, +match[3]) / 1000 - BKK : NaN;
  if (!match || !Number.isFinite(t) || dayKey(t) !== value) throw new InsightError(400, `${label}ต้องเป็นวันที่แบบ YYYY-MM-DD`);
  return t;
}

// ---------- ภาพรวม ----------

/** naka-studio's queue totals for the overview, or why they are missing. Never slows the page past 4 s. */
async function studioHealth(env: Env) {
  try {
    const overview = await studio(env, '/system/overview', 'GET', 4000) as { version?: string; videoQueues?: Record<string, number>[] } | null;
    if (!Array.isArray(overview?.videoQueues)) throw new StudioSystemError(502, 'naka-studio ตอบข้อมูลไม่ครบ อาจเป็นรุ่นเก่า ลองอัปเดต studio');
    const queues = overview.videoQueues;
    const sum = (field: string) => queues.reduce((total, q) => total + (Number(q[field]) || 0), 0);
    return { ok: true as const, version: overview?.version ?? null, providers: queues.length, queued: sum('queued'), running: sum('running'),
      unknown: sum('unknown'), completed24h: sum('completed24h'), failed24h: sum('failed24h') };
  } catch (error) {
    return { ok: false as const, error: error instanceof StudioSystemError ? error.message : 'อ่านข้อมูลจาก naka-studio ไม่ได้' };
  }
}

async function overview(env: Env): Promise<Response> {
  const t = now();
  const today = bangkokDay(t), week = today - 6 * DAY, month = bangkokMonth(t), lastMonth = bangkokMonth(t, -1), chartFrom = today - 13 * DAY;
  const db = env.DB;
  const [customers, revenue, payments, plans, credits, jobs, signupDays, revenueDays, studioState] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total,
        COUNT(*) FILTER (WHERE created_at >= ?1) AS today, COUNT(*) FILTER (WHERE created_at >= ?2) AS week,
        COUNT(*) FILTER (WHERE created_at >= ?3) AS month, COUNT(*) FILTER (WHERE status = 'disabled') AS disabled
      FROM users`).bind(today, week, month).first<Record<string, number>>(),
    // revenue counts a payment on the day it was paid
    db.prepare(`SELECT COALESCE(SUM(amount_satang) FILTER (WHERE COALESCE(paid_at, created_at) >= ?1), 0) AS today,
        COALESCE(SUM(amount_satang) FILTER (WHERE COALESCE(paid_at, created_at) >= ?2), 0) AS month,
        COUNT(*) FILTER (WHERE COALESCE(paid_at, created_at) >= ?2) AS "monthCount",
        COALESCE(SUM(amount_satang) FILTER (WHERE COALESCE(paid_at, created_at) >= ?3 AND COALESCE(paid_at, created_at) < ?2), 0) AS "lastMonth"
      FROM payments WHERE status = 'successful' AND COALESCE(paid_at, created_at) >= ?3`).bind(today, month, lastMonth).first<Record<string, number>>(),
    db.prepare(`SELECT COUNT(*) FILTER (WHERE status = 'pending' AND (expires_at IS NULL OR expires_at > ?1)) AS pending,
        COUNT(*) FILTER (WHERE status IN ('failed', 'expired') AND created_at >= ?2) AS "failed7d"
      FROM payments WHERE created_at >= ?2 OR status = 'pending'`).bind(t, today - 6 * DAY).first<Record<string, number>>(),
    db.prepare(`SELECT p.id, p.name, p.price_thb AS price, COUNT(s.user_id) AS members FROM plans p
      LEFT JOIN subscriptions s ON s.plan_id = p.id AND s.status = 'active' AND (s.expires_at IS NULL OR s.expires_at > ?1)
      WHERE p.id <> 'free' GROUP BY p.id, p.name, p.price_thb ORDER BY p.price_thb, p.id`).bind(t).all<{ id: string; name: string; price: number; members: number }>(),
    // used = holds minus refunds (an open studio hold counts: it is off the balance), as reporting.credits_used_by_user
    db.prepare(`SELECT -COALESCE(SUM(delta) FILTER (WHERE reason IN ('job_hold', 'job_refund')), 0) AS landing,
        -COALESCE(SUM(delta) FILTER (WHERE reason IN ('studio_hold', 'studio_refund')), 0) AS studio,
        COALESCE(SUM(delta) FILTER (WHERE reason IN ('grant', 'purchase')), 0) AS granted
      FROM credit_ledger WHERE created_at >= ?1`).bind(utcText(month)).first<Record<string, number>>(),
    db.prepare(`SELECT COUNT(*) FILTER (WHERE status = 'queued') AS queued, COUNT(*) FILTER (WHERE status = 'running') AS running,
        COUNT(*) FILTER (WHERE status = 'failed' AND updated_at >= ?1) AS "failed24h"
      FROM jobs WHERE status IN ('queued', 'running') OR updated_at >= ?1`).bind(utcText(t - DAY)).first<Record<string, number>>(),
    db.prepare(`SELECT to_char(to_timestamp(created_at) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day, COUNT(*) AS n
      FROM users WHERE created_at >= ?1 GROUP BY 1`).bind(chartFrom).all<{ day: string; n: number }>(),
    db.prepare(`SELECT to_char(to_timestamp(COALESCE(paid_at, created_at)) AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day, SUM(amount_satang) AS n
      FROM payments WHERE status = 'successful' AND COALESCE(paid_at, created_at) >= ?1 GROUP BY 1`).bind(chartFrom).all<{ day: string; n: number }>(),
    studioHealth(env),
  ]);
  const signups = new Map(signupDays.results.map(r => [r.day, r.n]));
  const income = new Map(revenueDays.results.map(r => [r.day, r.n]));
  const daily = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(chartFrom + i * DAY);
    return { day, signups: signups.get(day) ?? 0, revenue: (income.get(day) ?? 0) / 100 };
  });
  const baht = (satang: number | undefined) => (satang ?? 0) / 100;
  return json({
    generatedAt: t,
    customers: { total: customers?.total ?? 0, today: customers?.today ?? 0, week: customers?.week ?? 0, month: customers?.month ?? 0, disabled: customers?.disabled ?? 0 },
    revenue: { today: baht(revenue?.today), month: baht(revenue?.month), monthCount: revenue?.monthCount ?? 0, lastMonth: baht(revenue?.lastMonth) },
    payments: { pending: payments?.pending ?? 0, failed7d: payments?.failed7d ?? 0 },
    plans: plans.results,
    credits: { usedLanding: credits?.landing ?? 0, usedStudio: credits?.studio ?? 0, granted: credits?.granted ?? 0 },
    jobs: { queued: jobs?.queued ?? 0, running: jobs?.running ?? 0, failed24h: jobs?.failed24h ?? 0 },
    studio: studioState,
    daily,
  });
}

// ---------- การเงิน ----------

const PAYMENT_STATUSES = ['pending', 'successful', 'failed', 'expired'];
const PAYMENT_METHODS = ['promptpay', 'card', 'stripe_checkout'];
const PAGE = 50;
const CSV_MAX = 10_000;

interface PaymentRow {
  id: string; userId: string; name: string | null; email: string | null; phone: string | null; planId: string; planName: string | null;
  period: string; amountSatang: number; method: string; status: string; failure: string | null; expiresAt: number | null;
  createdAt: number; paidAt: number | null; receipt: string | null;
}

/** The WHERE clause and its bindings (?1 to ?5) for a payments filter from the query string. */
function paymentFilter(url: URL) {
  const status = url.searchParams.get('status') ?? '';
  const method = url.searchParams.get('method') ?? '';
  const q = (url.searchParams.get('q') ?? '').trim();
  if (status && !PAYMENT_STATUSES.includes(status)) throw new InsightError(400, 'สถานะไม่ถูกต้อง');
  if (method && !PAYMENT_METHODS.includes(method)) throw new InsightError(400, 'ช่องทางชำระเงินไม่ถูกต้อง');
  if (q.length > 200) throw new InsightError(400, 'คำค้นต้องไม่เกิน 200 ตัวอักษร');
  const from = parseDay(url.searchParams.get('from'), 'วันเริ่มต้น') ?? 0;
  const toDay = parseDay(url.searchParams.get('to'), 'วันสิ้นสุด');
  const to = toDay === null ? 4_102_444_800 : toDay + DAY; // the whole "to" day; no end = year 2100
  if (to <= from) throw new InsightError(400, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น');
  const phone = q.replace(/[\s()-]/g, '');
  const normalized = /^0\d{9}$/.test(phone) ? '+66' + phone.slice(1) : phone;
  // instr treats % and _ literally (customers.ts searches the same way)
  const where = `(?1 = '' OR p.status = ?1) AND (?2 = '' OR p.method = ?2) AND p.created_at >= ?3 AND p.created_at < ?4
    AND (?5 = '' OR instr(lower(p.id), lower(?5)) > 0 OR instr(lower(p.user_id), lower(?5)) > 0
      OR instr(lower(COALESCE(u.display_name, '')), lower(?5)) > 0
      OR EXISTS (SELECT 1 FROM auth_identities a WHERE a.user_id = p.user_id AND
        ((a.provider = 'phone' AND instr(a.provider_uid, ?6) > 0) OR instr(lower(a.email), lower(?5)) > 0)))`;
  return { where, binds: [status, method, from, to, q, normalized || q] as (string | number)[] };
}

const PAYMENT_SELECT = `SELECT p.id, p.user_id AS "userId", u.display_name AS name,
    (SELECT email FROM auth_identities WHERE user_id = p.user_id AND email IS NOT NULL ORDER BY provider, id LIMIT 1) AS email,
    (SELECT provider_uid FROM auth_identities WHERE user_id = p.user_id AND provider = 'phone' ORDER BY id LIMIT 1) AS phone,
    p.plan_id AS "planId", pl.name AS "planName", p.period, p.amount_satang AS "amountSatang", p.method, p.status, p.failure,
    p.expires_at AS "expiresAt", p.created_at AS "createdAt", p.paid_at AS "paidAt", r.number AS receipt
  FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN plans pl ON pl.id = p.plan_id LEFT JOIN receipts r ON r.payment_id = p.id`;

async function payments(env: Env, url: URL): Promise<Response> {
  const { where, binds } = paymentFilter(url);
  // keyset paging: "createdAt.id" of the last row shown
  const cursor = url.searchParams.get('cursor') ?? '';
  const match = /^(\d{1,12})\.(.{1,100})$/.exec(cursor);
  if (cursor && !match) throw new InsightError(400, 'ตำแหน่งหน้าไม่ถูกต้อง');
  const [rows, totals] = await Promise.all([
    env.DB.prepare(`${PAYMENT_SELECT} WHERE ${where}
      AND (?7 = 0 OR p.created_at < ?7 OR (p.created_at = ?7 AND p.id < ?8))
      ORDER BY p.created_at DESC, p.id DESC LIMIT ?9`)
      .bind(...binds, match ? Number(match[1]) : 0, match ? match[2] : '', PAGE + 1).all<PaymentRow>(),
    env.DB.prepare(`SELECT COUNT(*) AS count, COUNT(*) FILTER (WHERE p.status = 'successful') AS successful,
        COALESCE(SUM(p.amount_satang) FILTER (WHERE p.status = 'successful'), 0) AS "successfulSatang"
      FROM payments p LEFT JOIN users u ON u.id = p.user_id WHERE ${where}`).bind(...binds).first<Record<string, number>>(),
  ]);
  const more = rows.results.length > PAGE;
  const list = rows.results.slice(0, PAGE);
  const last = list[list.length - 1];
  return json({
    payments: list.map(row => ({ ...row, amount: row.amountSatang / 100 })),
    totals: { count: totals?.count ?? 0, successful: totals?.successful ?? 0, successfulAmount: (totals?.successfulSatang ?? 0) / 100 },
    nextCursor: more && last ? `${last.createdAt}.${last.id}` : null,
  });
}

const STATUS_TH: Record<string, string> = { pending: 'รอชำระ', successful: 'สำเร็จ', failed: 'ไม่สำเร็จ', expired: 'หมดเวลา' };
const METHOD_TH: Record<string, string> = { promptpay: 'พร้อมเพย์', card: 'บัตร', stripe_checkout: 'Stripe' };
const PERIOD_TH: Record<string, string> = { monthly: 'รายเดือน', yearly: 'รายปี' };
const bangkokTime = (t: number | null) => t ? new Date((t + BKK) * 1000).toISOString().slice(0, 16).replace('T', ' ') : '';
/** One CSV cell. Text a spreadsheet would run as a formula (= + - @, tab, CR) is prefixed with ' (OWASP CSV injection). */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

async function paymentsCsv(env: Env, url: URL): Promise<Response> {
  const { where, binds } = paymentFilter(url);
  const { results } = await env.DB.prepare(`${PAYMENT_SELECT} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT ?7`)
    .bind(...binds, CSV_MAX + 1).all<PaymentRow>();
  if (results.length > CSV_MAX) throw new InsightError(413, `มีมากกว่า ${CSV_MAX.toLocaleString('en-US')} รายการ กรุณาเลือกช่วงวันที่ให้สั้นลง`);
  const header = ['วันที่สร้าง (เวลาไทย)', 'วันที่ชำระ (เวลาไทย)', 'รหัสรายการ', 'ลูกค้า', 'รหัสลูกค้า', 'อีเมล', 'เบอร์โทร', 'แพ็กเกจ', 'รอบ',
    'ช่องทาง', 'สถานะ', 'จำนวนเงิน (บาท)', 'เลขใบเสร็จ', 'สาเหตุที่ไม่สำเร็จ'];
  const lines = [header.map(csvCell).join(',')];
  for (const p of results) {
    lines.push([bangkokTime(p.createdAt), bangkokTime(p.paidAt), p.id, p.name ?? '', p.userId, p.email ?? '', p.phone ?? '', p.planName ?? p.planId,
      PERIOD_TH[p.period] ?? p.period, METHOD_TH[p.method] ?? p.method, STATUS_TH[p.status] ?? p.status, (p.amountSatang / 100).toFixed(2),
      p.receipt ?? '', p.failure ?? ''].map(csvCell).join(','));
  }
  const name = `naka-ai-payments-${dayKey(now())}.csv`;
  // the BOM makes Excel read the Thai text as UTF-8
  return new Response('﻿' + lines.join('\r\n') + '\r\n', { headers: { 'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
}

// ---------- งานที่ล้มเหลว ----------

interface StudioFailed { days: number; total: number; tasks: { ownerUserId: string | null; creditHoldId?: number | null }[] }

async function failedJobs(env: Env, url: URL): Promise<Response> {
  const days = Math.min(30, Math.max(1, Math.trunc(Number(url.searchParams.get('days'))) || 7));
  const since = now() - days * DAY;
  const [landing, landingTotal, studioResult] = await Promise.all([
    env.DB.prepare(`SELECT j.id, j.user_id AS "userId", u.display_name AS name, j.kind, j.error, j.cost_credits AS cost,
        j.attempts, j.max_attempts AS "maxAttempts", j.created_at AS "createdAt", j.updated_at AS "failedAt",
        v.provider AS "videoProvider", v.kind AS "videoKind",
        CASE WHEN EXISTS (SELECT 1 FROM credit_ledger l WHERE l.job_id = j.id AND l.reason = 'job_refund') THEN 1 ELSE 0 END AS refunded
      FROM jobs j LEFT JOIN users u ON u.id = j.user_id LEFT JOIN ai_videos v ON v.job_id = j.id
      WHERE j.status = 'failed' AND j.updated_at >= ?1 ORDER BY j.updated_at DESC, j.id DESC LIMIT 100`)
      .bind(utcText(since)).all<{ error: string | null; refunded: number }>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND updated_at >= ?1`).bind(utcText(since)).first<{ n: number }>(),
    studio(env, `/system/failed-tasks?days=${days}`, 'GET', 6000)
      .then(data => {
        // an older studio has no such route; "nothing failed" must never stand in for "could not ask"
        if (!Array.isArray((data as StudioFailed | null)?.tasks)) throw new StudioSystemError(502, 'naka-studio รุ่นนี้ยังไม่มีรายการงานที่ล้มเหลว กรุณาอัปเดต studio');
        return { ok: true as const, data: data as StudioFailed };
      })
      .catch((error: unknown) => ({ ok: false as const, error: error instanceof StudioSystemError ? error.message : 'อ่านข้อมูลจาก naka-studio ไม่ได้' })),
  ]);
  let studioPart: { ok: true; total: number; tasks: unknown[] } | { ok: false; error: string };
  if (studioResult.ok) {
    const tasks = studioResult.data?.tasks ?? [];
    // the studio stores the naka-ai user id; show the customer's name next to it
    const owners = [...new Set(tasks.map(task => task.ownerUserId).filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200))];
    const names = new Map<string, string>();
    if (owners.length) {
      const { results } = await env.DB.prepare(`SELECT id, display_name AS name FROM users WHERE id IN (${owners.map(() => '?').join(', ')})`)
        .bind(...owners).all<{ id: string; name: string }>();
      for (const row of results) names.set(row.id, row.name);
    }
    // credits the studio held for each task (account.hold_credits, 0002_shared.sql): held, committed or refunded
    const holdIds = [...new Set(tasks.map(task => task.creditHoldId).filter((id): id is number => Number.isInteger(id) && (id as number) > 0))];
    const holds = new Map<number, { status: string; credits: number }>();
    if (holdIds.length) {
      const { results } = await env.DB.prepare(`SELECT h.ledger_id AS id, h.status, -l.delta AS credits FROM credit_holds h JOIN credit_ledger l ON l.id = h.ledger_id
        WHERE h.ledger_id IN (${holdIds.map(() => '?').join(', ')})`).bind(...holdIds).all<{ id: number; status: string; credits: number }>();
      for (const row of results) holds.set(row.id, { status: row.status, credits: row.credits });
    }
    studioPart = { ok: true, total: studioResult.data?.total ?? tasks.length,
      tasks: tasks.map(task => ({ ...task, customerName: task.ownerUserId ? names.get(task.ownerUserId) ?? null : null,
        customerKnown: !!task.ownerUserId && names.has(task.ownerUserId),
        credits: task.creditHoldId ? holds.get(task.creditHoldId) ?? null : null })) };
  } else studioPart = studioResult;
  return json({
    days,
    landing: { total: landingTotal?.n ?? 0, jobs: landing.results.map(row => ({ ...row, error: row.error ? row.error.slice(0, 300) : null, refunded: row.refunded === 1 })) },
    studio: studioPart,
  });
}

/** `actor` comes from the shared router's checkAdmin(): an admin Google account or ADMIN_TOKEN. */
export async function handleAdminInsights(request: Request, env: Env, url: URL, _actor: AdminActor): Promise<Response | null> {
  const routes: Record<string, (env: Env, url: URL) => Promise<Response>> = {
    '/api/admin/overview': (e) => overview(e),
    '/api/admin/payments': payments,
    '/api/admin/payments.csv': paymentsCsv,
    '/api/admin/jobs': failedJobs,
  };
  const route = routes[url.pathname];
  if (!route) return null;
  if (request.method !== 'GET') {
    const response = json({ error: 'ไม่รองรับวิธีเรียกใช้งานนี้' }, 405);
    response.headers.set('Allow', 'GET');
    return response;
  }
  try {
    return await route(env, url);
  } catch (error) {
    if (error instanceof InsightError) return json({ error: error.message }, error.status);
    console.error('admin insights: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
