// Member features (docs/entitlements.md): plan defaults, admin overrides, monthly quotas, system-wide
// switches, the admin APIs that change them, and the routes that enforce them.
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `entitlements-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const ent = require(path.join(buildDir, 'entitlements.js'));
const { handleAdminCustomers } = require(path.join(buildDir, 'admin/customers.js'));
const { handleAdminSystem } = require(path.join(buildDir, 'system/admin.js'));
const affiliate = require(path.join(buildDir, 'affiliate.js'));
const worker = require(path.join(buildDir, 'index.js')).default;

const TOKEN = 'test-only-admin-token';
const ORIGIN = 'https://naka.test';
const FUTURE = 4102444800;
let sqlite, db, env;
mock.method(globalThis, 'fetch', async () => { throw new Error('no external requests in entitlement tests'); });
beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40), ASSETS: { fetch: async () => new Response('asset') } };
  sqlite.exec(`INSERT INTO users (id, display_name, created_at, status) VALUES
    ('free1', 'ฟรี', 1, 'active'), ('pro1', 'โปร', 1, 'active'), ('off1', 'ระงับ', 1, 'disabled');
    INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES ('pro1', 'pro', 'active', ${FUTURE}), ('off1', 'max', 'active', ${FUTURE});`);
});
afterEach(() => sqlite.close());
after(() => { mock.restoreAll(); assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const enabled = async user => (await ent.memberFeatures(env, user)).filter(f => f.enabled).map(f => f.key);
const feature = async (user, key) => (await ent.memberFeatures(env, user)).find(f => f.key === key);
function admin(base, handler) {
  return (route, data, method) => {
    const url = new URL(ORIGIN + base + route);
    return handler(new Request(url, { method: method || (data === undefined ? 'GET' : 'POST'),
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json', Origin: ORIGIN },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), env, url);
  };
}
const customers = admin('/api/admin/customers', handleAdminCustomers);
const system = admin('/api/admin/system', handleAdminSystem);

test('a member gets what the current plan includes; an expired subscription falls back to free; a disabled member gets nothing', async () => {
  assert.deepEqual(await enabled('free1'), ['landing.clips', 'landing.marketer']);
  const pro = await enabled('pro1');
  assert.ok(pro.includes('landing.inbox') && pro.includes('studio.viral_clone') && !pro.includes('studio.live'));
  // studio Social Auto Reply (0005) follows the site's own social posting: every paid plan, not free
  assert.ok(pro.includes('studio.social'));
  assert.equal((await feature('pro1', 'landing.ai_video')).monthlyLimit, 30);
  assert.equal((await feature('pro1', 'landing.social')).monthlyLimit, null, 'features without a quota never report a limit');
  sqlite.prepare("UPDATE subscriptions SET expires_at = 1 WHERE user_id = 'pro1'").run();
  assert.deepEqual(await enabled('pro1'), ['landing.clips', 'landing.marketer']);
  assert.deepEqual(await enabled('off1'), [], 'disabled account, even on the max plan');
  assert.deepEqual(await enabled('nobody'), []);
});

test('quota: counted per use, refused at the limit without counting, given back by release; concurrent uses never pass the limit', async () => {
  const uses = [];
  for (let i = 0; i < 4; i++) uses.push(await ent.useFeature(env, 'free1', 'landing.clips'));
  assert.deepEqual(uses.map(u => u.ok), [true, true, true, false]);
  assert.deepEqual({ reason: uses[3].reason, used: uses[3].used, limit: uses[3].monthlyLimit }, { reason: 'quota', used: 3, limit: 3 });
  await ent.releaseFeature(env, 'free1', 'landing.clips', 1, uses[0].period);
  assert.equal((await feature('free1', 'landing.clips')).used, 2);
  const race = await Promise.all(Array.from({ length: 6 }, () => ent.useFeature(env, 'free1', 'landing.clips')));
  assert.equal(race.filter(u => u.ok).length, 1, 'one unit left, six requests at once');
  assert.equal((await feature('free1', 'landing.clips')).used, 3);
  assert.equal((await ent.useFeature(env, 'free1', 'landing.ai_video')).reason, 'disabled', 'not in the free plan');
  const unlimited = await ent.useFeature(env, 'pro1', 'landing.marketer', 2);
  assert.deepEqual({ ok: unlimited.ok, used: unlimited.used, limit: unlimited.monthlyLimit }, { ok: true, used: 2, limit: null }, 'unlimited still counts');
});

test('a system-wide switch closes a landing feature whatever the plan says, and is never counted', async () => {
  env.FEATURE_CLIPS = 'off';
  const clips = await feature('pro1', 'landing.clips');
  assert.deepEqual({ enabled: clips.enabled, source: clips.source }, { enabled: false, source: 'system' });
  assert.equal(await ent.hasFeature(env, 'pro1', 'landing.clips'), false);
  assert.equal((await ent.useFeature(env, 'pro1', 'landing.clips')).ok, false);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM feature_usage').get().n, 0);
  assert.equal((await feature('pro1', 'studio.drama')).enabled, true, 'studio menus have no landing switch');
});

test('admin overrides one member: on with its own limit, off, with an end date, back to the plan; every change audited', async () => {
  const set = data => customers('/free1/feature', { note: 'ทดลองใช้', ...data });
  let response = await set({ feature: 'landing.ai_video', mode: 'on', monthlyLimit: 2, days: 7 });
  assert.equal(response.status, 200);
  let video = await feature('free1', 'landing.ai_video');
  assert.deepEqual({ enabled: video.enabled, limit: video.monthlyLimit, source: video.source }, { enabled: true, limit: 2, source: 'override' });
  response = await set({ feature: 'landing.clips', mode: 'off' });
  assert.equal((await feature('free1', 'landing.clips')).enabled, false);
  // an expired override no longer applies: the plan's answer comes back
  sqlite.prepare("UPDATE user_features SET expires_at = 1 WHERE feature_key = 'landing.ai_video'").run();
  assert.equal((await feature('free1', 'landing.ai_video')).enabled, false);
  await set({ feature: 'landing.clips', mode: 'plan' });
  assert.deepEqual({ ...(await feature('free1', 'landing.clips')) }.source, 'plan');
  const detail = await (await customers('/free1')).json();
  assert.ok(detail.features.find(f => f.key === 'landing.clips').enabled);
  assert.equal(detail.featureCatalog.length, 13);
  assert.deepEqual(detail.overrides.map(o => o.featureKey), ['landing.ai_video']);
  const audit = sqlite.prepare("SELECT action, detail, actor FROM admin_audit WHERE user_id = 'free1' ORDER BY rowid").all().map(r => ({ ...r, detail: JSON.parse(r.detail) }));
  assert.deepEqual(audit.map(a => [a.action, a.detail.feature, a.detail.after && a.detail.after.enabled]),
    [['feature', 'landing.ai_video', true], ['feature', 'landing.clips', false], ['feature', 'landing.clips', null]]);
  assert.deepEqual(audit[2].detail.before, { enabled: false, monthlyLimit: null, expiresAt: null });
  for (const [bad, status] of [[{ feature: 'nope', mode: 'on' }, 400], [{ feature: 'landing.social', mode: 'on', monthlyLimit: 5 }, 400],
    [{ feature: 'landing.clips', mode: 'maybe' }, 400], [{ feature: 'landing.clips', mode: 'on', days: 0 }, 400], [{ feature: 'landing.clips', mode: 'on', note: '' }, 400]]) {
    assert.equal((await set(bad)).status, status, JSON.stringify(bad));
  }
  assert.equal((await customers('/ghost/feature', { feature: 'landing.clips', mode: 'on', note: 'x' })).status, 404);
});

test('admin sets what a plan includes: members on it follow at once, the change is audited', async () => {
  const before = await (await system('/plans')).json();
  assert.equal(before.features.length, 13);
  assert.deepEqual(before.plans.find(p => p.id === 'free').features, { 'landing.clips': 3, 'landing.marketer': 5 });
  const response = await system('/plans/free/features', { features: { 'landing.clips': { limit: 10 }, 'studio.drama': { limit: null } }, note: 'โปรโมชัน' }, 'PUT');
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).plans.find(p => p.id === 'free').features, { 'landing.clips': 10, 'studio.drama': null });
  assert.deepEqual(await enabled('free1'), ['landing.clips', 'studio.drama']);
  assert.equal((await feature('free1', 'landing.clips')).monthlyLimit, 10);
  const audit = JSON.parse(sqlite.prepare("SELECT detail FROM system_audit WHERE area = 'plan' AND target = 'free'").get().detail);
  assert.deepEqual(audit.features, { before: { 'landing.clips': 3, 'landing.marketer': 5 }, after: { 'landing.clips': 10, 'studio.drama': null } });
  assert.equal((await system('/plans/free/features', { features: { 'landing.inbox': { limit: 3 } } }, 'PUT')).status, 400, 'no quota on inbox');
  assert.equal((await system('/plans/ghost/features', { features: {} }, 'PUT')).status, 404);
});

test('routes enforce it: clips quota with the use given back when the job cannot start; inbox and social closed outside the plan', async () => {
  const brief = { productName: 'สบู่', details: 'สบู่มะลิ', price: '99 บาท', affiliateUrl: 'https://s.shopee.co.th/abc', tone: 'friendly', channel: 'tiktok', imageCount: 1 };
  const post = () => affiliate.handleAffiliateApi(new Request(ORIGIN + '/api/affiliate/reviews', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(brief) }), env, new URL(ORIGIN + '/api/affiliate/reviews'), 'free1');
  assert.equal((await post()).status, 402, 'no credits');
  assert.equal((await feature('free1', 'landing.clips')).used, 0, 'the use was given back');
  sqlite.prepare("INSERT INTO user_features (user_id, feature_key, enabled, monthly_limit, note, updated_at) VALUES ('free1', 'landing.clips', true, 0, 'หยุดชั่วคราว', 1)").run();
  const refused = await post();
  assert.equal(refused.status, 429);
  assert.equal((await refused.json()).reason, 'feature_quota');

  const token = 'T'.repeat(43);
  const { sha256 } = require(path.join(buildDir, 'auth/common.js'));
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)').run(await sha256(token), 'free1', FUTURE);
  const get = pathname => worker.fetch(new Request(ORIGIN + pathname, { headers: { Cookie: 'naka_session=' + token } }), env, { waitUntil() {} });
  for (const pathname of ['/api/inbox/settings', '/api/social/accounts']) {
    const response = await get(pathname);
    assert.equal(response.status, 403, pathname);
    assert.equal((await response.json()).reason, 'feature_disabled');
  }
  const me = await (await get('/api/auth/me')).json();
  assert.deepEqual(me.features.find(f => f.key === 'landing.clips'), {
    key: 'landing.clips', app: 'landing', label: 'คลิปรีวิวสินค้า', quotaUnit: 'คลิป', enabled: true, monthlyLimit: 0, used: 0, source: 'override' });
});
