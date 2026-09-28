const assert = require("node:assert/strict");
const { after, test, mock } = require("node:test");
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const path = require("node:path");

// Use the project's compiler and SDK; tests never call an external provider.
const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, ".wrangler", `studio-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), "-p", root,
  "--noEmit", "false", "--module", "node16", "--moduleResolution", "node16",
  "--rootDir", path.join(root, "src"), "--outDir", buildDir,
], { cwd: root, stdio: "inherit" });
const { handleStudio, parseStudioOutput } = require(path.join(buildDir, "studio.js"));
const worker = require(path.join(buildDir, "index.js")).default;
const Anthropic = require("@anthropic-ai/sdk").default;

after(() => {
  mock.restoreAll();
  assert.equal(path.dirname(buildDir), path.join(root, ".wrangler"));
  rmSync(buildDir, { recursive: true, force: true });
});

const fetchMock = mock.method(globalThis, "fetch", async () => {
  throw new Error("External requests are disabled in studio tests");
});

const input = {
  productName: "สบู่มะลิ", details: "สบู่กลิ่นมะลิ น้ำหนัก 100 กรัม", price: "129 บาท",
  tone: "friendly", channel: "facebook", brandName: "ร้านมะลิ", brandVoice: "อบอุ่น",
};
const generated = {
  captions: [
    { title: "แนะนำสินค้า", text: "สบู่มะลิจากร้านมะลิ ขนาด 100 กรัม ราคา 129 บาท" },
    { title: "เล่าเรื่องกลิ่น", text: "ให้กลิ่นมะลิเป็นส่วนหนึ่งของวัน" },
    { title: "ชวนมาคุย", text: "สนใจสบู่มะลิ ทักมาสอบถามได้เลย" },
  ],
  script: "0–5 วินาที: ภาพสบู่มะลิ วางบนผ้าสีขาว",
  plan: ["วันแรก: แนะนำสินค้า", "วันที่สอง: เล่าเรื่องกลิ่น", "วันที่สาม: ตอบคำถาม"],
  imagePrompt: "Jasmine soap on a white linen background, natural light, no text",
};
const env = { ANTHROPIC_API_KEY: "test-provider-key", ADMIN_TOKEN: "test-admin-token" };
const request = (data = input, options = {}) => new Request("https://naka.test/api/admin/studio", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: "Bearer test-admin-token" },
  body: JSON.stringify(data),
  ...options,
});
const generate = async () => JSON.stringify(generated);

test("admin router rejects missing, wrong, or unconfigured credentials before generation", async () => {
  for (const token of [undefined, "Bearer wrong-token"]) {
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = token;
    const response = await worker.fetch(request(input, { headers }), env, {});
    assert.equal(response.status, 401);
  }
  const response = await worker.fetch(request(), { ...env, ADMIN_TOKEN: "" }, {});
  assert.equal(response.status, 401);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("authenticated endpoint uses only POST", async () => {
  const response = await worker.fetch(request(input, { method: "GET", body: undefined }), env, {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "POST");
});

test("invalid JSON, content type, fields, enums, and lengths return 400 without generating", async () => {
  let calls = 0;
  const shouldNotGenerate = async () => { calls++; return JSON.stringify(generated); };
  const invalid = [
    null, [], {}, { ...input, productName: " " }, { ...input, details: 12 },
    { ...input, details: "x".repeat(3001) }, { ...input, price: 129 },
    { ...input, tone: "unknown" }, { ...input, tone: ["friendly"] },
    { ...input, channel: "unknown" }, { ...input, channel: ["facebook"] },
    { ...input, workflow: "unknown" }, { ...input, workflow: ["sales"] },
    { ...input, brandName: null }, { ...input, brandVoice: "x".repeat(1001) },
  ];
  for (const data of invalid) {
    const response = await handleStudio(request(data), env, shouldNotGenerate);
    assert.equal(response.status, 400, JSON.stringify(data).slice(0, 150));
  }
  for (const req of [
    request(input, { body: "{invalid" }),
    request(input, { headers: { "Content-Type": "text/plain" } }),
  ]) assert.equal((await handleStudio(req, env, shouldNotGenerate)).status, 400);
  assert.equal(calls, 0);
});

test("body cap enforces both declared size and actual UTF-8 bytes", async () => {
  const oversized = { ...input, details: "ก".repeat(6000) };
  const response = await handleStudio(request(oversized), env, generate);
  assert.equal(response.status, 413);
  const declared = await handleStudio(request(input, {
    headers: { "Content-Type": "application/json", "Content-Length": "17000" },
  }), env, generate);
  assert.equal(declared.status, 413);
});

test("missing provider key returns 503 and does not generate", async () => {
  let called = false;
  const response = await handleStudio(request(), { ANTHROPIC_API_KEY: "  " }, async () => {
    called = true;
    return JSON.stringify(generated);
  });
  assert.equal(response.status, 503);
  assert.equal(called, false);
});

test("input is trimmed and whitelisted; successful output has the agreed contract", async () => {
  let received;
  const response = await handleStudio(request({ ...input, productName: "  สบู่มะลิ  ", secret: "ignored" }), env,
    async (data, key) => {
      received = data;
      assert.equal(key, env.ANTHROPIC_API_KEY);
      return JSON.stringify({ ...generated, debug: "ignored", mode: "anything" });
    });
  assert.deepEqual(received, input);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), { mode: "ai", ...generated });
});

test("parser accepts fenced JSON and rejects incomplete or malformed provider output", () => {
  assert.deepEqual(parseStudioOutput("```json\n" + JSON.stringify(generated) + "\n```"), { mode: "ai", ...generated });
  for (const data of [
    null, {}, { ...generated, captions: generated.captions.slice(0, 2) },
    { ...generated, captions: [null, null, null] }, { ...generated, plan: ["one"] },
    { ...generated, script: " " }, { ...generated, imagePrompt: 123 },
    { ...generated, plan: ["ok", "ok", {}] },
  ]) assert.throws(() => parseStudioOutput(JSON.stringify(data)));
  assert.throws(() => parseStudioOutput("prefix " + JSON.stringify(generated)));
  assert.throws(() => parseStudioOutput("{"));
});

test("four workflows and new sales channels reach generation without losing the selected job", async () => {
  for (const workflow of ["sales", "drama", "bot", "live"]) {
    for (const channel of ["tiktok", "shopee", "facebook", "instagram"]) {
      let received;
      const response = await handleStudio(request({ ...input, workflow, channel }), env, async data => {
        received = data;
        return JSON.stringify(generated);
      });
      assert.equal(response.status, 200);
      assert.equal(received.workflow, workflow);
      assert.equal(received.channel, channel);
    }
  }
});

test("unusable output and provider errors return a generic 502 without leaking details", async () => {
  for (const provider of [
    async () => "not JSON",
    async () => JSON.stringify({ ...generated, plan: [] }),
    async () => { throw new Error("private provider diagnostics test-provider-key"); },
  ]) {
    const response = await handleStudio(request(), env, provider);
    assert.equal(response.status, 502);
    const result = await response.json();
    assert.equal(typeof result.error, "string");
    assert.ok(!JSON.stringify(result).includes("private"));
    assert.ok(!JSON.stringify(result).includes("test-provider-key"));
  }
});

test("provider timeout returns a retryable Thai 504 error", async () => {
  const response = await handleStudio(request(), env, async () => {
    throw new Anthropic.APIConnectionTimeoutError();
  });
  assert.equal(response.status, 504);
  assert.match((await response.json()).error, /ลองอีกครั้ง/);
});

test("authenticated route integrates with the SDK using mocked HTTP only", async () => {
  let sent;
  fetchMock.mock.mockImplementationOnce(async (url, options) => {
    assert.match(String(url), /^https:\/\/api\.anthropic\.com\/v1\/messages/);
    sent = JSON.parse(options.body);
    return new Response(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5",
      content: [{ type: "text", text: JSON.stringify(generated) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { headers: { "Content-Type": "application/json" } });
  });
  const response = await worker.fetch(request(), env, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { mode: "ai", ...generated });
  assert.equal(sent.model, "claude-opus-5");
  assert.equal(sent.output_config.format.type, "json_schema");
  assert.deepEqual(JSON.parse(sent.messages[0].content), input);
  assert.ok(!JSON.stringify(sent).includes(env.ANTHROPIC_API_KEY));
});

test("SDK refusal or truncated generation is never presented as complete AI output", async () => {
  for (const stopReason of ["refusal", "max_tokens", "pause_turn"]) {
    fetchMock.mock.mockImplementationOnce(async () => new Response(JSON.stringify({
      id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5",
      content: [{ type: "text", text: JSON.stringify(generated) }],
      stop_reason: stopReason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
    }), { headers: { "Content-Type": "application/json" } }));
    const response = await worker.fetch(request(), env, {});
    assert.equal(response.status, 502);
  }
});
