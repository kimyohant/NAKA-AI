const assert = require("node:assert/strict");
const { after, beforeEach, test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const { migratedDb } = require("./helpers/d1.cjs");
const path = require("node:path");

// Lease fencing for the job queue (docs/security-audit-2026-10.md, finding 3): a worker whose
// lease expired and whose job was recovered must not write results, change status, or refund
// credits for an attempt it no longer owns. claimNextJob hands out `attempts` as the fencing
// token; completeJob/failJob only act while it still matches the running attempt.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `lease-fencing-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const credits = require(path.join(buildDir, "credits.js"));
const jobs = require(path.join(buildDir, "jobs.js"));

after(() => {
  assert.equal(path.dirname(buildDir), path.join(root, ".wrangler"));
  rmSync(buildDir, { recursive: true, force: true });
});

let sqlite;
let db;
beforeEach(() => {
  ({ sqlite, db } = migratedDb("0002_credits_jobs.sql", "0006_jobs_limit.sql"));
});

const jobRow = (id) => sqlite.prepare("SELECT status, attempts, output, error FROM jobs WHERE id = ?").get(id);
const expireLease = (id) => sqlite.prepare("UPDATE jobs SET lease_until = datetime('now', '-1 seconds') WHERE id = ?").run(id);
const makeRunnableNow = (id) => sqlite.prepare("UPDATE jobs SET run_after = datetime('now', '-1 seconds') WHERE id = ?").run(id);

async function seed(costCredits, maxAttempts = 3) {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "affiliate_review", input: { p: 1 }, costCredits, maxAttempts });
  return jobId;
}

test("fencing A: a stalled worker's completeJob cannot overwrite the reclaimed attempt", async () => {
  const jobId = await seed(1);
  const a = await jobs.claimNextJob(db); // worker A, attempts=1, stalls past its lease
  assert.equal(a.attempts, 1);
  expireLease(jobId);
  await jobs.recoverExpiredLeases(db); // back to the queue, retryable
  makeRunnableNow(jobId); // skip the 30s backoff the way waiting it out would
  const b = await jobs.claimNextJob(db); // worker B, attempts=2
  assert.equal(b.attempts, 2);

  const applied = await jobs.completeJob(db, jobId, a.attempts, { output: "ผลเก่าของ A" });
  assert.equal(applied, false, "a fenced worker must not write its result");
  const row = jobRow(jobId);
  assert.equal(row.status, "running", "the job still belongs to worker B");
  assert.equal(row.output, null);
  assert.equal(row.attempts, 2);

  assert.equal(await jobs.completeJob(db, jobId, b.attempts, { output: "ผลของ B" }), true);
  assert.deepEqual(JSON.parse(jobRow(jobId).output), { output: "ผลของ B" });
  assert.equal(await credits.getBalance(db, "u1"), 9, "the successful attempt is charged once");
});

test("fencing B: a stale worker's failJob cannot fail the running attempt or refund credits", async () => {
  const jobId = await seed(1);
  // Burn attempts 1 and 2 through lease recovery so the third claim is the last one.
  for (let i = 0; i < 2; i++) {
    await jobs.claimNextJob(db);
    expireLease(jobId);
    await jobs.recoverExpiredLeases(db);
    makeRunnableNow(jobId);
  }
  const b = await jobs.claimNextJob(db); // attempts=3, worker B is running it right now
  assert.equal(b.attempts, 3);
  const balanceBefore = await credits.getBalance(db, "u1"); // 10 minus the 1-credit hold
  assert.equal(balanceBefore, 9);
  const errorBefore = jobRow(jobId).error; // recovery's note from the burned attempts

  const status = await jobs.failJob(db, jobId, b.attempts - 1, "ผู้ให้บริการล้มเหลว (รายงานมาช้า)"); // stale token 2
  assert.notEqual(status, "failed");
  assert.notEqual(status, "queued");
  const row = jobRow(jobId);
  assert.equal(row.status, "running", "worker B's attempt is untouched");
  assert.equal(row.error, errorBefore, "the stale worker's error was not recorded");
  assert.equal(await credits.getBalance(db, "u1"), balanceBefore, "a fenced worker never refunds");

  assert.equal(await jobs.completeJob(db, jobId, b.attempts, { output: "B สำเร็จ" }), true);
  assert.deepEqual(JSON.parse(jobRow(jobId).output), { output: "B สำเร็จ" });
  assert.equal(await credits.getBalance(db, "u1"), balanceBefore, "no refund after B finishes");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason = 'job_refund'").get().n, 0);
});

test("fencing B-2: a late failJob cannot double-refund a job recovery already failed", async () => {
  const jobId = await seed(1, 1);
  const a = await jobs.claimNextJob(db); // attempts=1, maxAttempts=1
  expireLease(jobId);
  await jobs.recoverExpiredLeases(db); // fails the job and refunds the hold
  assert.equal(jobRow(jobId).status, "failed");
  assert.equal(await credits.getBalance(db, "u1"), 10);

  await jobs.failJob(db, jobId, a.attempts, "worker ที่ค้างรายงานความผิดพลาดมาช้า");
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM credit_ledger WHERE reason = 'job_refund'").get().n, 1, "refund exactly once");
  assert.equal(await credits.getBalance(db, "u1"), 10);
});

test("the owner of an attempt can still retry, and recovery refunds exactly once at maxAttempts", async () => {
  const jobId = await seed(4, 2);
  const first = await jobs.claimNextJob(db);
  assert.equal(await jobs.failJob(db, jobId, first.attempts, "provider 503"), "queued", "the attempt owner may retry");
  makeRunnableNow(jobId);
  const second = await jobs.claimNextJob(db);
  expireLease(jobId);
  assert.equal(await jobs.recoverExpiredLeases(db), 1);
  assert.equal(jobRow(jobId).status, "failed", "maxAttempts exhausted through the recovery");
  assert.equal(await credits.getBalance(db, "u1"), 10, "refunded once by the recovery");

  assert.equal(await jobs.completeJob(db, jobId, second.attempts, { output: "ผลเก่า" }), false);
  assert.equal(jobRow(jobId).status, "failed");
  assert.equal(await credits.getBalance(db, "u1"), 10);
});
