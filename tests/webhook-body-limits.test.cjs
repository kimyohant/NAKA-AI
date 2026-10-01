const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { createHmac } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const { migratedDb } = require("./helpers/d1.cjs");
const path = require("node:path");

// Webhook bodies are read through the byte-counting reader (docs/security-audit-2026-10.md,
// finding 4): payloads over the limit are refused 413 before the remaining bytes can be
// buffered, and normal payloads still reach the signature check with their raw bytes intact.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `webhook-limits-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const billing = require(path.join(buildDir, "billing", "index.js"));
const worker = require(path.join(buildDir, "index.js")).default;

const MIGRATIONS = ["0001_auth.sql", "0002_credits_jobs.sql", "0004_plans.sql", "0007_payments.sql", "0008_receipts.sql", "0010_stripe.sql"];
const STRIPE_SECRET = "whsec_test_signing_secret";
const LINE_SECRET = "line_test_channel_secret";

after(() => {
  rmSync(buildDir, { recursive: true, force: true });
});

let sqlite, db;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...MIGRATIONS));
});

const stripeEnv = () => ({ DB: db, STRIPE_SECRET_KEY: "rk_test_restricted", STRIPE_WEBHOOK_SECRET: STRIPE_SECRET });
const lineEnv = () => ({ DB: db, LINE_CHANNEL_SECRET: LINE_SECRET });
const ctx = { waitUntil() {} };

function signedStripe(payload, secret = STRIPE_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  return { "Stripe-Signature": `t=${timestamp},v1=${signature}` };
}
const lineSignature = (body) => createHmac("sha256", LINE_SECRET).update(body).digest("base64");

/** A chunked body that remembers how much of it a handler consumed. */
function trackedChunks({ chunkCount = 8, chunkSize = 64 * 1024, fill = 0x78 } = {}) {
  let pulled = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull(controller) {
      if (pulled < chunkCount) {
        pulled++;
        controller.enqueue(new Uint8Array(chunkSize).fill(fill));
      } else controller.close();
    },
    cancel() { cancelled = true; },
  });
  return { stream, consumed: () => ({ pulled, cancelled }) };
}

const stripeEvent = JSON.stringify({
  id: "evt_test", object: "event", type: "checkout.session.completed",
  data: { object: { object: "checkout.session", id: "cs_test_unknown" } },
});

test("stripe webhook refuses an oversized Content-Length with 413", async () => {
  const body = "x".repeat(300 * 1024);
  const response = await billing.handleStripeWebhook(new Request("https://naka.test/webhook/stripe", {
    method: "POST", body, headers: signedStripe(body),
  }), stripeEnv());
  assert.equal(response.status, 413);
});

test("stripe webhook cuts off a chunked body over 256 KiB mid-stream, signature still works under the limit", async () => {
  const { stream, consumed } = trackedChunks();
  const response = await billing.handleStripeWebhook(new Request("https://naka.test/webhook/stripe", {
    method: "POST", duplex: "half", body: stream, headers: signedStripe(""),
  }), stripeEnv());
  assert.equal(response.status, 413);
  const { pulled, cancelled } = consumed();
  assert.ok(pulled < 8, `handler consumed ${pulled}/8 chunks — it must stop at the limit`);
  assert.equal(cancelled, true, "the stream must be cancelled, not drained");

  const event = await billing.handleStripeWebhook(new Request("https://naka.test/webhook/stripe", {
    method: "POST", body: stripeEvent, headers: signedStripe(stripeEvent),
  }), stripeEnv());
  assert.equal(event.status, 204, "a valid signature still verifies through the byte reader");

  const bad = await billing.handleStripeWebhook(new Request("https://naka.test/webhook/stripe", {
    method: "POST", body: stripeEvent, headers: signedStripe(stripeEvent, "whsec_wrong"),
  }), stripeEnv());
  assert.equal(bad.status, 400);
});

test("line webhook refuses oversized bodies unread and keeps verifying valid signatures", async () => {
  const response = await worker.fetch(new Request("https://naka-ai.com/webhook/line", {
    method: "POST", duplex: "half", body: trackedChunks().stream,
  }), lineEnv(), ctx);
  assert.equal(response.status, 413);

  const invalid = await worker.fetch(new Request("https://naka-ai.com/webhook/line", {
    method: "POST", body: '{"events":[]}', headers: { "x-line-signature": "bad" },
  }), lineEnv(), ctx);
  assert.equal(invalid.status, 401);

  const body = '{"events":[]}';
  const ok = await worker.fetch(new Request("https://naka-ai.com/webhook/line", {
    method: "POST", body, headers: { "x-line-signature": lineSignature(body) },
  }), lineEnv(), ctx);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "ok");

  const oversize = "y".repeat(300 * 1024);
  const refused = await worker.fetch(new Request("https://naka-ai.com/webhook/line", {
    method: "POST", body: oversize, headers: { "x-line-signature": lineSignature(oversize) },
  }), lineEnv(), ctx);
  assert.equal(refused.status, 413, "even a correctly signed oversized payload is refused");
});
