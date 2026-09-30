const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, readdirSync, rmSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `admin-customers-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const { handleAdminCustomers } = require(path.join(buildDir, 'admin/customers.js'));
const { getUser, requireUser, createSession } = require(path.join(buildDir, 'auth/session.js'));
const migrations = readdirSync(path.join(root, 'migrations')).filter(name => /^000[1-9]_.*\.sql$/.test(name)).sort();
const TOKEN = 'test-only-admin-token';
const MONTH = 30 * 86400;
let sqlite, db, env;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...migrations));
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test' };
  sqlite.exec(`INSERT INTO users (id, display_name, created_at, status) VALUES
    ('u1', 'ร้านทดสอบ', 100, 'active'), ('u2', 'Second Shop', 200, 'disabled');
    INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES
    ('phone1', 'u1', 'phone', '+66812345678', NULL, 1), ('google1', 'u1', 'google', 'sub1', 'buyer@example.test', 1);
    INSERT INTO social_accounts (id, user_id, platform, external_id, name, token_enc, status, created_at)
    VALUES ('social1', 'u1', 'facebook', 'page1', 'เพจทดสอบ', 'NEVER_RETURN_THIS_SECRET', 'active', 100);`);
});
afterEach(() => sqlite.close());
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });
function call(route = '', data, options = {}) {
  const url = new URL('https://naka.test/api/admin/customers' + route);
  return handleAdminCustomers(new Request(url, { method: options.method || (data === undefined ? 'GET' : 'POST'),
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Origin: 'https://naka.test', ...options.headers },
    ...(data === undefined ? {} : { body: options.raw ? data : JSON.stringify(data) }) }), env, url);
}
const balance = () => sqlite.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM credit_ledger WHERE user_id = 'u1'").get().n;
const subscription = () => sqlite.prepare("SELECT * FROM subscriptions WHERE user_id = 'u1'").get();
const audit = () => sqlite.prepare("SELECT * FROM admin_audit WHERE user_id = 'u1' ORDER BY rowid").all().map(r => ({ ...r, detail: JSON.parse(r.detail) }));
const grant = (amount = 30) => call('/u1/credits', { amount, note: 'เติมทดสอบ' });
const pack = (planId = 'starter', months = 1) => call('/u1/package', { planId, months, note: 'โอนนอกระบบ' });

test('search normalizes Thai phones and finds email, name, id; literal wildcard and SQL input do not match everything', async () => {
  for (const q of ['0812345678', '+66812345678', '081-234-5678', 'BUYER@EXAMPLE.TEST', 'ทดสอบ', 'u1']) {
    const response = await call('?q=' + encodeURIComponent(q));
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).customers.map(c => c.id), ['u1']);
  }
  for (const q of ['missing', '%', '_', "' OR 1=1 --"]) assert.deepEqual((await (await call('?q=' + encodeURIComponent(q))).json()).customers, []);
  const response = await call();
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual((await response.json()).customers.map(c => c.id), ['u2', 'u1']);
  assert.equal((await call('?q=' + 'a'.repeat(201))).status, 400);
});

test('list limits to newest 50 and shows expired plans as free before cron runs', async () => {
  for (let i = 0; i < 55; i++) sqlite.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run('extra' + i, 'ลูกค้า', 1000 + i);
  assert.equal((await (await call()).json()).customers.length, 50);
  assert.equal((await (await call()).json()).customers[0].id, 'extra54');
  await pack();
  sqlite.prepare("UPDATE subscriptions SET expires_at = 1 WHERE user_id = 'u1'").run();
  const user = (await (await call('?q=u1')).json()).customers[0];
  assert.equal(user.planId, 'free'); assert.equal(user.credits, 30);
});

test('credit grant and audit are atomic, record before/after and use the original grant ledger semantics', async () => {
  const result = await grant();
  assert.equal(result.status, 200);
  assert.equal(balance(), 30);
  const row = audit()[0];
  assert.equal((await result.json()).auditId, row.id);
  assert.equal(row.action, 'credits'); assert.equal(row.note, 'เติมทดสอบ');
  assert.equal(row.detail.before.credits, 0); assert.equal(row.detail.after.credits, 30);
  assert.deepEqual(row.detail.input, { amount: 30, note: 'เติมทดสอบ' });
  const ledger = sqlite.prepare('SELECT * FROM credit_ledger').get();
  assert.equal(ledger.reason, 'grant'); assert.equal(ledger.note, 'เติมทดสอบ');
  await grant(10); assert.equal(balance(), 40); assert.equal(audit()[1].detail.before.credits, 30);
});

test('invalid amount or note never changes credits or audit', async () => {
  for (const amount of [0, -1, 1.5, 10001, '30', null, true]) assert.equal((await grant(amount)).status, 400);
  for (const note of [undefined, '', '  ', 123, 'x'.repeat(201)]) assert.equal((await call('/u1/credits', { amount: 30, note })).status, 400);
  assert.equal(balance(), 0); assert.equal(audit().length, 0);
  assert.equal((await grant(10000)).status, 200);
});

test('new package tops up; active same-package renewal extends without extra credits; switch starts now', async () => {
  const t = Math.floor(Date.now() / 1000);
  assert.equal((await pack()).status, 200); assert.equal(balance(), 30);
  const initial = subscription();
  assert.ok(initial.expires_at >= t + MONTH && initial.expires_at <= t + MONTH + 2);
  assert.equal(initial.next_credit_at, initial.expires_at);
  assert.equal(initial.billing_period, 'monthly');
  assert.ok(initial.provider_ref.startsWith('admin:'));
  await pack('starter', 2);
  assert.equal(subscription().expires_at, initial.expires_at + 2 * MONTH);
  assert.equal(subscription().next_credit_at, initial.next_credit_at); assert.equal(balance(), 30);
  await pack('pro', 1); assert.equal(balance(), 80);
  assert.ok(subscription().expires_at <= t + MONTH + 2); assert.equal(subscription().plan_id, 'pro');
  assert.equal(audit()[1].detail.after.credits, audit()[1].detail.before.credits);
  assert.equal(audit()[2].detail.before.planId, 'starter'); assert.equal(audit()[2].detail.after.planId, 'pro');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM receipts').get().n, 0);
});

test('expired/cancelled/null-end packages restart, and a higher balance is never reduced', async () => {
  await pack();
  for (const [status, expiresAt] of [['active', 1], ['cancelled', 9999999999], ['active', null]]) {
    sqlite.prepare("UPDATE subscriptions SET status = ?, expires_at = ? WHERE user_id = 'u1'").run(status, expiresAt);
    sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason) VALUES ('u1', ?, 'grant')").run(-balance());
    await pack(); assert.equal(balance(), 30);
    assert.ok(subscription().expires_at > Date.now() / 1000 + MONTH - 2);
  }
  await grant(200); await pack('pro'); assert.equal(balance(), 230);
});

test('free/missing/non-paid plans and invalid months are rejected', async () => {
  for (const planId of ['free', 'missing']) assert.equal((await pack(planId)).status, 400);
  for (const months of [0, -1, 1.5, 13, '1', null]) assert.equal((await pack('starter', months)).status, 400);
  assert.equal(subscription(), undefined); assert.equal(balance(), 0); assert.equal(audit().length, 0);
});

test('disable atomically removes only this customer sessions; reactivation permits a new real session', async () => {
  const user = await getUser(db, 'u1');
  const request = new Request('https://naka.test/');
  const cookie = (await createSession(request, env, user)).split(';')[0];
  const signed = new Request(request, { headers: { Cookie: cookie } });
  assert.equal((await requireUser(signed, env)).id, 'u1');
  sqlite.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('other', 'u2', 1, 9999999999)").run();
  assert.equal((await call('/u1/status', { status: 'disabled', note: 'ระงับทดสอบ' })).status, 200);
  assert.equal(await getUser(db, 'u1'), null); assert.equal(await requireUser(signed, env), null);
  assert.deepEqual(sqlite.prepare('SELECT id FROM sessions').all().map(r => r.id), ['other']);
  assert.equal(audit()[0].detail.before.sessions, 1); assert.equal(audit()[0].detail.after.sessions, 0);
  await call('/u1/status', { status: 'active', note: 'เปิดใหม่' });
  assert.equal((await getUser(db, 'u1')).id, 'u1'); assert.equal(await requireUser(signed, env), null);
  const freshCookie = (await createSession(request, env, await getUser(db, 'u1'))).split(';')[0];
  assert.equal((await requireUser(new Request(request, { headers: { Cookie: freshCookie } }), env)).id, 'u1');
});

test('audit failure rolls back every mutation, including session revocation', async () => {
  sqlite.exec("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('session1', 'u1', 1, 9999999999); CREATE TRIGGER audit_fail BEFORE INSERT ON admin_audit BEGIN SELECT RAISE(ABORT, 'private database error'); END;");
  for (const response of [await grant(), await pack(), await call('/u1/status', { status: 'disabled', note: 'เหตุผล' })]) {
    assert.equal(response.status, 500); assert.doesNotMatch(await response.text(), /private/);
  }
  assert.equal(balance(), 0); assert.equal(subscription(), undefined); assert.equal(audit().length, 0);
  assert.equal((await getUser(db, 'u1')).id, 'u1'); assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('mutation failure rolls back the audit and all earlier effects', async () => {
  sqlite.exec("CREATE TRIGGER subscription_fail BEFORE INSERT ON subscriptions BEGIN SELECT RAISE(ABORT, 'test'); END;");
  assert.equal((await pack()).status, 500); assert.equal(balance(), 0); assert.equal(audit().length, 0);
  sqlite.exec("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('s1', 'u1', 1, 9999999999); CREATE TRIGGER sessions_fail BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'test'); END;");
  assert.equal((await call('/u1/status', { status: 'disabled', note: 'เหตุผล' })).status, 500);
  assert.equal((await getUser(db, 'u1')).id, 'u1'); assert.equal(audit().length, 0);
});

test('detail includes bounded histories and only safe social fields, even for disabled users', async () => {
  for (let i = 0; i < 55; i++) sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason, note) VALUES ('u1', 1, 'grant', ?)").run(String(i));
  for (let i = 0; i < 25; i++) sqlite.prepare("INSERT INTO payments (id,user_id,plan_id,period,amount_satang,method,status,created_at) VALUES (?,'u1','starter','monthly',39900,'card','successful',?)").run('p' + i, i);
  sqlite.exec("INSERT INTO receipts (id,payment_id,user_id,year,seq,number,issued_at,snapshot) VALUES ('r1','p1','u1',2026,1,'RC2026-000001',100,'{}');");
  await grant();
  const response = await call('/u1'); const text = await response.text(); const data = JSON.parse(text);
  assert.equal(data.ledger.length, 50); assert.equal(data.payments.length, 20); assert.equal(data.payments[0].id, 'p24');
  assert.equal(data.payments[0].amount, 399); assert.equal(data.receipts[0].number, 'RC2026-000001');
  assert.equal(data.audit.length, 1); assert.equal(data.plans.length, 4);
  assert.deepEqual(Object.keys(data.socialAccounts[0]).sort(), ['id', 'name', 'platform', 'status']);
  assert.doesNotMatch(text, /NEVER_RETURN_THIS_SECRET|token_enc|apply_token|qr_image_url/);
  assert.equal((await call('/u2')).status, 200);
});

test('missing customers give 404 on all valid routes without creating anything', async () => {
  assert.equal((await call('/missing')).status, 404);
  assert.equal((await call('/missing/credits', { amount: 1, note: 'เหตุผล' })).status, 404);
  assert.equal((await call('/missing/package', { planId: 'starter', months: 1, note: 'เหตุผล' })).status, 404);
  assert.equal((await call('/missing/status', { status: 'active', note: 'เหตุผล' })).status, 404);
  assert.equal(audit().length, 0);
});

test('auth, methods, origins, invalid JSON and streamed UTF-8 body size fail closed', async () => {
  for (const token of ['', 'Bearer wrong']) assert.equal((await call('', undefined, { headers: { Authorization: token } })).status, 401);
  assert.equal((await call('/u1/credits', { amount: 1, note: 'a' }, { headers: { Origin: 'https://other.test' } })).status, 403);
  assert.equal((await call('/u1', undefined, { method: 'DELETE' })).status, 405);
  assert.equal((await call('/u1/status', { status: 'invented', note: 'a' })).status, 400);
  for (const raw of ['{', '[]', 'null', 'true']) assert.equal((await call('/u1/credits', raw, { raw: true })).status, 400);
  assert.equal((await call('/u1/credits', {}, { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  assert.equal((await call('/u1/credits', {}, { headers: { 'Content-Length': '5000' } })).status, 413);
  assert.equal((await call('/u1/credits', { amount: 1, note: 'ก'.repeat(1500) })).status, 413);
  const url = new URL('https://naka.test/api/admin/customers/u1/credits');
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(' '.repeat(3000))); controller.enqueue(new TextEncoder().encode(' '.repeat(2000))); controller.close(); } });
  const response = await handleAdminCustomers(new Request(url, { method: 'POST', duplex: 'half', body: stream, headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' } }), env, url);
  assert.equal(response.status, 413);
  assert.equal(balance(), 0); assert.equal(audit().length, 0);
  const other = new URL('https://naka.test/api/admin/customers-other');
  assert.equal(await handleAdminCustomers(new Request(other), env, other), null);
});

test('Cloudflare workerd + D1 serializes concurrent grants and renewals with exact audit before/after', { timeout: 60000 }, async () => {
  const { build } = require('esbuild');
  const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
  const bundled = await build({ stdin: { contents: "import {handleAdminCustomers} from './src/admin/customers'; export default {fetch(r,e){return handleAdminCustomers(r,e,new URL(r.url))}};", resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const options = { modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: ['DB'], cf: false, bindings: { ADMIN_TOKEN: TOKEN } };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const runtimeDb = await mf.getD1Database('DB');
    for (const file of migrations) {
      const sql = readFileSync(path.join(root, 'migrations', file), 'utf8').replace(/--[^\r\n]*/g, '');
      for (const statement of sql.split(';').map(s => s.trim()).filter(Boolean)) await runtimeDb.prepare(statement).run();
    }
    await runtimeDb.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('u1','runtime',1)").run();
    const post = (action, data) => mf.dispatchFetch('https://naka.test/api/admin/customers/u1/' + action, { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    const grants = await Promise.all(Array.from({ length: 8 }, () => post('credits', { amount: 5, note: 'พร้อมกัน' })));
    for (const response of grants) assert.equal(response.status, 200, await response.text());
    const grantsAudit = (await runtimeDb.prepare("SELECT detail FROM admin_audit WHERE action = 'credits' ORDER BY rowid").all()).results.map(r => JSON.parse(r.detail));
    assert.deepEqual(grantsAudit.map(a => a.before.credits), [0,5,10,15,20,25,30,35]);
    assert.deepEqual(grantsAudit.map(a => a.after.credits), [5,10,15,20,25,30,35,40]);
    const renewals = await Promise.all(Array.from({ length: 5 }, () => post('package', { planId: 'starter', months: 1, note: 'ต่อพร้อมกัน' })));
    for (const response of renewals) assert.equal(response.status, 200, await response.text());
    const sub = await runtimeDb.prepare("SELECT * FROM subscriptions WHERE user_id='u1'").first();
    const packageAudit = (await runtimeDb.prepare("SELECT detail FROM admin_audit WHERE action='package' ORDER BY rowid").all()).results.map(r => JSON.parse(r.detail));
    assert.equal(sub.expires_at, packageAudit[0].after.expiresAt + 4 * MONTH);
    assert.equal(sub.next_credit_at, packageAudit[0].after.nextCreditAt);
    assert.equal((await runtimeDb.prepare("SELECT SUM(delta) AS n FROM credit_ledger WHERE user_id='u1'").first()).n, 40);
    for (let i = 1; i < 5; i++) assert.deepEqual(packageAudit[i].before, packageAudit[i - 1].after);
  } finally { await mf.dispose(); }
});

// Small DOM harness executes the shipped script; runtime integration above uses real workerd/D1.
function ui(fetcher) {
  class Element {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {}; this.dataset = {}; this.value = ''; this.hidden = false; this.disabled = false; this.className = ''; this.attributes = {}; this.textContent = ''; this.classList = { toggle: (c,on) => { const set = new Set(this.className.split(' ')); on ? set.add(c) : set.delete(c); this.className = [...set].join(' '); } }; }
    append(...nodes) { this.children.push(...nodes); for (const n of nodes) n.parent = this; }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    addEventListener(name, fn) { this.listeners[name] = fn; }
    setAttribute(name, value) { this.attributes[name] = value; }
    focus() { document.activeElement = this; }
    async fire(name) { await this.listeners[name]?.({ preventDefault() {}, submitter: this }); }
  }
  const nodes = new Map(); const $ = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const fields = [new Element('fieldset'), new Element('fieldset'), new Element('fieldset')];
  const document = { getElementById: $, createElement: tag => new Element(tag), querySelectorAll: q => q === '.actions fieldset' ? fields : $('customer-list').children };
  const storage = new Map(), requests = [];
  const fetch = async (url, options) => { requests.push({ url, options }); return fetcher(url, options); };
  vm.runInNewContext(readFileSync(path.join(root, 'public/admin/customers/customers.js'), 'utf8'), {
    document, fetch, sessionStorage: { getItem: k => storage.get(k), setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    Date, Number, Error, encodeURIComponent,
  });
  const settle = async () => { for (let i = 0; i < 15; i++) await new Promise(r => setImmediate(r)); };
  return { $, fields, document, storage, requests, settle };
}
function frontendApi(url, options) {
  const parsed = new URL(url, 'https://naka.test');
  return handleAdminCustomers(new Request(parsed, options), env, parsed);
}
async function signInAndOpen(page) {
  page.$('token').value = TOKEN; await page.$('login-form').fire('submit');
  const row = page.$('customer-list').children[1]; await row.fire('click'); await page.settle();
  assert.equal(page.$('customer-title').textContent, 'ร้านทดสอบ');
}

test('all three UI forms require in-page confirmation, use bearer session storage, and refresh real handler results', async () => {
  const page = ui(frontendApi); await signInAndOpen(page);
  assert.equal(page.storage.get('naka_admin_customers'), TOKEN); assert.equal(page.$('token').value, '');
  page.$('amount').value = '30'; page.$('credits-note').value = 'ทดสอบฟอร์มเครดิต';
  await page.$('credits-form').fire('submit');
  assert.match(page.$('confirm-summary').textContent, /30.*ร้านทดสอบ.*66812345678/);
  assert.equal(balance(), 0); assert.equal(page.fields.every(f => f.disabled), true);
  await page.$('cancel').fire('click'); assert.equal(balance(), 0);
  await page.$('credits-form').fire('submit'); await page.$('confirm').fire('click');
  assert.equal(balance(), 30); assert.equal(audit().length, 1);
  page.$('plan').value = 'pro'; page.$('months').value = '2'; page.$('package-note').value = 'ทดสอบฟอร์มแพ็กเกจ';
  await page.$('package-form').fire('submit'); assert.equal(subscription(), undefined);
  await page.$('confirm').fire('click'); assert.equal(subscription().plan_id, 'pro'); assert.equal(balance(), 80);
  page.$('status').value = 'disabled'; page.$('status-note').value = 'ทดสอบฟอร์มสถานะ';
  await page.$('status-form').fire('submit'); assert.equal((await getUser(db, 'u1')).id, 'u1');
  await page.$('confirm').fire('click'); assert.equal(await getUser(db, 'u1'), null); assert.equal(audit().length, 3);
  assert.equal(page.requests.every(r => r.options.headers.Authorization === 'Bearer ' + TOKEN), true);
  assert.equal(page.requests.some(r => r.url.includes(TOKEN)), false);
  await page.$('logout').fire('click'); assert.equal(page.storage.size, 0); assert.equal(page.$('app').hidden, true);
});

test('401 clears token and hides all customer information', async () => {
  let denied = false;
  const page = ui((url, options) => denied ? Response.json({ error: 'เข้าสู่ระบบใหม่' }, { status: 401 }) : frontendApi(url, options));
  await signInAndOpen(page); denied = true; await page.$('search-form').fire('submit'); await page.settle();
  assert.equal(page.storage.size, 0); assert.equal(page.$('app').hidden, true); assert.equal(page.$('login').hidden, false);
});

test('rapid confirmation clicks send once; an ambiguous network result requires reloading rather than a blind retry', async () => {
  let release;
  const page = ui(async (url, options) => {
    if (options.method === 'POST') { await new Promise(resolve => { release = resolve; }); throw new Error('network'); }
    return frontendApi(url, options);
  });
  await signInAndOpen(page);
  page.$('amount').value = '30'; page.$('credits-note').value = 'ทดสอบ'; await page.$('credits-form').fire('submit');
  const first = page.$('confirm').fire('click'); await page.$('confirm').fire('click');
  assert.equal(page.requests.filter(r => r.options.method === 'POST').length, 1);
  release(); await first;
  assert.equal(page.$('detail').hidden, true); assert.equal(page.$('confirmation').hidden, true); assert.equal(page.$('reload-detail').hidden, false);
  assert.match(page.$('detail-status').textContent, /ตรวจบันทึก/);
});
