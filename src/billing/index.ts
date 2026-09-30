import type { Env } from "../types";
import { getBalance } from "../credits";
import { issueReceipt } from "../receipts";
import { createCardCharge, createPromptPayCharge, getCharge, OmiseError, verifyWebhook, type Charge } from "./omise";

// Prepaid packages for Thai customers: pay a month or a year with PromptPay QR or a card,
// and the package and its credits switch on when Omise confirms the charge.
// Prices always come from the plans table (migrations/0004_plans.sql), never from the browser.

const MONTH = 30 * 24 * 60 * 60;
const YEAR = 365 * 24 * 60 * 60;
const QR_MINUTES = 30;
const MAX_OPEN_CHECKOUTS_PER_HOUR = 5;

type Period = "monthly" | "yearly";
interface PlanRow { id: string; name: string; monthly_credits: number; max_parallel_jobs: number; price_thb: number }
interface PaymentRow {
  id: string; user_id: string; plan_id: string; period: Period; amount_satang: number; method: string;
  status: string; omise_charge_id: string | null; qr_image_url: string | null; expires_at: number | null;
}

class BillingError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const now = () => Math.floor(Date.now() / 1000);
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** Price in satang: yearly billing charges ten months. */
export function priceSatang(plan: Pick<PlanRow, "price_thb">, period: Period): number {
  return plan.price_thb * 100 * (period === "yearly" ? 10 : 1);
}

async function paidPlan(env: Env, planId: unknown): Promise<PlanRow> {
  if (typeof planId !== "string") throw new BillingError(400, "กรุณาเลือกแพ็กเกจ");
  const plan = await env.DB.prepare("SELECT * FROM plans WHERE id = ? AND price_thb > 0").bind(planId).first<PlanRow>();
  if (!plan) throw new BillingError(400, "ไม่พบแพ็กเกจนี้");
  return plan;
}

/**
 * Switch on the package for a successful payment, exactly once. The claim, the subscription and
 * the credit top-up are one D1 batch (one transaction), each guarded by the claim's token.
 * Paying again for the same, still-active package extends it; a new or different package starts now
 * and tops credits up to the package's monthly amount.
 */
export async function applyPayment(env: Env, paymentId: string): Promise<boolean> {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first<PaymentRow>();
  if (!payment || payment.status !== "pending") return false;
  const current = await env.DB.prepare("SELECT plan_id, status, expires_at FROM subscriptions WHERE user_id = ?")
    .bind(payment.user_id).first<{ plan_id: string; status: string; expires_at: number | null }>();
  const t = now();
  const extending = !!current && current.plan_id === payment.plan_id && current.status === "active" && (current.expires_at ?? 0) > t;
  const duration = payment.period === "yearly" ? YEAR : MONTH;
  const token = crypto.randomUUID();
  const claimed = "EXISTS (SELECT 1 FROM payments WHERE id = ?1 AND apply_token = ?2)";

  const statements = [
    env.DB.prepare("UPDATE payments SET status = 'successful', paid_at = ?3, apply_token = ?2 WHERE id = ?1 AND status = 'pending' AND apply_token IS NULL")
      .bind(payment.id, token, t),
    env.DB.prepare(
      `INSERT INTO subscriptions (user_id, plan_id, status, billing_period, expires_at, next_credit_at, provider_ref, updated_at)
       SELECT ?3, ?4, 'active', ?5, ?6 + ?7, ?6 + ${MONTH}, ?1, datetime('now') WHERE ${claimed}
       ON CONFLICT(user_id) DO UPDATE SET
         expires_at = CASE WHEN ?8 = 1 THEN subscriptions.expires_at + ?7 ELSE ?6 + ?7 END,
         next_credit_at = CASE WHEN ?8 = 1 AND subscriptions.next_credit_at IS NOT NULL THEN subscriptions.next_credit_at ELSE ?6 + ${MONTH} END,
         plan_id = excluded.plan_id, status = 'active', billing_period = excluded.billing_period,
         provider_ref = excluded.provider_ref, updated_at = excluded.updated_at`,
    ).bind(payment.id, token, payment.user_id, payment.plan_id, payment.period, t, duration, extending ? 1 : 0),
  ];
  if (!extending) statements.push(topUpStatement(env, payment.user_id, payment.plan_id, `แพ็กเกจ ${payment.plan_id}`, claimed, payment.id, token));
  const [claim] = await env.DB.batch(statements);
  return claim.meta.changes === 1;
}

/** Bring the balance up to the package's monthly credits (never takes credits away). */
function topUpStatement(env: Env, userId: string, planId: string, note: string, guard: string, ...guardArgs: (string | number)[]) {
  return env.DB.prepare(
    `INSERT INTO credit_ledger (user_id, delta, reason, note)
     SELECT ?3, p.monthly_credits - b.balance, 'purchase', ?5
     FROM plans p, (SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?3) b
     WHERE p.id = ?4 AND p.monthly_credits > b.balance AND ${guard}`,
  ).bind(...guardArgs, userId, planId, note);
}

/** Bring a payment in line with Omise's view of its charge. Only trusts a charge fetched from Omise. */
async function reconcile(env: Env, payment: PaymentRow, charge: Charge): Promise<void> {
  const matches = charge.id === payment.omise_charge_id && charge.amount === payment.amount_satang &&
    String(charge.currency).toUpperCase() === "THB" && charge.metadata?.payment_id === payment.id;
  if (!matches) {
    console.error("billing: charge does not match payment", payment.id);
    return;
  }
  if (charge.status === "successful" && charge.paid !== false) {
    // A receipt that fails here is issued by the cron backfill; it never undoes the payment.
    if (await applyPayment(env, payment.id)) await issueReceipt(env, payment.id).catch(() => console.error("billing: receipt deferred to cron"));
  }
  else if (charge.status === "failed" || charge.status === "expired") {
    await env.DB.prepare("UPDATE payments SET status = ?, failure = ? WHERE id = ? AND status = 'pending'")
      .bind(charge.status, charge.failure_code?.slice(0, 80) ?? null, payment.id).run();
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new BillingError(400, "กรุณาส่งข้อมูลเป็น JSON");
  const text = await request.text();
  if (text.length > 4096) throw new BillingError(413, "ข้อมูลยาวเกินไป");
  try {
    const value = JSON.parse(text);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* fall through */ }
  throw new BillingError(400, "ข้อมูลไม่ถูกต้อง");
}

async function checkout(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readBody(request);
  const plan = await paidPlan(env, body.planId);
  const period: Period = body.period === "yearly" ? "yearly" : body.period === "monthly" ? "monthly" : (() => { throw new BillingError(400, "กรุณาเลือกรายเดือนหรือรายปี"); })();
  const method = body.method === "card" ? "card" : body.method === "promptpay" ? "promptpay" : (() => { throw new BillingError(400, "กรุณาเลือกวิธีชำระเงิน"); })();
  if (method === "card" && (typeof body.token !== "string" || !/^tokn_[A-Za-z0-9_]{1,100}$/.test(body.token))) throw new BillingError(400, "ข้อมูลบัตรไม่ถูกต้อง กรุณากรอกใหม่");

  const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM payments WHERE user_id = ? AND status = 'pending' AND created_at > ?")
    .bind(userId, now() - 3600).first<{ n: number }>();
  if ((open?.n ?? 0) >= MAX_OPEN_CHECKOUTS_PER_HOUR) throw new BillingError(429, "มีรายการที่รอชำระหลายรายการแล้ว กรุณาชำระรายการเดิมหรือรอสักครู่");

  const amount = priceSatang(plan, period);
  const id = crypto.randomUUID();
  const expiresAt = method === "promptpay" ? now() + QR_MINUTES * 60 : null;
  await env.DB.prepare(`INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, userId, plan.id, period, amount, method, expiresAt, now()).run();

  let charge: Charge;
  try {
    charge = method === "promptpay"
      ? await createPromptPayCharge(env, { amount, paymentId: id, userId, expiresAt: expiresAt! })
      : await createCardCharge(env, { amount, token: body.token as string, paymentId: id, userId, returnUri: `${new URL(env.APP_ORIGIN).origin}/app/billing/?payment=${id}` });
  } catch (error) {
    // A timeout or 5xx does not say whether Omise created (and charged) the charge. Keep the
    // payment pending: the webhook finds it through the charge metadata and applies it.
    const unknown = !(error instanceof OmiseError) || error.message === "omise_network" || /^omise_5\d\d_/.test(error.message);
    if (unknown && method === "card") {
      console.error("billing: card charge outcome unknown", id);
      throw new BillingError(502, "ยังไม่ทราบผลการชำระด้วยบัตร กรุณาอย่าชำระซ้ำ ระบบจะอัปเดตแพ็กเกจให้เองภายในไม่กี่นาที หรือติดต่อทีมงาน");
    }
    await env.DB.prepare("UPDATE payments SET status = 'failed', failure = ? WHERE id = ?")
      .bind(error instanceof OmiseError ? error.message.slice(0, 80) : "omise_error", id).run();
    if (error instanceof OmiseError && error.message === "omise_not_configured") throw new BillingError(503, "ระบบชำระเงินออนไลน์ยังไม่เปิดใช้งาน กรุณาติดต่อทีมงาน");
    throw new BillingError(502, method === "card" ? "ชำระด้วยบัตรไม่สำเร็จ กรุณาตรวจข้อมูลบัตรหรือใช้ PromptPay" : "สร้าง QR ไม่สำเร็จ กรุณาลองใหม่");
  }
  const qr = charge.source?.scannable_code?.image?.download_uri ?? null;
  await env.DB.prepare("UPDATE payments SET omise_charge_id = ?, qr_image_url = ? WHERE id = ?").bind(charge.id, qr, id).run();
  const payment = (await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(id).first<PaymentRow>())!;
  await reconcile(env, payment, charge);

  const redirect = charge.status === "pending" && typeof charge.authorize_uri === "string" && charge.authorize_uri.startsWith("https://") ? charge.authorize_uri : null;
  return json({ paymentId: id, ...(await paymentView(env, id, userId)), ...(redirect ? { redirect } : {}) }, 201);
}

async function paymentView(env: Env, id: string, userId: string) {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?").bind(id, userId).first<PaymentRow>();
  if (!payment) throw new BillingError(404, "ไม่พบรายการชำระเงิน");
  return {
    status: payment.status, planId: payment.plan_id, period: payment.period, amount: payment.amount_satang / 100,
    method: payment.method, qrImageUrl: payment.status === "pending" ? payment.qr_image_url : null, expiresAt: payment.expires_at,
  };
}

async function refreshPayment(env: Env, id: string, userId: string): Promise<Response> {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?").bind(id, userId).first<PaymentRow>();
  if (!payment) throw new BillingError(404, "ไม่พบรายการชำระเงิน");
  if (payment.status === "pending" && payment.omise_charge_id) {
    try { await reconcile(env, payment, await getCharge(env, payment.omise_charge_id)); }
    catch { /* Omise unreachable: report the stored status; the webhook or the next poll catches up */ }
  }
  return json(await paymentView(env, id, userId));
}

async function billingState(env: Env, userId: string): Promise<Response> {
  const sub = await env.DB.prepare(`SELECT s.plan_id, s.status, s.expires_at, s.billing_period, s.next_credit_at, p.name
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ?`).bind(userId)
    .first<{ plan_id: string; status: string; expires_at: number | null; billing_period: string | null; next_credit_at: number | null; name: string }>();
  const plans = await env.DB.prepare("SELECT id, name, monthly_credits, max_parallel_jobs, price_thb FROM plans WHERE price_thb > 0 ORDER BY price_thb").all<PlanRow>();
  const active = sub && sub.status === "active" && (sub.expires_at === null || sub.expires_at > now());
  return json({
    subscription: active ? { planId: sub.plan_id, name: sub.name, expiresAt: sub.expires_at, period: sub.billing_period, nextCreditAt: sub.next_credit_at } : null,
    credits: await getBalance(env.DB, userId),
    plans: plans.results.map((p) => ({ id: p.id, name: p.name, monthlyCredits: p.monthly_credits, parallelJobs: p.max_parallel_jobs,
      monthly: priceSatang(p, "monthly") / 100, yearly: priceSatang(p, "yearly") / 100 })),
  });
}

/** /api/billing/* — userId comes from the session. */
export async function handleBilling(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/billing/")) return null;
  const path = url.pathname.slice("/api/billing".length);
  try {
    if (request.method === "POST" && request.headers.get("Origin") !== url.origin) throw new BillingError(403, "คำขอไม่ถูกต้อง");
    if (path === "/config" && request.method === "GET") return json({ publicKey: env.OMISE_PUBLIC_KEY?.trim() || null });
    if (path === "/me" && request.method === "GET") return await billingState(env, userId);
    if (path === "/checkout" && request.method === "POST") return await checkout(request, env, userId);
    const match = path.match(/^\/payments\/([0-9a-f-]{36})$/);
    if (match && request.method === "GET") return await refreshPayment(env, match[1], userId);
    return json({ error: "not found" }, 404);
  } catch (error) {
    if (error instanceof BillingError) return json({ error: error.message }, error.status);
    console.error("billing error");
    return json({ error: "ระบบชำระเงินขัดข้อง กรุณาลองใหม่" }, 500);
  }
}

/** POST /webhook/omise — signed by Omise; the charge is re-read from Omise before anything changes. */
export async function handleOmiseWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  if (!env.OMISE_WEBHOOK_SECRET?.trim() || !env.OMISE_SECRET_KEY?.trim()) return new Response(null, { status: 503 });
  const raw = await request.text();
  if (raw.length > 256 * 1024 || !(await verifyWebhook(env, request.headers, raw, now()))) return new Response(null, { status: 401 });
  let event: { key?: unknown; data?: { object?: unknown; id?: unknown } };
  try { event = JSON.parse(raw); } catch { return new Response(null, { status: 400 }); }
  if (event.key !== "charge.complete" || event.data?.object !== "charge" || typeof event.data.id !== "string") return new Response(null, { status: 204 });
  try {
    let payment = await env.DB.prepare("SELECT * FROM payments WHERE omise_charge_id = ?").bind(event.data.id).first<PaymentRow>();
    let charge: Charge | null = null;
    if (!payment) {
      // The checkout lost Omise's reply (timeout), so the charge id was never stored. Link it
      // through the metadata of the charge as Omise reports it, never through the webhook body.
      charge = await getCharge(env, event.data.id);
      const paymentId = charge.metadata?.payment_id;
      if (typeof paymentId !== "string") return new Response(null, { status: 204 });
      payment = await env.DB.prepare("UPDATE payments SET omise_charge_id = ? WHERE id = ? AND omise_charge_id IS NULL AND status = 'pending' RETURNING *")
        .bind(charge.id, paymentId).first<PaymentRow>();
      if (!payment) return new Response(null, { status: 204 });
    }
    await reconcile(env, payment, charge ?? await getCharge(env, event.data.id));
  } catch {
    return new Response(null, { status: 503 }); // let Omise or the next poll try again
  }
  return new Response(null, { status: 204 });
}

/** Cron: end expired packages, give monthly credits to active ones, and close stale QR checkouts. */
export async function runBillingCron(env: Env, { maxTopUps = 50 } = {}): Promise<{ expired: number; toppedUp: number }> {
  const t = now();
  const [expired] = await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?").bind(t),
    env.DB.prepare("UPDATE payments SET status = 'expired' WHERE status = 'pending' AND method = 'promptpay' AND expires_at <= ?").bind(t - 3600),
  ]);
  const due = await env.DB.prepare(`SELECT user_id, plan_id, next_credit_at FROM subscriptions
    WHERE status = 'active' AND next_credit_at IS NOT NULL AND next_credit_at <= ? AND (expires_at IS NULL OR expires_at > ?) LIMIT ?`)
    .bind(t, t, maxTopUps).all<{ user_id: string; plan_id: string; next_credit_at: number }>();
  let toppedUp = 0;
  for (const sub of due.results) {
    const next = sub.next_credit_at + MONTH;
    const [claim] = await env.DB.batch([
      env.DB.prepare("UPDATE subscriptions SET next_credit_at = ?3 WHERE user_id = ?1 AND next_credit_at = ?2").bind(sub.user_id, sub.next_credit_at, next),
      topUpStatement(env, sub.user_id, sub.plan_id, "เครดิตประจำเดือน",
        "EXISTS (SELECT 1 FROM subscriptions WHERE user_id = ?1 AND next_credit_at = ?2)", sub.user_id, next),
    ]);
    if (claim.meta.changes === 1) toppedUp++;
  }
  return { expired: expired.meta.changes, toppedUp };
}
