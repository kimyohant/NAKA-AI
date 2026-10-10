// GET /api/me/credits — the member dashboard's balance, package and credit history (src/me/credits.ts).
const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `member-credits-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir,
], { cwd: root, stdio: 'inherit' });
const { handleMemberCredits, describeEntry } = require(path.join(buildDir, 'me', 'credits.js'));
after(() => rmSync(buildDir, { recursive: true, force: true }));

let sqlite;
let db;
beforeEach(() => ({ sqlite, db } = migratedDb()));

const nowSec = () => Math.floor(Date.now() / 1000);
function ledger(delta, reason, { userId = 'u1', note = '', jobId = null, at = '2026-10-01 09:00:00' } = {}) {
  sqlite.prepare('INSERT INTO credit_ledger (user_id, delta, reason, job_id, note, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, delta, reason, jobId, note, at);
}
function job(id, kind, userId = 'u1') {
  sqlite.prepare(`INSERT INTO jobs (id, user_id, kind, status, input, cost_credits) VALUES (?, ?, ?, 'done', '{"productName":"secret input"}', 5)`)
    .run(id, userId, kind);
}
function subscribe({ userId = 'u1', plan = 'pro', period = 'monthly', expiresAt = nowSec() + 20 * 86400, nextCreditAt = nowSec() + 5 * 86400, status = 'active' } = {}) {
  sqlite.prepare(`INSERT INTO subscriptions (user_id, plan_id, status, billing_period, expires_at, next_credit_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(userId, plan, status, period, expiresAt, nextCreditAt);
}
async function call(pathname = '/api/me/credits', { method = 'GET', userId = 'u1' } = {}) {
  const url = new URL(pathname, 'https://naka.test');
  return handleMemberCredits(new Request(url, { method }), { DB: db }, url, userId);
}

test('only the signed-in member’s rows, newest first, in member words; admin notes and job inputs stay private', async () => {
  ledger(10, 'grant', { note: 'signup_bonus', at: '2026-10-01 08:00:00' });
  ledger(80, 'purchase', { note: 'แพ็กเกจ pro', at: '2026-10-01 09:00:00' });
  job('j1', 'affiliate_review');
  ledger(-5, 'job_hold', { jobId: 'j1', at: '2026-10-02 10:00:00' });
  ledger(5, 'job_refund', { jobId: 'j1', at: '2026-10-02 10:05:00' });
  ledger(-3, 'studio_hold', { jobId: 'studio-task-77', at: '2026-10-03 11:00:00' });
  ledger(20, 'grant', { note: 'ชดเชยลูกค้าร้องเรียนเรื่องคลิปเสีย (ภายใน)', at: '2026-10-04 12:00:00' });
  ledger(999, 'grant', { userId: 'u2', note: 'someone else' });

  assert.equal(await call('/api/works'), null);
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json();
  assert.equal(body.balance, 107);
  assert.equal(body.plan, null);
  assert.equal(body.next, null);
  assert.deepEqual(body.entries.map(e => [e.delta, e.kind, e.title]), [
    [20, 'team', 'ทีมงานเพิ่มเครดิตให้'],
    [-3, 'studio', 'ใช้งานใน Naka Studio'],
    [5, 'refund', 'คืนเครดิต: คลิปรีวิวสินค้า ไม่สำเร็จ'],
    [-5, 'job', 'คลิปรีวิวสินค้า'],
    [80, 'package', 'เติมเครดิตจากการซื้อแพ็กเกจ'],
    [10, 'welcome', 'เครดิตต้อนรับสมาชิกใหม่'],
  ]);
  assert.equal(body.entries[0].createdAt, '2026-10-04 12:00:00');
  const raw = JSON.stringify(body);
  for (const secret of ['ภายใน', 'studio-task-77', 'secret input', 'someone else', 'j1']) assert.ok(!raw.includes(secret), secret);
});

test('pages with a cursor of ledger ids; bad cursors and methods are refused in Thai', async () => {
  for (let i = 1; i <= 12; i++) ledger(-1, 'studio_hold', { at: `2026-10-01 09:${String(i).padStart(2, '0')}:00` });
  const first = await (await call('/api/me/credits?limit=5')).json();
  assert.equal(first.entries.length, 5);
  assert.ok(first.next);
  const second = await (await call(`/api/me/credits?limit=5&before=${first.next}`)).json();
  assert.equal(second.entries.length, 5);
  assert.ok(second.entries.every(e => e.id < first.next));
  const third = await (await call(`/api/me/credits?limit=5&before=${second.next}`)).json();
  assert.equal(third.entries.length, 2);
  assert.equal(third.next, null);
  assert.equal((await (await call('/api/me/credits?limit=500')).json()).entries.length, 12, 'capped at 50, all 12 fit');
  assert.equal((await (await call('/api/me/credits?limit=abc')).json()).entries.length, 10, 'default 10');

  for (const bad of ['before=abc', 'before=-1', 'before=1e5']) {
    const r = await call(`/api/me/credits?${bad}`);
    assert.equal(r.status, 400, bad);
    assert.match((await r.json()).error, /[ก-๙]/);
  }
  const post = await call('/api/me/credits', { method: 'POST' });
  assert.equal(post.status, 405);
});

test('active package: name, period, expiry and the next monthly credits (not promised past expiry)', async () => {
  const expiresAt = nowSec() + 20 * 86400;
  const nextCreditAt = nowSec() + 5 * 86400;
  subscribe({ expiresAt, nextCreditAt });
  assert.deepEqual((await (await call()).json()).plan, { name: 'โปร', period: 'monthly', expiresAt, nextCreditAt });

  sqlite.prepare('UPDATE subscriptions SET next_credit_at = ? WHERE user_id = ?').run(expiresAt + 86400, 'u1');
  assert.equal((await (await call()).json()).plan.nextCreditAt, null);

  // expired but not yet closed by the cron → no package, like /api/billing/me
  sqlite.prepare('UPDATE subscriptions SET expires_at = ? WHERE user_id = ?').run(nowSec() - 10, 'u1');
  assert.equal((await (await call()).json()).plan, null);
  sqlite.prepare("UPDATE subscriptions SET status = 'cancelled', expires_at = ? WHERE user_id = ?").run(expiresAt, 'u1');
  assert.equal((await (await call()).json()).plan, null);
});

test('describeEntry covers every ledger reason', () => {
  assert.deepEqual(describeEntry({ reason: 'grant', note: 'x', delta: -4, job_kind: null }), { kind: 'team', title: 'ทีมงานปรับลดเครดิต' });
  assert.deepEqual(describeEntry({ reason: 'purchase', note: 'เครดิตประจำเดือน', delta: 50, job_kind: null }), { kind: 'monthly', title: 'เครดิตประจำเดือนตามแพ็กเกจ' });
  assert.equal(describeEntry({ reason: 'job_hold', note: '', delta: -2, job_kind: 'ai_video' }).title, 'วิดีโอ AI');
  assert.equal(describeEntry({ reason: 'job_hold', note: '', delta: -2, job_kind: 'marketer_brief' }).title, 'นักการตลาด AI');
  assert.equal(describeEntry({ reason: 'job_hold', note: '', delta: -2, job_kind: null }).title, 'งาน AI');
  assert.deepEqual(describeEntry({ reason: 'studio_refund', note: '', delta: 3, job_kind: null }).kind, 'studio_refund');
});
