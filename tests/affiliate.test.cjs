const assert = require("node:assert/strict");
const { after, beforeEach, mock, test } = require("node:test");
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const path = require("node:path");
const { migratedDb } = require("./helpers/d1.cjs");

// Compile src with the project's compiler; no test calls Claude or Google.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `affiliate-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const affiliate = require(path.join(buildDir, "affiliate.js"));
const jobs = require(path.join(buildDir, "jobs.js"));
const credits = require(path.join(buildDir, "credits.js"));

const fetchMock = mock.method(globalThis, "fetch", async () => {
  throw new Error("External requests are disabled in affiliate tests");
});
after(() => {
  mock.restoreAll();
  assert.equal(path.dirname(buildDir), path.join(root, ".wrangler"));
  rmSync(buildDir, { recursive: true, force: true });
});

const brief = {
  productName: "สบู่มะลิ", details: "สบู่กลิ่นมะลิ 100 กรัม", price: "129 บาท",
  affiliateUrl: "https://s.shopee.co.th/abc123", tone: "friendly", channel: "tiktok", imageCount: 2,
};
const script = {
  hook: "สบู่หอมมะลิทั้งวัน",
  scenes: [
    { voiceover: "ใครชอบกลิ่นมะลิต้องดู", onScreenText: "หอมมะลิ", imageIndex: 0, motion: "zoom_in" },
    { voiceover: "ก้อนละร้อยกรัม", onScreenText: "100 กรัม", imageIndex: 5, motion: "pan_left" },
    { voiceover: "กดลิงก์ในโพสต์ได้เลย", onScreenText: "ลิงก์ในโพสต์", imageIndex: -1, motion: "zoom_out" },
  ],
  postCaption: "สบู่มะลิ 129 บาท",
  hashtags: ["สบู่มะลิ", "#ของดีบอกต่อ"],
};
const env = { ANTHROPIC_API_KEY: "test", GOOGLE_TTS_API_KEY: "tts-key" };
const job = (input) => ({ id: "j1", kind: affiliate.AFFILIATE_JOB_KIND, input: JSON.stringify(input) });

let sqlite;
let db;
beforeEach(() => {
  ({ sqlite, db } = migratedDb("0002_credits_jobs.sql", "0006_jobs_limit.sql"));
  fetchMock.mock.resetCalls();
});

test("input validation rejects bad links, image counts, and unsupported channels", () => {
  assert.deepEqual(affiliate.parseAffiliateInput(brief), brief);
  for (const bad of [
    { ...brief, affiliateUrl: "http://s.shopee.co.th/x" },
    { ...brief, affiliateUrl: "not a url" },
    { ...brief, imageCount: 0 },
    { ...brief, imageCount: 7 },
    { ...brief, channel: "line" },
    { ...brief, productName: "   " },
  ]) assert.throws(() => affiliate.parseAffiliateInput(bad), affiliate.InputError);
  assert.equal(affiliate.parseAffiliateInput({ ...brief, affiliateUrl: "" }).affiliateUrl, undefined);
});

test("the script parser keeps image choices in range and normalises hashtags", () => {
  const parsed = affiliate.parseReviewScript(JSON.stringify(script), 2);
  assert.deepEqual(parsed.scenes.map((s) => s.imageIndex), [0, 1, 1]);
  assert.deepEqual(parsed.hashtags, ["#สบู่มะลิ", "#ของดีบอกต่อ"]);
  assert.throws(() => affiliate.parseReviewScript(JSON.stringify({ ...script, scenes: script.scenes.slice(0, 2) }), 2));
  assert.throws(() => affiliate.parseReviewScript(JSON.stringify({ ...script, hook: "x".repeat(61) }), 2));
});

test("the job handler voices every scene and appends the affiliate link itself", async () => {
  const seen = [];
  const handler = affiliate.makeAffiliateHandler(env, async (input) => {
    assert.equal(input.affiliateUrl, "https://s.shopee.co.th/abc123");
    return JSON.stringify(script);
  }, async (text) => { seen.push(text); return Buffer.from(text).toString("base64"); });

  const { output } = await handler(job(brief));
  assert.deepEqual(seen, script.scenes.map((s) => s.voiceover));
  assert.equal(output.audio.length, 3);
  assert.equal(output.audio[0].mimeType, "audio/mpeg");
  assert.ok(output.script.postCaption.endsWith("https://s.shopee.co.th/abc123"));
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("Google TTS errors are permanent unless retrying can help", async () => {
  const respond = (status, body = {}) => fetchMock.mock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));

  respond(200, { audioContent: "QUJD" });
  assert.equal(await affiliate.synthesizeThai("สวัสดี", env), "QUJD");
  const [url, init] = fetchMock.mock.calls[0].arguments;
  assert.equal(url, "https://texttospeech.googleapis.com/v1/text:synthesize");
  assert.equal(init.headers["X-Goog-Api-Key"], "tts-key");
  assert.equal(JSON.parse(init.body).voice.languageCode, "th-TH");

  respond(403);
  await assert.rejects(affiliate.synthesizeThai("x", env), jobs.PermanentJobError);
  respond(503);
  await assert.rejects(affiliate.synthesizeThai("x", env), (err) => !(err instanceof jobs.PermanentJobError));
  await assert.rejects(affiliate.synthesizeThai("x", { GOOGLE_TTS_API_KEY: "" }), jobs.PermanentJobError);
});

test("a refused script fails the job at once and refunds the seller", async () => {
  await credits.grantCredits(db, "u1", 5, "grant");
  const { jobId } = await jobs.enqueueJob(db, { userId: "u1", kind: affiliate.AFFILIATE_JOB_KIND, input: brief, costCredits: 1 });
  const handler = affiliate.makeAffiliateHandler(env, async () => { throw new jobs.PermanentJobError("script refused"); });
  await jobs.runQueue(db, { [affiliate.AFFILIATE_JOB_KIND]: handler });
  assert.equal(sqlite.prepare("SELECT status FROM jobs WHERE id = ?").get(jobId).status, "failed");
  assert.equal(await credits.getBalance(db, "u1"), 5);
});

test("the API enqueues, reports queue position, and hides failures and other users' jobs", async () => {
  const call = (method, pathname, body, userId = "u1") => affiliate.handleAffiliateApi(
    new Request(`https://naka-ai.com${pathname}`, {
      method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body),
    }), { DB: db }, new URL(`https://naka-ai.com${pathname}`), userId);

  assert.equal(await call("GET", "/api/health"), null);
  assert.equal((await call("POST", "/api/affiliate/reviews", brief)).status, 402);
  assert.equal((await call("POST", "/api/affiliate/reviews", { ...brief, imageCount: 9 })).status, 400);

  await credits.grantCredits(db, "u1", 5, "grant");
  const created = await call("POST", "/api/affiliate/reviews", brief);
  assert.equal(created.status, 202);
  const { jobId } = await created.json();
  assert.equal((await call("POST", "/api/affiliate/reviews", brief)).status, 429, "free plan runs one job at a time");

  const queued = await (await call("GET", `/api/affiliate/reviews/${jobId}`)).json();
  assert.deepEqual(queued, { status: "queued", ahead: 0 });
  assert.equal((await call("GET", `/api/affiliate/reviews/${jobId}`, null, "u2")).status, 404);

  await jobs.claimNextJob(db);
  await jobs.failJob(db, jobId, "tts 403 secret detail", false);
  const failed = await (await call("GET", `/api/affiliate/reviews/${jobId}`)).json();
  assert.equal(failed.status, "failed");
  assert.doesNotMatch(failed.error, /403|secret/);
});

test("the worker mounts /api/affiliate behind the session cookie", async () => {
  const { sqlite: s, db: authDb } = migratedDb("0001_auth.sql", "0002_credits_jobs.sql", "0006_jobs_limit.sql");
  const worker = require(path.join(buildDir, "index.js")).default;
  const { sha256 } = require(path.join(buildDir, "auth", "common.js"));
  const token = "A".repeat(43);
  s.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ทดสอบ', 0)").run();
  s.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 'u1', ?, 0)").run(await sha256(token), 4102444800);
  await credits.grantCredits(authDb, "u1", 3, "grant");
  const env = { DB: authDb, ASSETS: { fetch: async () => new Response("asset") }, APP_ORIGIN: "https://naka-ai.com" };
  const post = (headers) => worker.fetch(new Request("https://naka-ai.com/api/affiliate/reviews", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(brief),
  }), env, { waitUntil() {} });

  assert.equal((await post({ Origin: "https://naka-ai.com" })).status, 401);
  assert.equal((await post({ Origin: "https://evil.example", Cookie: `naka_session=${token}` })).status, 403);
  const created = await post({ Origin: "https://naka-ai.com", Cookie: `naka_session=${token}` });
  assert.equal(created.status, 202);
  const { jobId } = await created.json();
  const status = await worker.fetch(new Request(`https://naka-ai.com/api/affiliate/reviews/${jobId}`, { headers: { Cookie: `naka_session=${token}` } }), env, {});
  assert.deepEqual(await status.json(), { status: "queued", ahead: 0 });
});
