// /api/admin/studio-system (src/admin/studio-system.ts): the back office reads naka-studio server to server
// with its ADMIN_TOKEN, and cancelling a stuck video task is recorded in system_audit.
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `studio-system-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;

const TOKEN = 'test-only-admin-token';
const STUDIO_TOKEN = 'studio-admin-token-0123456789';
const OVERVIEW = { version: '1.2.3', storage: { usage: { total: 10 } }, videoQueues: [{ configId: 2, name: 'Unsloth', queued: 1, running: 1, unknown: 1, waiting: [] }] };
let sqlite, db, env, studioCalls;

/** naka-studio stand-in: records each call and answers with `reply(url, init)` */
function fakeStudio(reply) {
  studioCalls = [];
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    studioCalls.push({ url, init });
    return reply(url, init);
  });
}
const studioJson = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 's'.repeat(40),
    STUDIO_INTERNAL_URL: 'http://studio:5679/', STUDIO_ADMIN_TOKEN: STUDIO_TOKEN, ASSETS: { fetch: async () => new Response('asset') } };
});
afterEach(() => { mock.restoreAll(); sqlite.close(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const site = (pathname, init = {}, e = env) => worker.fetch(new Request('https://naka.test' + pathname, {
  ...init, headers: { Authorization: 'Bearer ' + TOKEN, ...(init.headers || {}) } }), e, { waitUntil() {} });
const auditRows = () => sqlite.prepare("SELECT area, target, action, detail, actor FROM system_audit WHERE area = 'studio' ORDER BY rowid").all();

test('admins only: no token, a wrong token, or a non-admin request never reaches the studio', async () => {
  fakeStudio(() => studioJson({ code: 200, data: OVERVIEW }));
  const anonymous = await worker.fetch(new Request('https://naka.test/api/admin/studio-system'), env, { waitUntil() {} });
  assert.equal(anonymous.status, 401);
  assert.equal((await site('/api/admin/studio-system', { headers: { Authorization: 'Bearer wrong' } })).status, 401);
  assert.equal(studioCalls.length, 0);
});

test('overview: one server-to-server call with the studio token; the token never reaches the browser', async () => {
  fakeStudio(() => studioJson({ code: 200, data: OVERVIEW, message: 'success' }));
  const response = await site('/api/admin/studio-system');
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { overview: OVERVIEW });
  assert.ok(!text.includes(STUDIO_TOKEN));
  assert.equal(studioCalls.length, 1);
  const [{ url, init }] = studioCalls;
  assert.equal(url, 'http://studio:5679/api/v1/system/overview', 'the trailing slash of the setting is dropped');
  assert.equal(init.headers['X-Admin-Token'], STUDIO_TOKEN);
  assert.equal(init.redirect, 'error', 'the token must not follow a redirect');
});

test('not connected yet, wrong studio token, studio down: clear messages, nothing leaks', async () => {
  fakeStudio(() => studioJson({ code: 200, data: OVERVIEW }));
  const unset = await site('/api/admin/studio-system', {}, { ...env, STUDIO_ADMIN_TOKEN: '' });
  assert.equal(unset.status, 503);
  assert.match((await unset.json()).error, /ยังไม่ได้เชื่อมต่อ naka-studio/);
  assert.equal(studioCalls.length, 0);

  fakeStudio(() => studioJson({ code: 401, message: 'admin token required', errorCode: 'E_ADMIN_REQUIRED' }, 401));
  const refused = await site('/api/admin/studio-system');
  assert.equal(refused.status, 502);
  assert.match((await refused.json()).error, /ไม่รับโทเคน/);

  fakeStudio(() => { throw new TypeError('fetch failed'); });
  const down = await site('/api/admin/studio-system');
  assert.equal(down.status, 502);
  const message = (await down.json()).error;
  assert.match(message, /เชื่อมต่อ naka-studio ไม่ได้/);
  assert.ok(!message.includes('studio:5679'), 'the internal address is not echoed');
});

test('cancel: forwarded to the studio and recorded; refused by the studio → 409, nothing recorded', async () => {
  fakeStudio(() => studioJson({ code: 200, data: { status: 'cancelled' }, message: 'success' }));
  const done = await site('/api/admin/studio-system/tasks/29/cancel', { method: 'POST' });
  assert.equal(done.status, 200, await done.clone().text());
  assert.deepEqual(await done.json(), { ok: true, taskId: 29 });
  assert.equal(studioCalls[0].url, 'http://studio:5679/api/v1/tasks/29/cancel');
  assert.equal(studioCalls[0].init.method, 'POST');
  assert.deepEqual(auditRows().map(r => ({ ...r, detail: JSON.parse(r.detail) })),
    [{ area: 'studio', target: 'task:29', action: 'cancel', detail: { taskId: 29 }, actor: 'โทเคนฉุกเฉิน' }]);

  fakeStudio(() => studioJson({ code: 400, message: 'Only queued or unknown tasks can be cancelled' }, 400));
  const refused = await site('/api/admin/studio-system/tasks/17/cancel', { method: 'POST' });
  assert.equal(refused.status, 409);
  assert.match((await refused.json()).error, /Only queued or unknown tasks can be cancelled/);
  assert.equal(auditRows().length, 1);

  assert.equal((await site('/api/admin/studio-system/tasks/29/cancel')).status, 404, 'GET does not cancel');
  assert.equal((await site('/api/admin/studio-system/tasks/0/cancel', { method: 'POST' })).status, 404);
  assert.equal((await site('/api/admin/studio-system/tasks/abc/cancel', { method: 'POST' })).status, 404);
});
