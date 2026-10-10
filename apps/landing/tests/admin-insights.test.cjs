// /api/admin/overview, /api/admin/payments(.csv) and /api/admin/jobs (src/admin/insights.ts): the back office's
// read-only views across every customer. Thailand days (UTC+7) decide "today" and "this month".
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `admin-insights-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const { bangkokDay, bangkokMonth, csvCell } = require(path.join(buildDir, 'admin/insights.js'));

const TOKEN = 'test-only-admin-token';
const STUDIO_TOKEN = 'studio-admin-token-0123456789';
const DAY = 86400;
let sqlite, db, env;
const t = () => Math.floor(Date.now() / 1000);
const utc = (s) => new Date(s * 1000).toISOString().slice(0, 19).replace('T', ' ');

beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 's'.repeat(40), ASSETS: { fetch: async () => new Response('asset') } };
});
afterEach(() => { mock.restoreAll(); sqlite.close(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const site = (pathname, init = {}, e = env) => worker.fetch(new Request('https://naka.test' + pathname, {
  ...init, headers: { Authorization: 'Bearer ' + TOKEN, ...(init.headers || {}) } }), e, { waitUntil() {} });
const get = async (pathname) => { const r = await site(pathname); assert.equal(r.status, 200, pathname); return r.json(); };
function user(id, name, createdAt, extra = {}) {
  sqlite.prepare('INSERT INTO users (id, display_name, created_at, status) VALUES (?, ?, ?, ?)').run(id, name, createdAt, extra.status || 'active');
  if (extra.email) sqlite.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES (?, ?, 'google', ?, ?, 1)").run('g-' + id, id, 'sub-' + id, extra.email);
  if (extra.phone) sqlite.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_uid, verified_at) VALUES (?, ?, 'phone', ?, 1)").run('p-' + id, id, extra.phone);
}
function payment(id, userId, satang, status, createdAt, extra = {}) {
  sqlite.prepare(`INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at, expires_at, failure)
    VALUES (?, ?, ?, 'monthly', ?, ?, ?, ?, ?, ?, ?)`).run(id, userId, extra.plan || 'starter', satang, extra.method || 'promptpay', status, createdAt,
    extra.paidAt === undefined ? (status === 'successful' ? createdAt : null) : extra.paidAt, extra.expiresAt ?? null, extra.failure ?? null);
}
function fakeStudio(reply) {
  const calls = [];
  mock.method(globalThis, 'fetch', async (input, init = {}) => { calls.push(String(input)); return reply(String(input), init); });
  return calls;
}
const studioJson = (data, status = 200) => new Response(JSON.stringify({ code: status, data }), { status, headers: { 'Content-Type': 'application/json' } });

test('Thailand days and months: midnight in Bangkok is 17:00 UTC the day before', () => {
  const noonBkk = Date.UTC(2026, 9, 10, 5, 0, 0) / 1000; // 12:00 in Bangkok, 10 Oct 2026
  assert.equal(bangkokDay(noonBkk), Date.UTC(2026, 9, 9, 17) / 1000);
  assert.equal(bangkokDay(Date.UTC(2026, 9, 9, 17, 30) / 1000), Date.UTC(2026, 9, 9, 17) / 1000, '00:30 Bangkok is already the 10th');
  assert.equal(bangkokMonth(noonBkk), Date.UTC(2026, 8, 30, 17) / 1000);
  assert.equal(bangkokMonth(noonBkk, -1), Date.UTC(2026, 7, 31, 17) / 1000);
  assert.equal(bangkokMonth(Date.UTC(2026, 0, 15) / 1000, -1), Date.UTC(2025, 10, 30, 17) / 1000, 'across a year');
});

test('admins only, GET only', async () => {
  const anonymous = await worker.fetch(new Request('https://naka.test/api/admin/overview'), env, { waitUntil() {} });
  assert.equal(anonymous.status, 401);
  for (const route of ['/api/admin/overview', '/api/admin/payments', '/api/admin/payments.csv', '/api/admin/jobs']) {
    assert.equal((await site(route, { headers: { Authorization: 'Bearer wrong' } })).status, 401, route);
    const posted = await site(route, { method: 'POST', headers: { Origin: 'https://naka.test' } });
    assert.equal(posted.status, 405, route); assert.equal(posted.headers.get('allow'), 'GET');
  }
});

test('overview: customers, revenue by the day paid, packages in force, credits, queues and a 14-day chart', async () => {
  const now = t(), today = bangkokDay(now), month = bangkokMonth(now), lastMonth = bangkokMonth(now, -1);
  user('new', 'วันนี้', now);
  user('week', 'สัปดาห์นี้', today - 3 * DAY);
  user('old', 'นานแล้ว', lastMonth - 10 * DAY, { status: 'disabled' });
  payment('pay-today', 'new', 39900, 'successful', now);
  payment('pay-last', 'week', 79000, 'successful', lastMonth + 100);
  payment('pay-older', 'week', 12300, 'successful', lastMonth - 100);
  payment('pay-pending', 'new', 39900, 'pending', now, { expiresAt: now + 600 });
  payment('pay-stale', 'new', 39900, 'pending', now - 7200, { expiresAt: now - 3600 }); // not paid in time: not waiting any more
  payment('pay-failed', 'new', 39900, 'failed', now - DAY);
  sqlite.exec(`INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES ('new', 'starter', 'active', ${now + 30 * DAY}),
    ('week', 'pro', 'active', ${now - 10}), ('old', 'starter', 'cancelled', NULL)`);
  sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason, job_id, created_at) VALUES ('new', 30, 'grant', NULL, ?), ('new', -5, 'job_hold', 'j1', ?), ('new', 5, 'job_refund', 'j1', ?), ('new', -3, 'job_hold', 'j2', ?), ('new', -7, 'studio_hold', 'studio:1', ?), ('new', -50, 'job_hold', 'old', ?)")
    .run(utc(now), utc(now), utc(now), utc(now), utc(now), utc(lastMonth));
  sqlite.prepare("INSERT INTO jobs (id, user_id, kind, status, cost_credits, updated_at) VALUES ('q1', 'new', 'ai_video', 'queued', 1, ?), ('r1', 'new', 'ai_video', 'running', 1, ?), ('f1', 'new', 'ai_video', 'failed', 1, ?), ('f-old', 'new', 'ai_video', 'failed', 1, ?)")
    .run(utc(now), utc(now), utc(now - 3600), utc(now - 3 * DAY));

  const o = await get('/api/admin/overview');
  assert.equal(o.customers.total, 3); assert.equal(o.customers.today, 1); assert.equal(o.customers.week, 2); assert.equal(o.customers.disabled, 1);
  assert.equal(o.customers.month, (today - 3 * DAY >= month) ? 2 : 1);
  assert.equal(o.revenue.today, 399); assert.equal(o.revenue.month, 399); assert.equal(o.revenue.monthCount, 1); assert.equal(o.revenue.lastMonth, 790);
  assert.deepEqual(o.payments, { pending: 1, failed7d: 1 });
  const members = Object.fromEntries(o.plans.map(p => [p.id, p.members]));
  assert.deepEqual(members, { starter: 1, pro: 0, business: 0, max: 0 }, 'an expired or cancelled package is not counted; free is not a package');
  assert.deepEqual(o.credits, { usedLanding: 3, usedStudio: 7, granted: 30 }, 'refunds are given back; last month is left out');
  assert.deepEqual(o.jobs, { queued: 1, running: 1, failed24h: 1 });
  assert.equal(o.studio.ok, false); assert.match(o.studio.error, /ยังไม่ได้เชื่อมต่อ naka-studio/);
  assert.equal(o.daily.length, 14);
  const last = o.daily[13];
  assert.equal(last.signups, 1); assert.equal(last.revenue, 399);
  assert.equal(o.daily.reduce((n, d) => n + d.signups, 0), 2);
});

test('overview: naka-studio queue totals summed over providers, read with a short timeout', async () => {
  const calls = fakeStudio(() => studioJson({ version: '1.2.3', videoQueues: [
    { queued: 2, running: 1, unknown: 1, completed24h: 5, failed24h: 2 }, { queued: 1, running: 0, unknown: 0, completed24h: 1, failed24h: 0 }] }));
  const e = { ...env, STUDIO_INTERNAL_URL: 'http://studio:5679', STUDIO_ADMIN_TOKEN: STUDIO_TOKEN };
  const o = await (await site('/api/admin/overview', {}, e)).json();
  assert.deepEqual(o.studio, { ok: true, version: '1.2.3', providers: 2, queued: 3, running: 1, unknown: 1, completed24h: 6, failed24h: 2 });
  assert.deepEqual(calls, ['http://studio:5679/api/v1/system/overview']);
  assert.ok(!JSON.stringify(o).includes(STUDIO_TOKEN));
});

test('payments: every customer, newest first, filters, totals and paging that never repeats or skips', async () => {
  const now = t();
  user('a', 'ร้านเอ', 1, { email: 'shop-a@example.test', phone: '+66811111111' });
  user('b', 'Shop B', 1);
  payment('pa1', 'a', 39900, 'successful', now - 100, { method: 'stripe_checkout' });
  payment('pa2', 'a', 79000, 'failed', now - 200, { failure: 'card_declined' });
  payment('pb1', 'b', 12900, 'successful', now - 300);
  sqlite.prepare("INSERT INTO receipts (id, payment_id, user_id, year, seq, number, issued_at, snapshot) VALUES ('r1', 'pa1', 'a', 2026, 1, 'NK-2026-000001', ?, '{}')").run(now);

  const all = await get('/api/admin/payments');
  assert.deepEqual(all.payments.map(p => p.id), ['pa1', 'pa2', 'pb1']);
  assert.deepEqual(all.totals, { count: 3, successful: 2, successfulAmount: 528 });
  assert.equal(all.nextCursor, null);
  const first = all.payments[0];
  assert.deepEqual([first.name, first.email, first.phone, first.planName, first.amount, first.receipt], ['ร้านเอ', 'shop-a@example.test', '+66811111111', 'เริ่มต้น', 399, 'NK-2026-000001']);

  const ids = async (query) => (await get('/api/admin/payments?' + query)).payments.map(p => p.id);
  assert.deepEqual(await ids('status=failed'), ['pa2']);
  assert.deepEqual(await ids('method=stripe_checkout'), ['pa1']);
  for (const q of ['SHOP-A@example.test', '0811111111', 'ร้านเอ']) assert.deepEqual(await ids('q=' + encodeURIComponent(q)), ['pa1', 'pa2'], q);
  assert.deepEqual(await ids('q=pa2'), ['pa2'], 'by payment id');
  assert.deepEqual(await ids('q=' + encodeURIComponent('Shop B')), ['pb1']);
  assert.deepEqual(await ids('q=%25'), [], 'a wildcard matches literally');
  const day = new Date((now + 7 * 3600) * 1000).toISOString().slice(0, 10);
  assert.equal((await ids(`from=${day}&to=${day}`)).length, 3);
  assert.deepEqual(await ids('to=2000-01-01'), []);

  for (const bad of ['status=paid', 'method=cash', 'from=2026-02-30', 'from=10/10/2026', 'from=2026-10-10&to=2026-10-09', 'cursor=x', 'q=' + 'a'.repeat(201)]) {
    assert.equal((await site('/api/admin/payments?' + bad)).status, 400, bad);
  }

  for (let i = 0; i < 52; i++) payment(`bulk${String(i).padStart(2, '0')}`, 'b', 1000, 'pending', now - 1000, { expiresAt: now + 60 }); // same second: ids break the tie
  const page1 = await get('/api/admin/payments');
  assert.equal(page1.payments.length, 50); assert.ok(page1.nextCursor);
  const page2 = await get('/api/admin/payments?cursor=' + encodeURIComponent(page1.nextCursor));
  assert.equal(page2.nextCursor, null);
  const seen = [...page1.payments, ...page2.payments].map(p => p.id);
  assert.equal(seen.length, 55); assert.equal(new Set(seen).size, 55);
  assert.equal(page2.totals.count, 55, 'totals ignore the page');
});

test('payments CSV: Excel-ready Thai, the same filter, and cells that cannot run as formulas', async () => {
  const now = t();
  user('a', '=HYPERLINK("http://evil.test","คลิก")', 1, { email: 'a@example.test' });
  payment('pa1', 'a', 39900, 'successful', now - 100);
  payment('pa2', 'a', 79000, 'failed', now - 200, { failure: 'ธนาคาร, ปฏิเสธ' });
  const response = await site('/api/admin/payments.csv?status=failed');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/csv; charset=utf-8/);
  assert.match(response.headers.get('content-disposition'), /^attachment; filename="naka-ai-payments-\d{4}-\d{2}-\d{2}\.csv"$/);
  const bytes = new Uint8Array(await response.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM');
  const lines = new TextDecoder().decode(bytes).replace(/^﻿/, '').trimEnd().split('\r\n');
  assert.equal(lines.length, 2, 'header + the one failed payment');
  assert.ok(lines[0].startsWith('วันที่สร้าง (เวลาไทย),'));
  assert.ok(lines[1].includes(`"'=HYPERLINK(""http://evil.test"",""คลิก"")"`), 'formula neutralised and quoted');
  assert.ok(lines[1].includes(',790.00,'));
  assert.ok(lines[1].endsWith(',"ธนาคาร, ปฏิเสธ"'));
  assert.ok(lines[1].includes(',ไม่สำเร็จ,'));
  for (const [input, out] of [['+1', "'+1"], ['-cmd', "'-cmd"], ['@SUM(A1)', "'@SUM(A1)"], ['\tx', "'\tx"], ['ok', 'ok'], [-12.5, '-12.5'], [null, '']]) {
    assert.equal(csvCell(input), out, JSON.stringify(input));
  }
  assert.equal((await site('/api/admin/payments.csv?from=nope')).status, 400);
});

test('failed jobs: landing jobs with refund state, naka-studio tasks named by customer, and a studio outage', async () => {
  const now = t();
  user('a', 'ร้านเอ', 1);
  sqlite.prepare(`INSERT INTO jobs (id, user_id, kind, status, cost_credits, attempts, error, created_at, updated_at) VALUES
    ('jf1', 'a', 'ai_video', 'failed', 5, 3, ?, ?, ?), ('jf2', 'a', 'affiliate_review', 'failed', 2, 1, 'boom', ?, ?),
    ('jold', 'a', 'ai_video', 'failed', 5, 3, 'old', ?, ?), ('jok', 'a', 'ai_video', 'done', 5, 1, NULL, ?, ?)`)
    .run('x'.repeat(400), utc(now - 600), utc(now - 60), utc(now - 600), utc(now - 120), utc(now - 9 * DAY), utc(now - 9 * DAY), utc(now), utc(now));
  sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason, job_id) VALUES ('a', -5, 'job_hold', 'jf1'), ('a', 5, 'job_refund', 'jf1'), ('a', -2, 'job_hold', 'jf2')").run();
  sqlite.prepare(`INSERT INTO ai_videos (id, user_id, job_id, kind, provider, prompt, input, status, cost_credits, created_at, updated_at)
    VALUES ('v1', 'a', 'jf1', 'product', 'seedance', 'p', '{}', 'failed', 5, ?, ?)`).run(now, now);

  const calls = fakeStudio((url) => studioJson({ days: 7, total: 2, tasks: [
    { id: 11, type: 'video', ownerUserId: 'a', error: 'provider said no' }, { id: 12, type: 'image', ownerUserId: 'ghost', error: null }] }));
  const e = { ...env, STUDIO_INTERNAL_URL: 'http://studio:5679', STUDIO_ADMIN_TOKEN: STUDIO_TOKEN };
  const r = await (await site('/api/admin/jobs', {}, e)).json();
  assert.equal(r.days, 7);
  assert.equal(r.landing.total, 2);
  assert.deepEqual(r.landing.jobs.map(j => [j.id, j.refunded]), [['jf1', true], ['jf2', false]]);
  assert.equal(r.landing.jobs[0].error.length, 300);
  assert.equal(r.landing.jobs[0].videoProvider, 'seedance');
  assert.equal(r.landing.jobs[0].name, 'ร้านเอ');
  assert.deepEqual(calls, ['http://studio:5679/api/v1/system/failed-tasks?days=7']);
  assert.equal(r.studio.ok, true);
  assert.deepEqual(r.studio.tasks.map(task => [task.id, task.customerName, task.customerKnown]), [[11, 'ร้านเอ', true], [12, null, false]]);

  assert.equal((await (await site('/api/admin/jobs?days=30', {}, e)).json()).landing.total, 3);
  assert.equal((await (await site('/api/admin/jobs?days=500', {}, e)).json()).days, 30);

  // an older studio answers unknown API paths with its HTML app (200): that is "could not ask", not "nothing failed"
  mock.restoreAll();
  fakeStudio(() => new Response('<!DOCTYPE html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }));
  const old = await (await site('/api/admin/jobs', {}, e)).json();
  assert.equal(old.studio.ok, false); assert.match(old.studio.error, /อัปเดต studio/);
  const oldOverview = await (await site('/api/admin/overview', {}, e)).json();
  assert.equal(oldOverview.studio.ok, false);

  mock.restoreAll();
  fakeStudio(() => { throw new TypeError('fetch failed'); });
  const down = await (await site('/api/admin/jobs', {}, e)).json();
  assert.equal(down.landing.total, 2, 'the landing list does not depend on the studio');
  assert.equal(down.studio.ok, false); assert.match(down.studio.error, /เชื่อมต่อ naka-studio ไม่ได้/);
});
