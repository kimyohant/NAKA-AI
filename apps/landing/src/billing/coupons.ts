// Discount codes (migrations/pg/0009_coupons_staff.sql). A code takes a percentage (1 to 90) or a fixed amount in baht
// off one checkout. It can be limited to some packages, to monthly or yearly, to a time window, to a number of uses,
// and to a number of uses per customer. A use counts while its payment is paid, or pending and not yet expired, so a
// checkout left unpaid gives the use back by itself. The price after the discount is fixed when the payment is
// created (src/billing/index.ts checkout) and Stripe is asked for exactly that; it never goes below 10 baht
// (Stripe's minimum for THB).
import type { Env } from '../types';
import type { AdminActor } from '../admin/auth';

export const MIN_CHARGE_SATANG = 1000;
const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});
export class CouponError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface CouponRow {
  code: string; kind: 'percent' | 'amount'; value: number; plan_ids: string | null; period: string | null; max_uses: number | null;
  per_user: number; starts_at: number; ends_at: number | null; active: number; note: string; created_by: string; created_at: number;
}

/** Uses that count right now: paid, or pending and not yet expired. ?1 = code, ?2 = time. */
export const LIVE_USES = `(SELECT COUNT(*) FROM payments q WHERE q.coupon_code = ?1 AND (q.status = 'successful' OR (q.status = 'pending' AND q.expires_at > ?2)))`;

export const normalizeCode = (code: unknown) => typeof code === 'string' ? code.trim().toUpperCase() : '';

/** The discount in satang for a price, leaving at least the minimum charge. */
export function discountFor(coupon: Pick<CouponRow, 'kind' | 'value'>, priceSatang: number): number {
  const raw = coupon.kind === 'percent' ? Math.floor(priceSatang * coupon.value / 100) : coupon.value * 100;
  return Math.max(0, Math.min(raw, priceSatang - MIN_CHARGE_SATANG));
}

/** The coupon for this customer and checkout, or a Thai reason it cannot be used. */
export async function checkCoupon(env: Env, codeInput: unknown, userId: string, planId: string, period: string, priceSatang: number, t = now()) {
  const code = normalizeCode(codeInput);
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new CouponError(400, 'ไม่พบโค้ดส่วนลดนี้');
  const coupon = await env.DB.prepare(`SELECT c.*, ${LIVE_USES} AS uses,
      (SELECT COUNT(*) FROM payments q WHERE q.coupon_code = ?1 AND q.user_id = ?3 AND (q.status = 'successful' OR (q.status = 'pending' AND q.expires_at > ?2))) AS mine
    FROM coupons c WHERE c.code = ?1`).bind(code, t, userId).first<CouponRow & { uses: number; mine: number }>();
  if (!coupon || coupon.active !== 1) throw new CouponError(400, 'ไม่พบโค้ดส่วนลดนี้');
  if (coupon.starts_at > t) throw new CouponError(400, 'โค้ดนี้ยังไม่เริ่มใช้');
  if (coupon.ends_at !== null && coupon.ends_at <= t) throw new CouponError(400, 'โค้ดนี้หมดอายุแล้ว');
  const plans: string[] | null = coupon.plan_ids ? JSON.parse(coupon.plan_ids) : null;
  if (plans && !plans.includes(planId)) throw new CouponError(400, 'โค้ดนี้ใช้กับแพ็กเกจนี้ไม่ได้');
  if (coupon.period && coupon.period !== period) throw new CouponError(400, coupon.period === 'yearly' ? 'โค้ดนี้ใช้กับแบบรายปีเท่านั้น' : 'โค้ดนี้ใช้กับแบบรายเดือนเท่านั้น');
  if (coupon.max_uses !== null && coupon.uses >= coupon.max_uses) throw new CouponError(400, 'โค้ดนี้ถูกใช้ครบจำนวนแล้ว');
  if (coupon.mine >= coupon.per_user) throw new CouponError(400, 'คุณใช้โค้ดนี้ครบแล้ว (มีรายการที่ชำระแล้วหรือรอชำระอยู่)');
  const discount = discountFor(coupon, priceSatang);
  if (discount <= 0) throw new CouponError(400, 'แพ็กเกจนี้ลดราคาเพิ่มไม่ได้แล้ว');
  return { code, discount, label: coupon.kind === 'percent' ? `ลด ${coupon.value}%` : `ลด ${coupon.value.toLocaleString('en-US')} บาท` };
}

/** The same rules as checkCoupon, as one SQL condition, for the INSERT of the payment itself: two checkouts at the
 * last free use cannot both pass. ?code, ?t, ?user, ?plan, ?period are the placeholders given. */
export function couponStillValid(code: string, t: string, user: string, plan: string, period: string): string {
  const uses = (extra: string) => `(SELECT COUNT(*) FROM payments q WHERE q.coupon_code = c.code ${extra} AND (q.status = 'successful' OR (q.status = 'pending' AND q.expires_at > ${t})))`;
  return `EXISTS (SELECT 1 FROM coupons c WHERE c.code = ${code} AND c.active = 1 AND c.starts_at <= ${t} AND (c.ends_at IS NULL OR c.ends_at > ${t})
    AND (c.plan_ids IS NULL OR c.plan_ids::jsonb @> jsonb_build_array(${plan}::text)) AND (c.period IS NULL OR c.period = ${period})
    AND (c.max_uses IS NULL OR ${uses('')} < c.max_uses) AND ${uses(`AND q.user_id = ${user}`)} < c.per_user)`;
}

// ---------- admin API: /api/admin/coupons ----------

const audit = (env: Env, who: string, target: string, action: string, detail: unknown) =>
  env.DB.prepare(`INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, 'coupon', ?, ?, ?, '', ?, ?)`)
    .bind(crypto.randomUUID(), target, action, JSON.stringify(detail), who, now());

async function list(env: Env): Promise<Response> {
  const t = now();
  const { results } = await env.DB.prepare(`SELECT c.*,
      (SELECT COUNT(*) FROM payments q WHERE q.coupon_code = c.code AND q.status = 'successful') AS paid,
      (SELECT COUNT(*) FROM payments q WHERE q.coupon_code = c.code AND q.status = 'pending' AND q.expires_at > ?1) AS pending,
      (SELECT COALESCE(SUM(q.discount_satang), 0) FROM payments q WHERE q.coupon_code = c.code AND q.status = 'successful') AS "discountSatang"
    FROM coupons c ORDER BY c.created_at DESC, c.code LIMIT 200`).bind(t).all<CouponRow & { paid: number; pending: number; discountSatang: number }>();
  const plans = await env.DB.prepare("SELECT id, name FROM plans WHERE price_thb > 0 ORDER BY price_thb, id").all<{ id: string; name: string }>();
  return json({
    plans: plans.results,
    coupons: results.map(c => ({
      code: c.code, kind: c.kind, value: c.value, planIds: c.plan_ids ? JSON.parse(c.plan_ids) : null, period: c.period, maxUses: c.max_uses,
      perUser: c.per_user, startsAt: c.starts_at, endsAt: c.ends_at, active: c.active === 1, note: c.note, createdBy: c.created_by, createdAt: c.created_at,
      paid: c.paid, pending: c.pending, discountTotal: c.discountSatang / 100,
      state: c.active !== 1 ? 'off' : c.ends_at !== null && c.ends_at <= t ? 'ended' : c.starts_at > t ? 'scheduled'
        : c.max_uses !== null && c.paid + c.pending >= c.max_uses ? 'used_up' : 'live',
    })),
  });
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw new CouponError(400, 'กรุณาส่งข้อมูลเป็น JSON');
  const raw = await request.text();
  if (raw.length > 4096) throw new CouponError(413, 'ข้อมูลต้องไม่เกิน 4 KB');
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* below */ }
  throw new CouponError(400, 'ข้อมูลไม่ถูกต้อง');
}

const int = (v: unknown) => typeof v === 'number' && Number.isInteger(v) ? v : NaN;

async function create(request: Request, env: Env, who: string): Promise<Response> {
  const input = await body(request);
  const code = normalizeCode(input.code);
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new CouponError(400, 'โค้ดใช้ A-Z 0-9 _ - ยาว 3 ถึง 30 ตัว');
  const kind = input.kind === 'percent' || input.kind === 'amount' ? input.kind : null;
  if (!kind) throw new CouponError(400, 'เลือกลดเป็นเปอร์เซ็นต์หรือเป็นบาท');
  const value = int(input.value);
  if (!(value >= 1 && value <= (kind === 'percent' ? 90 : 100_000))) throw new CouponError(400, kind === 'percent' ? 'ส่วนลดต้องเป็น 1 ถึง 90 เปอร์เซ็นต์' : 'ส่วนลดต้องเป็น 1 ถึง 100,000 บาท');
  let planIds: string[] | null = null;
  if (input.planIds !== null && input.planIds !== undefined) {
    if (!Array.isArray(input.planIds) || !input.planIds.length || input.planIds.some(p => typeof p !== 'string')) throw new CouponError(400, 'เลือกแพ็กเกจที่ใช้ได้');
    const known = await env.DB.prepare(`SELECT COUNT(*) AS n FROM plans WHERE id IN (${input.planIds.map(() => '?').join(', ')}) AND price_thb > 0`).bind(...input.planIds).first<{ n: number }>();
    if (known?.n !== new Set(input.planIds).size) throw new CouponError(400, 'มีแพ็กเกจที่ไม่รู้จัก');
    planIds = [...new Set(input.planIds as string[])];
  }
  const period = input.period === 'monthly' || input.period === 'yearly' ? input.period : null;
  if (input.period !== null && input.period !== undefined && !period) throw new CouponError(400, 'รอบต้องเป็นรายเดือนหรือรายปี');
  const maxUses = input.maxUses === null || input.maxUses === undefined ? null : int(input.maxUses);
  if (maxUses !== null && !(maxUses >= 1 && maxUses <= 1_000_000)) throw new CouponError(400, 'จำนวนครั้งต้องเป็น 1 ขึ้นไป');
  const perUser = input.perUser === undefined ? 1 : int(input.perUser);
  if (!(perUser >= 1 && perUser <= 100)) throw new CouponError(400, 'จำนวนครั้งต่อคนต้องเป็น 1 ถึง 100');
  const startsAt = input.startsAt === null || input.startsAt === undefined ? now() : int(input.startsAt);
  const endsAt = input.endsAt === null || input.endsAt === undefined ? null : int(input.endsAt);
  if (!(startsAt >= 0) || (endsAt !== null && !(endsAt > startsAt))) throw new CouponError(400, 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  if (note.length > 200) throw new CouponError(400, 'หมายเหตุต้องไม่เกิน 200 ตัวอักษร');
  const after = { kind, value, planIds, period, maxUses, perUser, startsAt, endsAt, note };
  const inserted = await env.DB.prepare(`WITH c AS (
      INSERT INTO coupons (code, kind, value, plan_ids, period, max_uses, per_user, starts_at, ends_at, active, note, created_by, created_at)
      VALUES (?1, ?2, ?3, NULLIF(?4, ''), NULLIF(?5, ''), NULLIF(?6, 0), ?7, ?8, NULLIF(?9, 0), 1, ?10, ?11, ?12) ON CONFLICT (code) DO NOTHING RETURNING code)
    INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) SELECT ?13, 'coupon', code, 'create', ?14, '', ?11, ?12 FROM c`)
    .bind(code, kind, value, planIds ? JSON.stringify(planIds) : '', period ?? '', maxUses ?? 0, perUser, startsAt, endsAt ?? 0, note, who, now(),
      crypto.randomUUID(), JSON.stringify({ after })).run();
  if (!inserted.meta.changes) throw new CouponError(409, 'มีโค้ดนี้แล้ว');
  return list(env);
}

export async function handleAdminCoupons(request: Request, env: Env, url: URL, actor: AdminActor): Promise<Response | null> {
  const BASE = '/api/admin/coupons';
  if (url.pathname !== BASE && !url.pathname.startsWith(BASE + '/')) return null;
  const path = url.pathname.slice(BASE.length), method = request.method, who = actor.label;
  try {
    if (path === '' && method === 'GET') return await list(env);
    if (path === '' && method === 'POST') return await create(request, env, who);
    const one = path.match(/^\/([A-Z0-9_-]{3,30})$/);
    if (one && method === 'PUT') {
      const input = await body(request);
      if (typeof input.active !== 'boolean') throw new CouponError(400, 'ส่ง { active: true หรือ false }');
      const changed = await env.DB.prepare(`WITH c AS (UPDATE coupons SET active = ?2 WHERE code = ?1 RETURNING code)
        INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at)
        SELECT ?3, 'coupon', code, 'update', jsonb_build_object('after', jsonb_build_object('active', ?2 = 1))::text, '', ?4, ?5 FROM c`)
        .bind(one[1], input.active ? 1 : 0, crypto.randomUUID(), who, now()).run();
      if (!changed.meta.changes) throw new CouponError(404, 'ไม่พบโค้ดนี้');
      return await list(env);
    }
    return json({ error: 'ไม่พบรายการนี้' }, 404);
  } catch (error) {
    if (error instanceof CouponError) return json({ error: error.message }, error.status);
    console.error('admin coupons: request failed');
    return json({ error: 'ระบบขัดข้อง กรุณาลองใหม่' }, 500);
  }
}
