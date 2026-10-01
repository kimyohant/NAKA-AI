const assert = require("node:assert/strict");
const { after, beforeEach, test, mock } = require("node:test");
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const { migratedDb } = require("./helpers/d1.cjs");
const path = require("node:path");

// Provider and tool errors are logged and stored by class only (docs/security-audit-2026-10.md,
// finding 5): error messages can echo customer content, so they must never reach console.error
// or the jobs.error column. PermanentJobError keeps its fixed, content-free reason codes.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `log-scrubbing-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const credits = require(path.join(buildDir, "credits.js"));
const jobs = require(path.join(buildDir, "jobs.js"));

after(() => {
  mock.restoreAll();
  rmSync(buildDir, { recursive: true, force: true });
});

let sqlite, db;
beforeEach(() => {
  ({ sqlite, db } = migratedDb("0002_credits_jobs.sql", "0006_jobs_limit.sql"));
  mock.method(console, "error", () => {});
});

const CUSTOMER_TEXT = "MARKER-ลูกค้าสบู่หอม-0891234567";
const jobError = (id) => sqlite.prepare("SELECT error FROM jobs WHERE id = ?").get(id).error;
const loggedLines = () => console.error.mock.calls.map((call) => call.arguments.map(String).join(" ")).join("\n");

test("a handler error's message never reaches console.error or jobs.error", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: { note: CUSTOMER_TEXT }, costCredits: 1, maxAttempts: 1 });
  const result = await jobs.runQueue(db, {
    video: async () => { throw new Error(`ล้มเหลวขณะประมวลผล ${CUSTOMER_TEXT}`); },
  });
  assert.deepEqual(result, { ran: 1, recovered: 0 });

  assert.ok(!loggedLines().includes(CUSTOMER_TEXT), "customer content must not be logged");
  assert.equal(jobError(jobId), "Error", "only the error class is stored");
  assert.equal(await credits.getBalance(db, "u1"), 10, "the failed attempt is refunded once");
});

test("a provider-style error records its class and status code, not the message", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 1 });
  await jobs.runQueue(db, {
    video: async () => { throw Object.assign(new Error(`ตอบกลับผู้ให้บริการ ${CUSTOMER_TEXT}`), { status: 502 }); },
  });

  assert.equal(jobError(jobId), "Error (status 502)");
  assert.ok(!loggedLines().includes(CUSTOMER_TEXT), "provider response content must not be logged");
  assert.ok(loggedLines().includes("Error (status 502)"), "the class and status still reach the log");
});

test("PermanentJobError keeps its fixed reason code (handlers throw content-free codes)", async () => {
  await credits.grantCredits(db, "u1", 10, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: "video", input: {}, costCredits: 1 });
  await jobs.runQueue(db, {
    video: async () => { throw new jobs.PermanentJobError("script refused"); },
  });

  assert.equal(jobError(jobId), "script refused");
  assert.equal(await credits.getBalance(db, "u1"), 10, "permanent failures are refunded at once");
});

test("errorSummary itself never returns a message for ordinary errors", () => {
  assert.equal(jobs.errorSummary(new Error(CUSTOMER_TEXT)), "Error");
  assert.equal(jobs.errorSummary(Object.assign(new Error("x"), { status: 429 })), "Error (status 429)");
  assert.equal(jobs.errorSummary("string error"), "string");
  assert.equal(jobs.errorSummary(new jobs.PermanentJobError("tts 403")), "tts 403");
});
