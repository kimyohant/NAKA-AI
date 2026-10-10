import type { Env } from "../types";
import { readBodyBytes } from "../auth/common";
import { getBalance } from "../credits";
import { issueReceipt } from "../receipts";
import { checkCoupon, CouponError, couponStillValid, normalizeCode } from "./coupons";
import { createCheckoutSession, getCheckoutSession, stripeClient, verifyWebhookEvent, type CheckoutSession } from "./stripe";

// Prepaid packages for Thai customers: pay a month or a year on Stripe's hosted Checkout page
// (PromptPay or card, whichever Stripe offers), and the package and its credits switch on when
// Stripe confirms the payment. Prices always come from the plans table (migrations/0004_plans.sql),
// never from the browser.

const MONTH = 30 * 24 * 60 * 60;
const YEAR = 365 * 24 * 60 * 60;
const CHECKOUT_MINUTES = 60; // Stripe allows 30 minutes to 24 hours
const MAX_OPEN_CHECKOUTS_PER_HOUR = 5;

type Period = "monthly" | "yearly";
interface PlanRow { id: string; name: string; monthly_credits: number; max_parallel_jobs: number; price_thb: number }
interface PaymentRow {
  id: string; user_id: string; plan_id: string; period: Period; amount_satang: number; method: string;
  status: string; stripe_session_id: string | null; expires_at: number | null; coupon_code: string | null; discount_satang: number;
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
  const plan = await env.DB.prepare("SELECT * FROM plans WHERE id = ? AND price_thb > 0 AND on_sale = 1").bind(planId).first<PlanRow>();
  if (!plan) throw new BillingError(400, "ไม่พบแพ็กเกจนี้");
  return plan;
}

/**
 * Switch on the package for a successful payment, exactly once. The claim, the subscription and
 * the credit top-up are one D1 batch (one transaction), each guarded by the claim's token.
 * Paying again for the same, still-active package extends it; a new or different package starts now
 * and tops credits up to the package's monthly amount. Whether it extends is decided inside the batch,
 * so two payments applied at the same time still add up.
 */
export async function applyPayment(env: Env, paymentId: string): Promise<boolean> {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ?").bind(paymentId).first<PaymentRow>();
  if (!payment || payment.status !== "pending") return false;
  const t = now();
  const duration = payment.period === "yearly" ? YEAR : MONTH;
  const token = crypto.randomUUID();
  const claimed = "EXISTS (SELECT 1 FROM payments WHERE id = ?1 AND apply_token = ?2)";
  // The top-up runs before the subscription is written, so both see the same subscription.
  // The top-up statement has no binding for the time, so it reads the paid_at the claim just wrote.
  const extending = (at: string) =>
    `subscriptions.plan_id = ?4 AND subscriptions.status = 'active' AND COALESCE(subscriptions.expires_at, 0) > ${at}`;

  const [claim] = await env.DB.batch([
    env.DB.prepare("UPDATE payments SET status = 'successful', paid_at = ?3, apply_token = ?2 WHERE id = ?1 AND status = 'pending' AND apply_token IS NULL")
      .bind(payment.id, token, t),
    topUpStatement(env, payment.user_id, payment.plan_id, `แพ็กเกจ ${payment.plan_id}`,
      `${claimed} AND NOT EXISTS (SELECT 1 FROM subscriptions WHERE subscriptions.user_id = ?3 AND ${extending("(SELECT paid_at FROM payments WHERE id = ?1)")})`,
      payment.id, token),
    env.DB.prepare(
      `INSERT INTO subscriptions (user_id, plan_id, status, billing_period, expires_at, next_credit_at, provider_ref, updated_at)
       SELECT ?3, ?4, 'active', ?5, ?6 + ?7, ?6 + ${MONTH}, ?1, datetime('now') WHERE ${claimed}
       ON CONFLICT(user_id) DO UPDATE SET
         expires_at = CASE WHEN ${extending("?6")} THEN subscriptions.expires_at + ?7 ELSE ?6 + ?7 END,
         next_credit_at = CASE WHEN ${extending("?6")} AND subscriptions.next_credit_at IS NOT NULL THEN subscriptions.next_credit_at ELSE ?6 + ${MONTH} END,
         plan_id = excluded.plan_id, status = 'active', billing_period = excluded.billing_period,
         provider_ref = excluded.provider_ref, updated_at = excluded.updated_at`,
    ).bind(payment.id, token, payment.user_id, payment.plan_id, payment.period, t, duration),
  ]);
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

/** Bring a payment in line with Stripe's view of its Checkout Session. Only trusts a session fetched from Stripe. */
async function reconcile(env: Env, payment: PaymentRow, session: CheckoutSession): Promise<void> {
  const matches = session.id === payment.stripe_session_id && session.amount_total === payment.amount_satang &&
    String(session.currency).toUpperCase() === "THB" && session.client_reference_id === payment.id &&
    session.metadata?.payment_id === payment.id;
  if (!matches) {
    console.error("billing: session does not match payment", payment.id);
    return;
  }
  // PromptPay settles after the session completes: payment_status stays 'unpaid' until then.
  if (session.status === "complete" && session.payment_status === "paid") {
    // A receipt that fails here is issued by the cron backfill; it never undoes the payment.
    if (await applyPayment(env, payment.id)) await issueReceipt(env, payment.id).catch(() => console.error("billing: receipt deferred to cron"));
  }
  else if (session.status === "expired") {
    await env.DB.prepare("UPDATE payments SET status = 'expired' WHERE id = ? AND status = 'pending'").bind(payment.id).run();
  }
}

/** The async payment (PromptPay) was declined after the customer left the page. */
async function markFailed(env: Env, payment: PaymentRow, session: CheckoutSession): Promise<void> {
  if (session.id !== payment.stripe_session_id || session.payment_status === "paid") return;
  await env.DB.prepare("UPDATE payments SET status = 'failed', failure = 'async_payment_failed' WHERE id = ? AND status = 'pending'").bind(payment.id).run();
}

async function couponFor(env: Env, code: unknown, userId: string, planId: string, period: Period, list: number, t: number) {
  try { return await checkCoupon(env, code, userId, planId, period, list, t); }
  catch (error) { if (error instanceof CouponError) throw new BillingError(error.status, error.message); throw error; }
}

/** POST /api/billing/coupon: what a code takes off the chosen package, before going to pay. */
async function previewCoupon(request: Request, env: Env, userId: string): Promise<Response> {
  const body = await readBody(request);
  const plan = await paidPlan(env, body.planId);
  const period: Period = body.period === "yearly" ? "yearly" : "monthly";
  const list = priceSatang(plan, period);
  const coupon = await couponFor(env, body.code, userId, plan.id, period, list, now());
  return json({ code: coupon.code, label: coupon.label, price: list / 100, discount: coupon.discount / 100, amount: (list - coupon.discount) / 100 });
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
  if (!onlinePayment(env)) throw new BillingError(503, "ระบบชำระเงินออนไลน์ยังไม่เปิดใช้งาน กรุณาติดต่อทีมงาน");
  const body = await readBody(request);
  const plan = await paidPlan(env, body.planId);
  const period: Period = body.period === "yearly" ? "yearly" : body.period === "monthly" ? "monthly" : (() => { throw new BillingError(400, "กรุณาเลือกรายเดือนหรือรายปี"); })();
  let stripe;
  try { stripe = stripeClient(env); } catch { throw new BillingError(503, "ระบบชำระเงินออนไลน์ยังไม่เปิดใช้งาน กรุณาติดต่อทีมงาน"); }

  const t = now();
  const list = priceSatang(plan, period);
  // a discount code (src/billing/coupons.ts): checked here for a clear message, and again inside the insert
  const coupon = normalizeCode(body.coupon) ? await couponFor(env, body.coupon, userId, plan.id, period, list, t) : null;
  const amount = list - (coupon?.discount ?? 0);
  const id = crypto.randomUUID();
  const expiresAt = t + CHECKOUT_MINUTES * 60;
  // Counted in the insert itself, so concurrent requests cannot all pass the limit (nor take a code's last use).
  const inserted = await env.DB.prepare(`INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, expires_at, created_at, coupon_code, discount_satang)
    SELECT ?1, ?2, ?3, ?4, ?5, 'stripe_checkout', ?6, ?7, NULLIF(?9, ''), ?10
    WHERE (SELECT COUNT(*) FROM payments WHERE user_id = ?2 AND status = 'pending' AND created_at > ?7 - 3600) < ?8
      AND (?9 = '' OR ${couponStillValid('?9', '?7', '?2', '?3', '?4')})`)
    .bind(id, userId, plan.id, period, amount, expiresAt, t, MAX_OPEN_CHECKOUTS_PER_HOUR, coupon?.code ?? '', coupon?.discount ?? 0).run();
  if (inserted.meta.changes !== 1) {
    if (coupon) await couponFor(env, coupon.code, userId, plan.id, period, list, t); // says why, when the code is the reason
    throw new BillingError(429, "มีรายการที่รอชำระหลายรายการแล้ว กรุณาชำระรายการเดิมหรือรอสักครู่");
  }

  let session: CheckoutSession;
  try {
    session = await createCheckoutSession(stripe, {
      paymentId: id, userId, planName: coupon ? `${plan.name} (โค้ด ${coupon.code})` : plan.name, period, amountSatang: amount, expiresAt,
      origin: new URL(env.APP_ORIGIN).origin,
    });
  } catch (error) {
    // Only Stripe's error type and code: never the message, which can echo request details.
    const e = error as { type?: unknown; code?: unknown };
    console.error("billing: stripe checkout failed", String(e.type ?? "unknown"), String(e.code ?? ""));
    // Nobody can pay a session whose URL we never received, so failing the payment loses no money.
    await env.DB.prepare("UPDATE payments SET status = 'failed', failure = 'stripe_error' WHERE id = ?").bind(id).run();
    throw new BillingError(502, "เปิดหน้าชำระเงินไม่สำเร็จ กรุณาลองใหม่");
  }
  await env.DB.prepare("UPDATE payments SET stripe_session_id = ? WHERE id = ?").bind(session.id, id).run();
  if (typeof session.url !== "string" || !session.url.startsWith("https://")) throw new BillingError(502, "เปิดหน้าชำระเงินไม่สำเร็จ กรุณาลองใหม่");
  return json({ paymentId: id, ...(await paymentView(env, id, userId)), redirect: session.url }, 201);
}

async function paymentView(env: Env, id: string, userId: string) {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?").bind(id, userId).first<PaymentRow>();
  if (!payment) throw new BillingError(404, "ไม่พบรายการชำระเงิน");
  return {
    status: payment.status, planId: payment.plan_id, period: payment.period, amount: payment.amount_satang / 100,
    method: payment.method, expiresAt: payment.expires_at, coupon: payment.coupon_code, discount: payment.discount_satang / 100,
  };
}

async function refreshPayment(env: Env, id: string, userId: string): Promise<Response> {
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE id = ? AND user_id = ?").bind(id, userId).first<PaymentRow>();
  if (!payment) throw new BillingError(404, "ไม่พบรายการชำระเงิน");
  if (payment.status === "pending" && payment.stripe_session_id) {
    try { await reconcile(env, payment, await getCheckoutSession(stripeClient(env), payment.stripe_session_id)); }
    catch { /* Stripe unreachable: report the stored status; the webhook or the next poll catches up */ }
  }
  return json(await paymentView(env, id, userId));
}

async function billingState(env: Env, userId: string): Promise<Response> {
  const sub = await env.DB.prepare(`SELECT s.plan_id, s.status, s.expires_at, s.billing_period, s.next_credit_at, p.name
    FROM subscriptions s JOIN plans p ON p.id = s.plan_id WHERE s.user_id = ?`).bind(userId)
    .first<{ plan_id: string; status: string; expires_at: number | null; billing_period: string | null; next_credit_at: number | null; name: string }>();
  const plans = await onSale(env);
  const active = sub && sub.status === "active" && (sub.expires_at === null || sub.expires_at > now());
  return json({
    subscription: active ? { planId: sub.plan_id, name: sub.name, expiresAt: sub.expires_at, period: sub.billing_period, nextCreditAt: sub.next_credit_at } : null,
    credits: await getBalance(env.DB, userId),
    plans: plans.map(planView),
  });
}

const onSale = async (env: Env) => (await env.DB.prepare(
  "SELECT id, name, monthly_credits, max_parallel_jobs, price_thb FROM plans WHERE price_thb > 0 AND on_sale = 1 ORDER BY price_thb, id").all<PlanRow>()).results;
const planView = (p: PlanRow) => ({ id: p.id, name: p.name, monthlyCredits: p.monthly_credits, parallelJobs: p.max_parallel_jobs,
  monthly: priceSatang(p, "monthly") / 100, yearly: priceSatang(p, "yearly") / 100 });

/** Stripe is configured and the payments switch in /admin/system/ is on. */
function onlinePayment(env: Env): boolean {
  return env.FEATURE_PAYMENTS !== "off" && !!env.STRIPE_SECRET_KEY?.trim() && !!env.STRIPE_WEBHOOK_SECRET?.trim();
}

/** GET /api/plans — packages on sale, for the public pricing section. No session needed. */
export async function handlePublicPlans(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response(null, { status: 405, headers: { Allow: "GET, HEAD" } });
  return new Response(JSON.stringify({ plans: (await onSale(env)).map(planView) }), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}

/** /api/billing/* — userId comes from the session. */
export async function handleBilling(request: Request, env: Env, url: URL, userId: string): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/billing/")) return null;
  const path = url.pathname.slice("/api/billing".length);
  try {
    if (request.method === "POST" && request.headers.get("Origin") !== url.origin) throw new BillingError(403, "คำขอไม่ถูกต้อง");
    if (path === "/config" && request.method === "GET") return json({ enabled: onlinePayment(env) });
    if (path === "/me" && request.method === "GET") return await billingState(env, userId);
    if (path === "/checkout" && request.method === "POST") return await checkout(request, env, userId);
    if (path === "/coupon" && request.method === "POST") return await previewCoupon(request, env, userId);
    const match = path.match(/^\/payments\/([0-9a-f-]{36})$/);
    if (match && request.method === "GET") return await refreshPayment(env, match[1], userId);
    return json({ error: "not found" }, 404);
  } catch (error) {
    if (error instanceof BillingError) return json({ error: error.message }, error.status);
    console.error("billing error");
    return json({ error: "ระบบชำระเงินขัดข้อง กรุณาลองใหม่" }, 500);
  }
}

const SESSION_EVENTS = new Set([
  "checkout.session.completed", "checkout.session.async_payment_succeeded",
  "checkout.session.async_payment_failed", "checkout.session.expired",
]);

/** POST /webhook/stripe — signed by Stripe; the session is re-read from Stripe before anything changes. */
export async function handleStripeWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return new Response(null, { status: 405 });
  let stripe;
  try { stripe = stripeClient(env); } catch { return new Response(null, { status: 503 }); }
  if (!env.STRIPE_WEBHOOK_SECRET?.trim()) return new Response(null, { status: 503 });
  // Cut oversized payloads off before the rest can be buffered; the raw bytes still reach
  // the signature check intact.
  const rawBytes = await readBodyBytes(request, 256 * 1024);
  if (rawBytes === null) return new Response(null, { status: 413 });
  const event = await verifyWebhookEvent(stripe, env, new TextDecoder().decode(rawBytes), request.headers.get("Stripe-Signature"));
  if (!event) return new Response(null, { status: 400 });
  if (!SESSION_EVENTS.has(event.type)) return new Response(null, { status: 204 });
  const sessionId = (event.data.object as { id?: unknown }).id;
  if (typeof sessionId !== "string") return new Response(null, { status: 204 });
  const payment = await env.DB.prepare("SELECT * FROM payments WHERE stripe_session_id = ?").bind(sessionId).first<PaymentRow>();
  if (!payment) return new Response(null, { status: 204 });
  try {
    const session = await getCheckoutSession(stripe, sessionId);
    if (event.type === "checkout.session.async_payment_failed") await markFailed(env, payment, session);
    else await reconcile(env, payment, session);
  } catch {
    return new Response(null, { status: 503 }); // Stripe retries; the next poll also catches up
  }
  return new Response(null, { status: 204 });
}

/** Cron: end expired packages, give monthly credits to active ones, and close stale checkouts. */
export async function runBillingCron(env: Env, { maxTopUps = 50 } = {}): Promise<{ expired: number; toppedUp: number }> {
  const t = now();
  const [expired] = await env.DB.batch([
    env.DB.prepare("UPDATE subscriptions SET status = 'expired', updated_at = datetime('now') WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= ?").bind(t),
    // A completed session can still settle (PromptPay) after its page expires, and the webhook
    // applies it while the payment is pending. Give it a day before closing it.
    env.DB.prepare("UPDATE payments SET status = 'expired' WHERE status = 'pending' AND expires_at <= ?").bind(t - 86400),
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
