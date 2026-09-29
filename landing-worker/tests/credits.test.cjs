const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const { migratedDb } = require("./helpers/d1.cjs");
const path = require("node:path");

// Compile src with the project's compiler, then run the real SQL against SQLite.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `credits-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const credits = require(path.join(buildDir, "credits.js"));
const jobs = require(path.join(buildDir, "jobs.js"));
const worker = require(path.join(buildDir, "index.js")).default;

after(() => {
  assert.equal(path.dirname(buildDir), path.join(root, ".wrangler"));
  rmSync(buildDir, { recursive: true, force: true });
});

let sqlite;
let db;
beforeEach(() => {
  ({ sqlite, db } = migratedDb("0002_credits_jobs.sql"));
});

const row = (sql, ...params) => sqlite.prepare(sql).get(...params);
const makeRunnableNow = (id) => sqlite.prepare("UPDATE jobs SET run_after = datetime('now', '-1 seconds') WHERE id = ?").run(id);

test("balance is the sum of the ledger and grants reject non-positive amounts", async () => {
  assert.equal(await credits.getBalance(db, "u1"), 0);
  assert.equal(await credits.grantCredits(db, "u1", 50, "grant", "welcome"), 50);
  assert.equal(await credits.grantCredits(db, "u1", 25, "purchase"), 75);
  await assert.rejects(credits.grantCredits(db, "u1", 0, "grant"), RangeError);
  await assert.rejects(credits.grantCredits(db, "u1", 2.5, "grant"), RangeError);
  assert.equal((await credits.getPlan(db, "u1")).id, "free");
});

test("enqueue holds credits and refuses when the balance is short", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  assert.deepEqual(await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 11 }), { ok: false, reason: "insufficient_credits" });
  assert.equal(row("SELECT COUNT(*) AS n FROM jobs").n, 0);

  const ok = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: { p: 1 }, costCredits: 10 });
  assert.equal(ok.ok, true);
  assert.equal(await credits.getBalance(db, "u1"), 0);
  assert.equal(row("SELECT status FROM jobs WHERE id = ?", ok.jobId).status, "queued");
});

test("the plan's parallel-job limit counts queued and running jobs", async () => {
  await credits.grantCredits(db, "u1", 100, "grant");
  const first = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 5 });
  assert.equal(first.ok, true);
  assert.deepEqual(await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 5 }), { ok: false, reason: "too_many_jobs" });
  assert.equal(await credits.getBalance(db, "u1"), 95, "a refused job holds nothing");

  sqlite.exec("INSERT INTO plans (id, name, max_parallel_jobs) VALUES ('pro', 'Pro', 3)");
  sqlite.exec("INSERT INTO subscriptions (user_id, plan_id) VALUES ('u1', 'pro')");
  assert.equal((await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 5 })).ok, true);
});

test("the queue runs higher priority first, then oldest first", async () => {
  sqlite.exec("INSERT INTO plans (id, name, max_parallel_jobs) VALUES ('pro', 'Pro', 10)");
  for (const u of ["a", "b", "c"]) {
    sqlite.prepare("INSERT INTO subscriptions (user_id, plan_id) VALUES (?, 'pro')").run(u);
    await credits.grantCredits(db, u, 10, "grant");
  }
  const a = await jobs.enqueueJob(db, { userId: "a", kind: "k", input: {}, costCredits: 1 });
  const b = await jobs.enqueueJob(db, { userId: "b", kind: "k", input: {}, costCredits: 1 });
  const c = await jobs.enqueueJob(db, { userId: "c", kind: "k", input: {}, costCredits: 1, priority: 5 });
  sqlite.prepare("UPDATE jobs SET created_at = datetime('now', '-10 seconds') WHERE id = ?").run(a.jobId);

  assert.equal((await jobs.getJobForUser(db, b.jobId, "b")).ahead, 2);
  assert.equal(await jobs.getJobForUser(db, b.jobId, "a"), null, "another user's job is hidden");
  const order = [];
  for (let i = 0; i < 3; i++) order.push((await jobs.claimNextJob(db)).id);
  assert.deepEqual(order, [c.jobId, a.jobId, b.jobId]);
  assert.equal(await jobs.claimNextJob(db), null);
});

test("a retryable failure goes back to the queue with backoff and keeps the hold", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 4 });
  await jobs.claimNextJob(db);
  assert.equal(await jobs.failJob(db, jobId, "provider 503"), "queued");
  assert.equal(await jobs.claimNextJob(db), null, "backoff delays the retry");
  assert.equal(row("SELECT run_after > datetime('now') AS later FROM jobs WHERE id = ?", jobId).later, 1);
  assert.equal(await credits.getBalance(db, "u1"), 6);
});

test("a job that runs out of attempts fails and is refunded exactly once", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 4, maxAttempts: 2 });
  await jobs.claimNextJob(db);
  assert.equal(await jobs.failJob(db, jobId, "timeout"), "queued");
  makeRunnableNow(jobId);
  await jobs.claimNextJob(db);
  assert.equal(await jobs.failJob(db, jobId, "timeout"), "failed");
  assert.equal(await credits.getBalance(db, "u1"), 10);

  assert.equal(await jobs.failJob(db, jobId, "late duplicate"), "failed");
  assert.equal(row("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason = 'job_refund'").n, 1);
  assert.equal(await credits.getBalance(db, "u1"), 10);
});

test("runQueue completes jobs, fails permanent errors at once, and never charges for them", async () => {
  sqlite.exec("INSERT INTO plans (id, name, max_parallel_jobs) VALUES ('pro', 'Pro', 10)");
  sqlite.exec("INSERT INTO subscriptions (user_id, plan_id) VALUES ('u1', 'pro')");
  await credits.grantCredits(db, "u1", 20, "grant");
  const good = await jobs.enqueueJob(db, { userId: "u1", kind: "tts", input: { text: "สวัสดี" }, costCredits: 2 });
  const bad = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 5 });
  const unknown = await jobs.enqueueJob(db, { userId: "u1", kind: "hologram", input: {}, costCredits: 3 });

  const result = await jobs.runQueue(db, {
    tts: async (job) => ({ output: { audio: `r2://${JSON.parse(job.input).text}` }, providerCostUsd: 0.002 }),
    video: async () => { throw new jobs.PermanentJobError("content refused"); },
  });
  assert.deepEqual(result, { ran: 3, recovered: 0 });
  const done = row("SELECT status, output, provider_cost_usd FROM jobs WHERE id = ?", good.jobId);
  assert.equal(done.status, "done");
  assert.deepEqual(JSON.parse(done.output), { audio: "r2://สวัสดี" });
  assert.equal(row("SELECT status FROM jobs WHERE id = ?", bad.jobId).status, "failed");
  assert.match(row("SELECT error FROM jobs WHERE id = ?", unknown.jobId).error, /no handler/);
  assert.equal(await credits.getBalance(db, "u1"), 18, "only the finished job is charged");
});

test("expired leases are recovered as a failed attempt", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 3, maxAttempts: 1 });
  await jobs.claimNextJob(db);
  sqlite.prepare("UPDATE jobs SET lease_until = datetime('now', '-1 seconds') WHERE id = ?").run(jobId);
  assert.equal(await jobs.recoverExpiredLeases(db), 1);
  assert.equal(row("SELECT status, error FROM jobs WHERE id = ?", jobId).status, "failed");
  assert.equal(await credits.getBalance(db, "u1"), 10);
});

test("admin credit routes need the admin token and grant to a user", async () => {
  const env = { DB: db, ADMIN_TOKEN: "secret", ASSETS: { fetch: async () => new Response("asset") } };
  const call = (method, body, token = "secret") => worker.fetch(new Request("https://naka-ai.com/api/admin/credits/u%3A1", {
    method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body && JSON.stringify(body),
  }), env, {});

  assert.equal((await call("GET", null, "wrong")).status, 401);
  assert.equal((await call("POST", { amount: -5 })).status, 400);
  const granted = await call("POST", { amount: 30, note: "ทดลองใช้" });
  assert.equal(granted.status, 201);
  assert.deepEqual(await granted.json(), { balance: 30 });
  const info = await (await call("GET")).json();
  assert.equal(info.balance, 30);
  assert.equal(info.plan.id, "free");
  assert.equal(info.ledger[0].note, "ทดลองใช้");
});
