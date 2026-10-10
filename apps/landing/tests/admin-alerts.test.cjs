// LINE alerts for admins (src/admin/alerts.ts, migrations/pg/0006_admin_alerts.sql) and the history of every
// admin action (src/admin/audit.ts).
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `admin-alerts-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const { runAdminAlerts, ALERT_COOLDOWN } = require(path.join(buildDir, 'admin/alerts.js'));

const TOKEN = 'test-only-admin-token';
const LINE_SECRET = '0123456789abcdef0123456789abcdef';
const ADMIN_LINE = 'U' + 'a'.repeat(32);
const OTHER_LINE = 'U' + 'b'.repeat(32);
let sqlite, db, env, line;
const t = () => Math.floor(Date.now() / 1000);
const utc = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');

/** LINE stand-in: records every call; the profile answers a display name */
function fakeLine() {
  line = [];
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    line.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.includes('/profile/')) return new Response(JSON.stringify({ displayName: 'แอดมินนิด' }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
}
const pushes = () => line.filter(c => c.url.endsWith('/message/push'));
const replies = () => line.filter(c => c.url.endsWith('/message/reply')).map(c => c.body.messages[0].text);

beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 's'.repeat(40), LINE_CHANNEL_SECRET: LINE_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token', FEATURE_LINE_BOT: 'off', ASSETS: { fetch: async () => new Response('asset') } };
  fakeLine();
});
afterEach(() => { mock.restoreAll(); sqlite.close(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const site = (pathname, init = {}, e = env) => worker.fetch(new Request('https://naka.test' + pathname, {
  ...init, headers: { Authorization: 'Bearer ' + TOKEN, ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) }), e, { waitUntil() {} });
/** A LINE webhook delivery from `userId` saying `text`; waits for the background work. */
async function lineSays(userId, text, e = env) {
  const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'r-' + Math.random(), source: { type: 'user', userId }, message: { type: 'text', text } }] });
  const signature = createHmac('sha256', LINE_SECRET).update(body).digest('base64');
  const pending = [];
  const response = await worker.fetch(new Request('https://naka.test/webhook/line', { method: 'POST', body, headers: { 'x-line-signature': signature } }),
    e, { waitUntil(p) { pending.push(p); } });
  assert.equal(response.status, 200);
  await Promise.all(pending);
}
const recipientIds = () => sqlite.prepare('SELECT line_user_id FROM admin_alert_recipients ORDER BY line_user_id').all().map(r => r.line_user_id);
async function pairingCode() {
  const response = await site('/api/admin/alerts/pairing', { method: 'POST' });
  assert.equal(response.status, 200);
  return (await response.json()).code;
}
function addRecipient(id = ADMIN_LINE) {
  sqlite.prepare("INSERT INTO admin_alert_recipients (line_user_id, display_name, added_by, created_at) VALUES (?, 'แอดมิน', 'test', 1)").run(id);
}

test('pairing: a one-time code sent to the OA adds that LINE account; the code works once; stop removes it', async () => {
  const code = await pairingCode();
  assert.match(code, /^\d{6}$/);
  assert.ok(!JSON.stringify(sqlite.prepare('SELECT * FROM admin_alert_pairings').all()).includes(code), 'only the hash is stored');
  await lineSays(ADMIN_LINE, `แจ้งเตือน ${code}`);
  assert.deepEqual(recipientIds(), [ADMIN_LINE]);
  assert.equal(sqlite.prepare('SELECT display_name FROM admin_alert_recipients').get().display_name, 'แอดมินนิด');
  assert.match(replies().at(-1), /เชื่อมการแจ้งเตือน/);
  const audit = sqlite.prepare("SELECT target, action, actor FROM system_audit WHERE area = 'alert' ORDER BY rowid").all();
  assert.deepEqual(audit.map(a => [a.target, a.action, a.actor]), [['pairing', 'create', 'โทเคนฉุกเฉิน'], [ADMIN_LINE, 'create', 'โทเคนฉุกเฉิน']]);

  await lineSays(OTHER_LINE, `แจ้งเตือน ${code}`);
  assert.deepEqual(recipientIds(), [ADMIN_LINE], 'a used code does not work again');
  assert.match(replies().at(-1), /ไม่ถูกต้องหรือหมดอายุ/);

  await lineSays(ADMIN_LINE, 'หยุดแจ้งเตือน');
  assert.deepEqual(recipientIds(), []);
  assert.match(replies().at(-1), /หยุดส่งแจ้งเตือน/);
  const before = line.length;
  await lineSays(OTHER_LINE, 'หยุดแจ้งเตือน');
  assert.equal(line.length, before, 'from a customer it is just a chat message (the shop bot is off here: no answer)');
});

test('pairing: five wrong codes close every open code; an expired code never works', async () => {
  const code = await pairingCode();
  const wrong = code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) await lineSays(OTHER_LINE, `แจ้งเตือน ${wrong}`);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_alert_pairings').get().n, 0);
  await lineSays(ADMIN_LINE, `alert ${code}`);
  assert.deepEqual(recipientIds(), []);

  const late = await pairingCode();
  sqlite.prepare('UPDATE admin_alert_pairings SET expires_at = 1').run();
  await lineSays(ADMIN_LINE, `แจ้งเตือน ${late}`);
  assert.deepEqual(recipientIds(), []);
});

test('pairing and test messages need the LINE OA token', async () => {
  const e = { ...env, LINE_CHANNEL_ACCESS_TOKEN: '' };
  assert.equal((await site('/api/admin/alerts/pairing', { method: 'POST' }, e)).status, 409);
  assert.equal((await site('/api/admin/alerts/test', { method: 'POST' }, e)).status, 409);
});

test('the check: one message per new problem, quiet during the cool-down, repeated after it, recovery announced', async () => {
  addRecipient();
  const now = t();
  sqlite.prepare("INSERT INTO jobs (id, user_id, kind, status, cost_credits, updated_at, run_after) VALUES ('f1', 'u', 'ai_video', 'failed', 1, ?, ?), ('q1', 'u', 'ai_video', 'queued', 1, ?, ?)")
    .run(utc(now - 60), utc(now - 60), utc(now - 3600), utc(now - 3600));
  let result = await runAdminAlerts(env, now);
  assert.deepEqual(result, { sent: true, lines: 2 });
  assert.equal(pushes().length, 1);
  const text = pushes()[0].body.messages[0].text;
  assert.equal(pushes()[0].body.to, ADMIN_LINE);
  assert.match(text, /^แจ้งเตือนหลังร้าน naka-ai\n/);
  assert.match(text, /งานล้มเหลว 1 งาน/); assert.match(text, /งานรอคิวเกิน 15 นาที 1 งาน/);
  assert.match(text, /https:\/\/naka\.test\/admin\//);

  result = await runAdminAlerts(env, now + 300);
  assert.equal(result.sent, false, 'still the same problems: quiet');
  assert.equal(pushes().length, 1);

  sqlite.prepare("UPDATE jobs SET status = 'running' WHERE id = 'q1'").run();
  sqlite.prepare("UPDATE jobs SET updated_at = ? WHERE id = 'f1'").run(utc(now + ALERT_COOLDOWN));
  result = await runAdminAlerts(env, now + ALERT_COOLDOWN + 60);
  const last = pushes().at(-1).body.messages[0].text;
  assert.match(last, /งานล้มเหลว 1 งาน/, 'still failing after the cool-down: said again');
  assert.match(last, /คิวงานกลับมาเดินปกติแล้ว/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM admin_alert_log').get().n, 2);
});

test('the check: payments paid are announced once when that rule is on; nobody paired = nothing sent, no backlog later', async () => {
  const now = t();
  sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้านเอ', 1)").run();
  sqlite.prepare("INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at) VALUES ('p-old', 'u1', 'starter', 'monthly', 39900, 'promptpay', 'successful', ?, ?)").run(now - 100, now - 100);
  assert.deepEqual(await runAdminAlerts(env, now), { sent: false, lines: 0 }, 'no recipients');
  addRecipient();
  assert.equal((await site('/api/admin/alerts/rules', { method: 'PUT', json: { payment_paid: true } })).status, 200);
  await runAdminAlerts(env, now + 60);
  assert.equal(pushes().length, 0, 'the payment from before pairing is not replayed');
  sqlite.prepare("INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at) VALUES ('p-new', 'u1', 'pro', 'monthly', 79000, 'promptpay', 'successful', ?, ?)").run(now + 100, now + 100);
  await runAdminAlerts(env, now + 300);
  assert.equal(pushes().length, 1);
  assert.match(pushes()[0].body.messages[0].text, /รับเงิน ฿790 แพ็กเกจโปร จาก ร้านเอ/);
  await runAdminAlerts(env, now + 600);
  assert.equal(pushes().length, 1, 'announced once');
});

test('the check: studio unreachable and unknown tasks, then back to normal', async () => {
  addRecipient();
  const e = { ...env, STUDIO_INTERNAL_URL: 'http://studio:5679', STUDIO_ADMIN_TOKEN: 'studio-admin-token-0123456789' };
  let studioUp = false;
  mock.restoreAll(); line = [];
  mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = String(input);
    line.push({ url, body: init.body ? JSON.parse(init.body) : null });
    if (url.startsWith('http://studio:5679')) {
      if (!studioUp) throw new TypeError('fetch failed');
      const data = url.includes('failed-tasks') ? { days: 1, total: 0, tasks: [] } : { videoQueues: [{ unknown: 0 }] };
      return new Response(JSON.stringify({ code: 200, data }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  const now = t();
  await runAdminAlerts(e, now);
  assert.match(pushes().at(-1).body.messages[0].text, /เชื่อมต่อ Naka Studio ไม่ได้/);
  studioUp = true;
  await runAdminAlerts(e, now + 300);
  assert.match(pushes().at(-1).body.messages[0].text, /Naka Studio กลับมาปกติแล้ว/);
  assert.equal(pushes().length, 2);
  assert.ok(!line.some(c => c.url.startsWith('http://studio') && JSON.stringify(c).includes('line-token')));
});

test('admin API: view, rules, test message, remove a recipient', async () => {
  addRecipient(); addRecipient(OTHER_LINE);
  let view = await (await site('/api/admin/alerts')).json();
  assert.equal(view.lineReady, true);
  assert.deepEqual(view.recipients.map(r => r.id), [ADMIN_LINE, OTHER_LINE]);
  assert.deepEqual(view.rules.map(r => [r.key, r.enabled]), [['jobs_failed', true], ['studio', true], ['queue_stuck', true], ['payment_failed', true], ['payment_paid', false]]);

  for (const bad of [{}, { payment_paid: 'yes' }, { nope: true }]) assert.equal((await site('/api/admin/alerts/rules', { method: 'PUT', json: bad })).status, 400, JSON.stringify(bad));
  view = await (await site('/api/admin/alerts/rules', { method: 'PUT', json: { studio: false, payment_paid: true } })).json();
  assert.deepEqual(view.rules.filter(r => r.enabled).map(r => r.key), ['jobs_failed', 'queue_stuck', 'payment_failed', 'payment_paid']);

  const sent = await (await site('/api/admin/alerts/test', { method: 'POST' })).json();
  assert.deepEqual(sent, { recipients: 2, delivered: 2 });
  assert.match(pushes()[0].body.messages[0].text, /ทดสอบการแจ้งเตือน/);

  view = await (await site('/api/admin/alerts/recipients/' + OTHER_LINE, { method: 'DELETE' })).json();
  assert.deepEqual(view.recipients.map(r => r.id), [ADMIN_LINE]);
  assert.equal((await site('/api/admin/alerts/recipients/' + OTHER_LINE, { method: 'DELETE' })).status, 404);
  assert.equal(view.log.length, 1);
  const actions = sqlite.prepare("SELECT target, action FROM system_audit WHERE area = 'alert' ORDER BY rowid").all().map(a => a.action);
  assert.deepEqual(actions, ['update', 'test', 'remove']);
});

test('history: customer and system actions in one list, newest first, filtered and paged', async () => {
  sqlite.exec(`INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้านเอ', 1)`);
  for (let i = 0; i < 30; i++) {
    sqlite.prepare("INSERT INTO admin_audit (id, user_id, action, detail, note, actor, created_at) VALUES (?, 'u1', 'credits', ?, 'เติมให้', 'boss@example.test', ?)")
      .run('c' + String(i).padStart(2, '0'), JSON.stringify({ input: { amount: i + 1 } }), 1000 + i);
    sqlite.prepare("INSERT INTO system_audit (id, area, target, action, detail, note, actor, created_at) VALUES (?, 'setting', 'SIGNUP_CREDITS', 'set', '{\"after\":\"5\"}', '', 'โทเคนฉุกเฉิน', ?)")
      .run('s' + String(i).padStart(2, '0'), 1000 + i);
  }
  const page1 = await (await site('/api/admin/audit')).json();
  assert.equal(page1.entries.length, 50);
  assert.deepEqual(page1.entries.slice(0, 2).map(e => e.id), ['s29', 'c29'], 'same second: id breaks the tie');
  assert.deepEqual(page1.entries[1].detail, { input: { amount: 30 } });
  assert.equal(page1.entries[1].targetName, 'ร้านเอ');
  assert.deepEqual(page1.actors, ['boss@example.test', 'โทเคนฉุกเฉิน']);
  const page2 = await (await site('/api/admin/audit?cursor=' + encodeURIComponent(page1.nextCursor))).json();
  assert.equal(page2.entries.length, 10); assert.equal(page2.nextCursor, null);
  assert.equal(new Set([...page1.entries, ...page2.entries].map(e => e.id)).size, 60);

  const only = async (query) => (await (await site('/api/admin/audit?' + query)).json()).entries;
  assert.ok((await only('source=customer')).every(e => e.source === 'customer'));
  assert.ok((await only('actor=' + encodeURIComponent('โทเคนฉุกเฉิน'))).every(e => e.source === 'setting'));
  assert.equal((await only('q=' + encodeURIComponent('ร้านเอ'))).length, 30);
  assert.equal((await only('q=signup_credits')).length, 30);
  for (const bad of ['source=x', 'cursor=bad', 'q=' + 'a'.repeat(201)]) assert.equal((await site('/api/admin/audit?' + bad)).status, 400, bad);
  assert.equal((await site('/api/admin/audit', { method: 'POST', headers: { Origin: 'https://naka.test' } })).status, 405);
});
