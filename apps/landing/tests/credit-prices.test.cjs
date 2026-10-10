// Credit prices (migrations/pg/0006_credit_prices.sql, src/credit-prices.ts, docs/credit-pricing.md):
// seeded defaults, the rounding rule, the admin API in /api/admin/system/prices, and the landing jobs reading them.
const assert = require('node:assert/strict');
const { test, beforeEach, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `credit-prices-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const { handleAdminSystem } = require(path.join(buildDir, 'system/admin.js'));
const { creditsFor, priceOf, listPrices } = require(path.join(buildDir, 'credit-prices.js'));
const { aiVideoCredits } = require(path.join(buildDir, 'video/index.js'));
after(() => rmSync(buildDir, { recursive: true, force: true }));

const TOKEN = 'test-only-admin-token';
let sqlite, db, env;
beforeEach(() => { ({ sqlite, db } = migratedDb()); env = { DB: db, ADMIN_TOKEN: TOKEN }; });

function call(route, data) {
  const url = new URL('https://naka.test/api/admin/system' + route);
  return handleAdminSystem(new Request(url, { method: data === undefined ? 'GET' : 'PUT',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), env, url);
}

test('seeded prices: studio videos 5 per clip, studio images free, the landing keeps what it charged', async () => {
  const prices = Object.fromEntries((await listPrices(db)).map(p => [p.key, p]));
  assert.deepEqual(Object.keys(prices), ['studio.video', 'studio.image', 'landing.ai_video', 'landing.clips', 'landing.marketer']);
  assert.equal(prices['studio.video'].credits, 5);
  assert.equal(prices['studio.video'].perSecond, false);
  assert.equal(prices['studio.video'].allowPerSecond, true);
  assert.equal(prices['studio.image'].credits, 0);
  assert.equal(prices['landing.ai_video'].credits, 5);
  assert.equal(prices['landing.clips'].credits, 1);
  assert.equal(prices['landing.marketer'].credits, 1);
  assert.equal(await priceOf(db, 'landing.clips', 99), 1);
  assert.equal(await aiVideoCredits(env), 5);
});

test('creditsFor rounds up to whole credits; per second uses the seconds (at least 1)', () => {
  assert.equal(creditsFor({ credits: 5, perSecond: false }, 30), 5);
  assert.equal(creditsFor({ credits: 0, perSecond: false }), 0);
  assert.equal(creditsFor({ credits: 0.5, perSecond: true }, 10), 5);
  assert.equal(creditsFor({ credits: 0.5, perSecond: true }, 5), 3, '2.5 → 3');
  assert.equal(creditsFor({ credits: 0.1, perSecond: true }, 30), 3, 'no float creep: 0.1 × 30 is 3');
  assert.equal(creditsFor({ credits: 0.4, perSecond: true }, 0), 1, 'unknown length counts as 1 second');
  assert.equal(creditsFor({ credits: 0, perSecond: true }, 60), 0);
});

test('admin sets a price with a reason: audited in system_audit (area price), read by the next job', async () => {
  const res = await call('/prices/landing.ai_video', { credits: 8, note: 'ต้นทุนผู้ให้บริการขึ้นราคา' });
  assert.equal(res.status, 200);
  const { prices } = await res.json();
  const video = prices.find(p => p.key === 'landing.ai_video');
  assert.equal(video.credits, 8);
  assert.equal(video.actor, 'โทเคนฉุกเฉิน');
  assert.ok(video.updatedAt > 0);
  assert.equal(await aiVideoCredits(env), 8);

  const [audit] = sqlite.prepare("SELECT target, action, detail, note, actor FROM system_audit WHERE area = 'price'").all();
  assert.equal(audit.target, 'landing.ai_video');
  assert.equal(audit.action, 'update');
  assert.deepEqual(JSON.parse(audit.detail), { before: { credits: 5, perSecond: false }, after: { credits: 8, perSecond: false } });
  assert.equal(audit.note, 'ต้นทุนผู้ให้บริการขึ้นราคา');

  const listed = await (await call('/prices')).json();
  assert.equal(listed.prices.length, 5);
});

test('studio videos can be priced per second; other rows cannot; decimals only per second', async () => {
  const ok = await call('/prices/studio.video', { credits: 0.5, perSecond: true, note: 'คิดตามความยาว' });
  assert.equal(ok.status, 200);
  const row = sqlite.prepare("SELECT credits, per_second FROM credit_prices WHERE key = 'studio.video'").get();
  assert.equal(Number(row.credits), 0.5);
  assert.ok(row.per_second === true || row.per_second === 1);

  const cases = [
    ['/prices/studio.image', { credits: 1, perSecond: true }, /คิดต่อวินาทีไม่ได้/],
    ['/prices/landing.clips', { credits: 1.5 }, /จำนวนเต็ม/],
    ['/prices/landing.clips', { credits: -1 }, /0 ถึง 1000/],
    ['/prices/landing.clips', { credits: 1001 }, /0 ถึง 1000/],
    ['/prices/landing.clips', { credits: 0.123, perSecond: false }, /ทศนิยมได้ 2 ตำแหน่ง/],
    ['/prices/landing.clips', { credits: '3' }, /เครดิตต้องเป็นตัวเลข/],
    ['/prices/landing.clips', { credits: 2, note: 'x'.repeat(201) }, /หมายเหตุ/],
  ];
  for (const [route, data, error] of cases) {
    const res = await call(route, data);
    assert.equal(res.status, 400, JSON.stringify(data));
    assert.match((await res.json()).error, error);
  }
  assert.equal((await call('/prices/no.such', { credits: 1 })).status, 404);
  assert.equal(await priceOf(db, 'landing.clips', 99), 1, 'refused changes wrote nothing');
});

test('free (0) is allowed and a free job holds nothing', async () => {
  assert.equal((await call('/prices/landing.clips', { credits: 0, note: 'แจกฟรีช่วงเปิดตัว' })).status, 200);
  assert.equal(await priceOf(db, 'landing.clips', 99), 0);
});

test('the migration carries a saved AI_VIDEO_CREDITS setting over and removes it', () => {
  const sql = readFileSync(path.join(root, 'migrations/pg/0006_credit_prices.sql'), 'utf8');
  assert.match(sql, /UPDATE credit_prices SET credits = s\.value::numeric[\s\S]+s\.key = 'AI_VIDEO_CREDITS'/);
  assert.match(sql, /DELETE FROM system_settings WHERE key = 'AI_VIDEO_CREDITS'/);
  assert.match(sql, /GRANT SELECT ON credit_prices TO studio_app/);
  const registry = readFileSync(path.join(root, 'src/system/registry.ts'), 'utf8');
  assert.doesNotMatch(registry, /AI_VIDEO_CREDITS/, 'one place to set the price');
});
