const assert = require("node:assert/strict");
const { after, beforeEach, mock, test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { readFileSync, rmSync } = require("node:fs");
const path = require("node:path");
const { migratedDb } = require("./helpers/d1.cjs");

// Compile src with the project's compiler; Stripe is mocked at fetch, no money moves.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `billing-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16", "--esModuleInterop",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const billing = require(path.join(buildDir, "billing", "index.js"));
const credits = require(path.join(buildDir, "credits.js"));

const http = mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected live HTTP"); });
after(() => {
  mock.restoreAll();
  assert.equal(path.dirname(buildDir), path.join(root, ".wrangler"));
  rmSync(buildDir, { recursive: true, force: true });
});

const MIGRATIONS = ["0001_auth.sql", "0002_credits_jobs.sql", "0004_plans.sql", "0007_payments.sql", "0008_receipts.sql", "0010_stripe.sql", "0014_system_settings.sql"];
const WEBHOOK_SECRET = "whsec_test_signing_secret";
let sqlite, db, env, sessions, created;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...MIGRATIONS));
  env = { DB: db, APP_ORIGIN: "https://naka.test", STRIPE_SECRET_KEY: "rk_test_123", STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET };
  sessions = new Map();
  created = [];
  http.mock.resetCalls();
  // A tiny Stripe: create and retrieve Checkout Sessions.
  http.mock.mockImplementation(async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://api.stripe.com");
    assert.equal(new Headers(init.headers).get("Authorization"), "Bearer rk_test_123");
    if (u.pathname === "/v1/checkout/sessions" && init.method === "POST") {
      const form = new URLSearchParams(String(init.body));
      created.push(form);
      const id = `cs_test_${sessions.size + 1}`;
      const session = {
        object: "checkout.session", id, url: `https://checkout.stripe.com/c/pay/${id}`, status: "open", payment_status: "unpaid",
        amount_total: Number(form.get("line_items[0][price_data][unit_amount]")), currency: form.get("line_items[0][price_data][currency]"),
        client_reference_id: form.get("client_reference_id"),
        metadata: { payment_id: form.get("metadata[payment_id]"), user_id: form.get("metadata[user_id]") },
      };
      sessions.set(id, session);
      return Response.json(session);
    }
    const found = u.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\d+)$/);
    if (found && sessions.has(found[1]) && init.method === "GET") return Response.json(sessions.get(found[1]));
    throw new Error(`unexpected ${init.method} ${u.pathname}`);
  });
});

const call = (route, { method = "GET", body, user = "u1", origin = "https://naka.test" } = {}) => {
  const url = new URL(`https://naka.test/api/billing${route}`);
  return billing.handleBilling(new Request(url, { method, headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) }), env, url, user);
};
function signedWebhook(event, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  return new Request("https://naka.test/webhook/stripe", { method: "POST", body: raw,
    headers: { "Stripe-Signature": `t=${timestamp},v1=${signature}` } });
}
const sessionEvent = (type, id) => ({ id: "evt_test", object: "event", type, data: { object: { object: "checkout.session", id } } });
const webhook = (type, id) => billing.handleStripeWebhook(signedWebhook(sessionEvent(type, id)), env);
const sub = (user = "u1") => sqlite.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(user);
const pay = (session, status = "paid") => Object.assign(session, { status: "complete", payment_status: status });
async function checkout(planId, period = "monthly", user = "u1") {
  const response = await call("/checkout", { method: "POST", user, body: { planId, period } });
  assert.equal(response.status, 201);
  const body = await response.json();
  return { body, session: sessions.get(`cs_test_${sessions.size}`) };
}

test("prices come from the plans table; yearly charges ten months", () => {
  assert.equal(billing.priceSatang({ price_thb: 399 }, "monthly"), 39900);
  assert.equal(billing.priceSatang({ price_thb: 1990 }, "yearly"), 1990000);
});

test("checkout opens a Stripe hosted page at the server-side price with the Checkout Studio settings", async () => {
  const response = await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", amount: 1 } });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.amount, 790, "the client's amount is ignored");
  assert.equal(body.status, "pending");
  assert.equal(body.redirect, "https://checkout.stripe.com/c/pay/cs_test_1");
  const [form] = created;
  assert.equal(form.get("line_items[0][price_data][unit_amount]"), "79000");
  assert.equal(form.get("line_items[0][price_data][currency]"), "thb");
  assert.equal(form.get("mode"), "payment");
  assert.equal(form.get("ui_mode"), "hosted_page");
  assert.equal(form.get("billing_address_collection"), "auto");
  assert.equal(form.get("phone_number_collection[enabled]"), "false");
  assert.equal(form.get("automatic_tax[enabled]"), "false");
  assert.equal(form.get("allow_promotion_codes"), "false");
  assert.equal(form.get("submit_type"), "auto");
  assert.equal(form.get("integration_identifier"), "hosted_web_0001");
  assert.equal(form.get("origin_context"), "web");
  assert.equal(form.get("client_reference_id"), body.paymentId);
  assert.equal(form.get("success_url"), `https://naka.test/app/billing/?payment=${body.paymentId}`);
  assert.ok(![...form.keys()].some((key) => key.startsWith("payment_method_types")), "dynamic payment methods");
  assert.ok(![...form.keys()].some((key) => key.startsWith("payment_method_collection")), "subscription-only");
  const row = sqlite.prepare("SELECT method, stripe_session_id FROM payments WHERE id = ?").get(body.paymentId);
  assert.deepEqual({ ...row }, { method: "stripe_checkout", stripe_session_id: "cs_test_1" });
});

test("a signed checkout.session.completed switches the package on and tops up credits exactly once", async () => {
  const { body, session } = await checkout("business");
  pay(session);
  assert.equal((await billing.handleStripeWebhook(signedWebhook(sessionEvent("checkout.session.completed", session.id), "whsec_wrong"), env)).status, 400);
  assert.equal(sub(), undefined);
  assert.equal((await webhook("checkout.session.completed", session.id)).status, 204);
  assert.equal((await webhook("checkout.session.completed", session.id)).status, 204, "Stripe may deliver twice");

  const s = sub();
  assert.equal(s.plan_id, "business");
  assert.equal(s.status, "active");
  assert.ok(s.expires_at > Date.now() / 1000 + 29 * 86400);
  assert.equal(await credits.getBalance(db, "u1"), 160);
  assert.equal((await credits.getPlan(db, "u1")).max_parallel_jobs, 4);
  assert.equal((await (await call(`/payments/${body.paymentId}`)).json()).status, "successful");
});

test("PromptPay: completed but unpaid waits; async success applies it, async failure fails it", async () => {
  const { session } = await checkout("pro");
  pay(session, "unpaid");
  await webhook("checkout.session.completed", session.id);
  assert.equal(sub(), undefined, "not paid yet");
  pay(session);
  await webhook("checkout.session.async_payment_succeeded", session.id);
  assert.equal(sub().plan_id, "pro");

  const second = await checkout("starter", "monthly", "u2");
  pay(second.session, "unpaid");
  await webhook("checkout.session.async_payment_failed", second.session.id);
  assert.equal(sqlite.prepare("SELECT status FROM payments WHERE user_id = 'u2'").get().status, "failed");
  assert.equal(sub("u2"), undefined);
});

test("a stale signature or a session that does not match the payment never switches anything on", async () => {
  const { session } = await checkout("max", "yearly");
  pay(session);
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await billing.handleStripeWebhook(signedWebhook(sessionEvent("checkout.session.completed", session.id), WEBHOOK_SECRET, old), env)).status, 400);
  session.amount_total = 100;
  await webhook("checkout.session.completed", session.id);
  assert.equal(sub(), undefined);
  assert.equal(await credits.getBalance(db, "u1"), 0);
});

test("the return page poll applies a paid session before the webhook; an expired session expires", async () => {
  const { body, session } = await checkout("starter");
  pay(session);
  assert.equal((await (await call(`/payments/${body.paymentId}`)).json()).status, "successful");
  assert.equal(await credits.getBalance(db, "u1"), 30);
  assert.equal((await call(`/payments/${body.paymentId}`, { user: "u2" })).status, 404, "another user's payment");

  const other = await checkout("pro", "monthly", "u3");
  other.session.status = "expired";
  await webhook("checkout.session.expired", other.session.id);
  assert.equal(sqlite.prepare("SELECT status FROM payments WHERE user_id = 'u3'").get().status, "expired");
});

test("a successful payment issues its receipt", async () => {
  env = { ...env, RECEIPT_SELLER_NAME: "ร้านนาคา" };
  sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้านทดสอบ', 0)").run();
  const { session } = await checkout("pro", "yearly");
  pay(session);
  await webhook("checkout.session.completed", session.id);
  const receipts = sqlite.prepare("SELECT number, snapshot FROM receipts").all();
  assert.equal(receipts.length, 1);
  assert.match(receipts[0].number, /^RC\d{4}-000001$/);
  assert.equal(JSON.parse(receipts[0].snapshot).amountSatang, 790000);
});

test("renewing the same package extends it; the cron tops up monthly and ends expired packages", async () => {
  const first = await checkout("pro");
  pay(first.session);
  await call(`/payments/${first.body.paymentId}`);
  const firstEnd = sub().expires_at;
  await credits.grantCredits(db, "u1", 5, "grant"); // balance 85 > 80: a top-up never takes credits away
  const renewal = await checkout("pro");
  pay(renewal.session);
  await call(`/payments/${renewal.body.paymentId}`);
  assert.equal(sub().expires_at, firstEnd + 30 * 86400);
  assert.equal(await credits.getBalance(db, "u1"), 85, "extending does not top up again");

  sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason) VALUES ('u1', -70, 'grant')").run();
  sqlite.prepare("UPDATE subscriptions SET next_credit_at = ? WHERE user_id = 'u1'").run(Math.floor(Date.now() / 1000) - 1);
  assert.deepEqual(await billing.runBillingCron(env), { expired: 0, toppedUp: 1 });
  assert.equal(await credits.getBalance(db, "u1"), 80);
  assert.deepEqual(await billing.runBillingCron(env), { expired: 0, toppedUp: 0 }, "once per month");

  sqlite.prepare("UPDATE subscriptions SET expires_at = ? WHERE user_id = 'u1'").run(Math.floor(Date.now() / 1000) - 1);
  assert.equal((await billing.runBillingCron(env)).expired, 1);
  assert.equal((await credits.getPlan(db, "u1")).id, "free");
});

test("two payments for the same package applied at the same time add up to two periods", async () => {
  const first = await checkout("pro");
  const second = await checkout("pro");
  // Both read the subscription before either writes it, as concurrent webhooks or polls can.
  assert.deepEqual(await Promise.all([billing.applyPayment(env, first.body.paymentId), billing.applyPayment(env, second.body.paymentId)]), [true, true]);
  const t = Math.floor(Date.now() / 1000);
  assert.ok(sub().expires_at >= t + 59 * 86400, "the second payment extends the first");
  assert.equal(await credits.getBalance(db, "u1"), 80, "only the first payment tops up");
});

test("concurrent checkouts cannot pass the open-checkout limit together", async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly" } })));
  assert.deepEqual(responses.map((r) => r.status).toSorted(), [201, 201, 201, 201, 201, 429, 429, 429]);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM payments").get().n, 5);
  assert.equal(created.length, 5, "a refused checkout never reaches Stripe");
});

test("a Stripe error fails the checkout; unconfigured, cross-site and too many open checkouts are refused", async () => {
  http.mock.mockImplementation(async () => { throw new TypeError("network down"); });
  assert.equal((await call("/checkout", { method: "POST", user: "u9", body: { planId: "pro", period: "monthly" } })).status, 502);
  assert.equal(sqlite.prepare("SELECT status FROM payments WHERE user_id = 'u9'").get().status, "failed");
  http.mock.mockImplementation(async (url) => Response.json({ object: "checkout.session", id: `cs_test_${Math.random().toString(36).slice(2)}`, url: "https://checkout.stripe.com/c/pay/x" }));

  assert.equal((await call("/checkout", { method: "POST", origin: "https://evil.example", body: { planId: "pro", period: "monthly" } })).status, 403);
  for (let i = 0; i < 5; i++) await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly" } });
  assert.equal((await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly" } })).status, 429);
  assert.equal((await call("/checkout", { method: "POST", user: "u3", body: { planId: "free", period: "monthly" } })).status, 400);

  assert.deepEqual(await (await call("/config")).json(), { enabled: true });
  delete env.STRIPE_SECRET_KEY;
  assert.equal((await call("/checkout", { method: "POST", user: "u3", body: { planId: "pro", period: "monthly" } })).status, 503);
  assert.equal((await webhook("checkout.session.completed", "cs_test_1")).status, 503);
  assert.deepEqual(await (await call("/config")).json(), { enabled: false });
});

test("migration 0010 keeps existing payments and their receipts", () => {
  const { sqlite: old } = migratedDb("0001_auth.sql", "0002_credits_jobs.sql", "0004_plans.sql", "0007_payments.sql", "0008_receipts.sql");
  old.exec("PRAGMA foreign_keys = ON");
  old.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้าน', 0)").run();
  old.prepare("INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, omise_charge_id, created_at, paid_at) VALUES ('p1','u1','pro','monthly',79000,'card','successful','chrg_1',1,2)").run();
  const cols = old.prepare("PRAGMA table_info(receipts)").all().filter((c) => c.notnull && c.dflt_value === null).map((c) => c.name);
  const sample = { id: "r1", payment_id: "p1", user_id: "u1", year: 2026, seq: 1, number: "RC2026-000001", issued_at: 2, snapshot: "{}" };
  old.prepare(`INSERT INTO receipts (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => sample[c] ?? 0));
  // D1 applies a migration file as one transaction, which is what lets the deferred foreign keys pass.
  old.exec(`BEGIN; ${readFileSync(path.join(root, "migrations", "0010_stripe.sql"), "utf8")} COMMIT;`);
  assert.deepEqual({ ...old.prepare("SELECT id, method, omise_charge_id, stripe_session_id FROM payments").get() },
    { id: "p1", method: "card", omise_charge_id: "chrg_1", stripe_session_id: null });
  assert.equal(old.prepare("PRAGMA foreign_key_check").all().length, 0);
  assert.equal(old.prepare("SELECT payment_id FROM receipts").get().payment_id, "p1");
  old.close();
});
