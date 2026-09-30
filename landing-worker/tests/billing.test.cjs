const assert = require("node:assert/strict");
const { after, beforeEach, mock, test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { rmSync } = require("node:fs");
const path = require("node:path");
const { migratedDb } = require("./helpers/d1.cjs");

// Compile src with the project's compiler; Omise is mocked, no money moves.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `billing-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
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

const WEBHOOK_SECRET = Buffer.from("webhook-signing-secret-for-tests").toString("base64");
let sqlite, db, env, charges;
beforeEach(() => {
  ({ sqlite, db } = migratedDb("0002_credits_jobs.sql", "0004_plans.sql", "0007_payments.sql"));
  env = { DB: db, APP_ORIGIN: "https://naka.test", OMISE_SECRET_KEY: "skey_test_123", OMISE_PUBLIC_KEY: "pkey_test_123", OMISE_WEBHOOK_SECRET: WEBHOOK_SECRET };
  charges = new Map();
  http.mock.resetCalls();
  // A tiny Omise: sources, charges, and GET /charges/:id reading the stored charge.
  http.mock.mockImplementation(async (url, init) => {
    const u = new URL(String(url));
    assert.equal(u.origin, "https://api.omise.co");
    assert.equal(init.headers.Authorization, `Basic ${Buffer.from("skey_test_123:").toString("base64")}`);
    const form = init.body ? new URLSearchParams(String(init.body)) : null;
    if (u.pathname === "/sources") return Response.json({ object: "source", id: "src_test_1", type: form.get("type") });
    if (u.pathname === "/charges" && init.method === "POST") {
      const id = `chrg_test_${charges.size + 1}`;
      const card = form.get("card");
      const charge = {
        object: "charge", id, amount: Number(form.get("amount")), currency: "THB",
        status: card === "tokn_3ds" ? "pending" : card ? "successful" : "pending", paid: !!card && card !== "tokn_3ds",
        metadata: { payment_id: form.get("metadata[payment_id]"), user_id: form.get("metadata[user_id]") },
        authorize_uri: card === "tokn_3ds" ? "https://pay.omise.co/3ds/abc" : null,
        source: card ? null : { scannable_code: { image: { download_uri: `https://api.omise.co/charges/${id}/documents/qr.png` } } },
      };
      charges.set(id, charge);
      // Omise created and charged the card, but its reply never reached us.
      if (card === "tokn_timeout") { charge.status = "successful"; charge.paid = true; throw new TypeError("network timeout"); }
      if (card === "tokn_declined") return Response.json({ object: "error", code: "failed_processing" }, { status: 400 });
      return Response.json(charge);
    }
    const found = u.pathname.match(/^\/charges\/(chrg_test_\d+)$/);
    if (found && charges.has(found[1])) return Response.json(charges.get(found[1]));
    throw new Error(`unexpected ${u.pathname}`);
  });
});

const call = (route, { method = "GET", body, user = "u1", origin = "https://naka.test" } = {}) => {
  const url = new URL(`https://naka.test/api/billing${route}`);
  return billing.handleBilling(new Request(url, { method, headers: { Origin: origin, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}) }), env, url, user);
};
function signedWebhook(event, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const raw = JSON.stringify(event);
  const signature = createHmac("sha256", Buffer.from(secret, "base64")).update(`${timestamp}.${raw}`).digest("hex");
  return new Request("https://naka.test/webhook/omise", { method: "POST", body: raw,
    headers: { "Omise-Signature": signature, "Omise-Signature-Timestamp": String(timestamp) } });
}
const completeEvent = (id) => ({ object: "event", key: "charge.complete", data: { object: "charge", id } });
const sub = (user = "u1") => sqlite.prepare("SELECT * FROM subscriptions WHERE user_id = ?").get(user);

test("prices come from the plans table; yearly charges ten months", () => {
  assert.equal(billing.priceSatang({ price_thb: 399 }, "monthly"), 39900);
  assert.equal(billing.priceSatang({ price_thb: 1990 }, "yearly"), 1990000);
});

test("PromptPay checkout charges the server-side price and returns the QR", async () => {
  const response = await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", method: "promptpay", amount: 1 } });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.amount, 790, "the client's amount is ignored");
  assert.equal(body.status, "pending");
  assert.match(body.qrImageUrl, /qr\.png$/);
  const [charge] = charges.values();
  assert.equal(charge.amount, 79000);
  assert.equal(charge.metadata.payment_id, body.paymentId);
  assert.equal(sub(), undefined, "nothing switches on before payment");
});

test("a signed charge.complete switches the package on and tops up credits exactly once", async () => {
  const { paymentId } = await (await call("/checkout", { method: "POST", body: { planId: "business", period: "monthly", method: "promptpay" } })).json();
  const [charge] = charges.values();

  assert.equal((await billing.handleOmiseWebhook(signedWebhook(completeEvent(charge.id), Buffer.from("wrong").toString("base64")), env)).status, 401);
  charge.status = "successful"; charge.paid = true;
  assert.equal((await billing.handleOmiseWebhook(signedWebhook(completeEvent(charge.id)), env)).status, 204);
  assert.equal((await billing.handleOmiseWebhook(signedWebhook(completeEvent(charge.id)), env)).status, 204, "Omise may deliver twice");

  const s = sub();
  assert.equal(s.plan_id, "business");
  assert.equal(s.status, "active");
  assert.ok(s.expires_at > Date.now() / 1000 + 29 * 86400);
  assert.equal(await credits.getBalance(db, "u1"), 160);
  assert.equal((await credits.getPlan(db, "u1")).max_parallel_jobs, 4);
  assert.equal((await (await call(`/payments/${paymentId}`)).json()).status, "successful");
});

test("a stale or replayed webhook signature is rejected", async () => {
  const old = Math.floor(Date.now() / 1000) - 3600;
  assert.equal((await billing.handleOmiseWebhook(signedWebhook(completeEvent("chrg_test_1"), WEBHOOK_SECRET, old), env)).status, 401);
});

test("a charge that does not match the payment never switches anything on", async () => {
  await call("/checkout", { method: "POST", body: { planId: "max", period: "yearly", method: "promptpay" } });
  const [charge] = charges.values();
  Object.assign(charge, { status: "successful", paid: true, amount: 100 });
  await billing.handleOmiseWebhook(signedWebhook(completeEvent(charge.id)), env);
  assert.equal(sub(), undefined);
  assert.equal(await credits.getBalance(db, "u1"), 0);
});

test("card payments apply at once, or hand back the 3-D Secure page", async () => {
  const paid = await (await call("/checkout", { method: "POST", body: { planId: "starter", period: "monthly", method: "card", token: "tokn_ok" } })).json();
  assert.equal(paid.status, "successful");
  assert.equal(sub().plan_id, "starter");
  assert.equal(await credits.getBalance(db, "u1"), 30);

  const secure = await (await call("/checkout", { method: "POST", user: "u2", body: { planId: "pro", period: "monthly", method: "card", token: "tokn_3ds" } })).json();
  assert.equal(secure.status, "pending");
  assert.equal(secure.redirect, "https://pay.omise.co/3ds/abc");
  assert.equal((await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", method: "card", token: "not-a-token" } })).status, 400);
});

test("a card charge whose reply is lost stays pending and the webhook still applies it", async () => {
  const lost = await call("/checkout", { method: "POST", body: { planId: "starter", period: "monthly", method: "card", token: "tokn_timeout" } });
  assert.equal(lost.status, 502);
  const payment = sqlite.prepare("SELECT * FROM payments WHERE user_id = 'u1'").get();
  assert.equal(payment.status, "pending", "an unknown outcome must not be marked failed");
  assert.equal(payment.omise_charge_id, null);
  assert.equal(sub(), undefined);

  const [charge] = charges.values();
  assert.equal((await billing.handleOmiseWebhook(signedWebhook(completeEvent(charge.id)), env)).status, 204);
  assert.equal(sub().plan_id, "starter");
  assert.equal(await credits.getBalance(db, "u1"), 30);
  const linked = sqlite.prepare("SELECT status, omise_charge_id FROM payments WHERE id = ?").get(payment.id);
  assert.deepEqual({ ...linked }, { status: "successful", omise_charge_id: charge.id });

  // A clear decline is still a failure, and an unknown charge id changes nothing.
  assert.equal((await call("/checkout", { method: "POST", user: "u2", body: { planId: "pro", period: "monthly", method: "card", token: "tokn_declined" } })).status, 502);
  assert.equal(sqlite.prepare("SELECT status FROM payments WHERE user_id = 'u2'").get().status, "failed");
});

test("a successful payment issues its receipt; a receipt failure never undoes the payment", async () => {
  // Without the receipts table the receipt fails, and the package still switches on (the cron retries).
  const paid = await (await call("/checkout", { method: "POST", body: { planId: "starter", period: "monthly", method: "card", token: "tokn_ok" } })).json();
  assert.equal(paid.status, "successful");
  assert.equal(sub().plan_id, "starter");

  ({ sqlite, db } = migratedDb("0001_auth.sql", "0002_credits_jobs.sql", "0004_plans.sql", "0007_payments.sql", "0008_receipts.sql"));
  env = { ...env, DB: db, RECEIPT_SELLER_NAME: "ร้านนาคา" };
  sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้านทดสอบ', 0)").run();
  await call("/checkout", { method: "POST", body: { planId: "pro", period: "yearly", method: "card", token: "tokn_ok" } });
  const receipts = sqlite.prepare("SELECT number, snapshot FROM receipts").all();
  assert.equal(receipts.length, 1);
  assert.match(receipts[0].number, /^RC\d{4}-000001$/);
  assert.equal(JSON.parse(receipts[0].snapshot).amountSatang, 790000);
});

test("renewing the same package extends it; the cron tops up monthly and ends expired packages", async () => {
  await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", method: "card", token: "tokn_a" } });
  const firstEnd = sub().expires_at;
  await credits.grantCredits(db, "u1", 5, "grant"); // balance 85 > 80: a top-up never takes credits away
  await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", method: "card", token: "tokn_b" } });
  assert.equal(sub().expires_at, firstEnd + 30 * 86400);
  assert.equal(await credits.getBalance(db, "u1"), 85, "extending does not top up again");

  // A month later: spend down, then the cron tops the balance back up to 80.
  sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason) VALUES ('u1', -70, 'grant')").run();
  sqlite.prepare("UPDATE subscriptions SET next_credit_at = ? WHERE user_id = 'u1'").run(Math.floor(Date.now() / 1000) - 1);
  assert.deepEqual(await billing.runBillingCron(env), { expired: 0, toppedUp: 1 });
  assert.equal(await credits.getBalance(db, "u1"), 80);
  assert.deepEqual(await billing.runBillingCron(env), { expired: 0, toppedUp: 0 }, "once per month");

  sqlite.prepare("UPDATE subscriptions SET expires_at = ? WHERE user_id = 'u1'").run(Math.floor(Date.now() / 1000) - 1);
  assert.equal((await billing.runBillingCron(env)).expired, 1);
  assert.equal((await credits.getPlan(db, "u1")).id, "free");
});

test("unconfigured payments, cross-site posts and too many open checkouts are refused", async () => {
  assert.equal((await call("/checkout", { method: "POST", origin: "https://evil.example", body: { planId: "pro", period: "monthly", method: "promptpay" } })).status, 403);
  for (let i = 0; i < 5; i++) await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", method: "promptpay" } });
  assert.equal((await call("/checkout", { method: "POST", body: { planId: "pro", period: "monthly", method: "promptpay" } })).status, 429);

  delete env.OMISE_SECRET_KEY;
  assert.equal((await call("/checkout", { method: "POST", user: "u3", body: { planId: "pro", period: "monthly", method: "promptpay" } })).status, 503);
  assert.equal((await billing.handleOmiseWebhook(signedWebhook(completeEvent("chrg_test_1")), env)).status, 503);
  assert.equal((await call("/checkout", { method: "POST", user: "u3", body: { planId: "free", period: "monthly", method: "promptpay" } })).status, 400);
});
