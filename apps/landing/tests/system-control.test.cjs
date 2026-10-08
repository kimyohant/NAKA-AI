const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readdirSync, rmSync } = require('node:fs');
const { randomBytes } = require('node:crypto');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `system-control-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const { handleAdminSystem } = require(path.join(buildDir, 'system/admin.js'));
const { withSettings, featureOn } = require(path.join(buildDir, 'system/store.js'));
const worker = require(path.join(buildDir, 'index.js')).default;
const migrations = readdirSync(path.join(root, 'migrations')).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
const TOKEN = 'test-only-admin-token';
const STRIPE = 'rk_test_' + 'A'.repeat(24) + 'wxyz';
const ANTHROPIC = 'sk-ant-api03-' + 'b'.repeat(30) + 'Q9z1';
let sqlite, db, env;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...migrations));
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 's'.repeat(40),
    SETTINGS_KEY: randomBytes(32).toString('base64'), ASSETS: { fetch: async () => new Response('asset') } };
});
afterEach(() => sqlite.close());
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

function call(route, data, options = {}) {
  const url = new URL('https://naka.test/api/admin/system' + route);
  return handleAdminSystem(new Request(url, { method: options.method || (data === undefined ? 'GET' : 'PUT'),
    headers: { Authorization: 'Bearer ' + (options.token ?? TOKEN), 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) }), options.env ?? env, url);
}
const set = (key, value, extra = {}) => call('/settings/' + key, { value, ...extra }, { method: 'PUT' });
const setting = async key => (await (await call('/settings')).json()).settings.find(s => s.key === key);
const auditRows = () => sqlite.prepare('SELECT * FROM system_audit ORDER BY rowid').all();
const site = (pathname, init = {}, e = env) => worker.fetch(new Request('https://naka.test' + pathname, init), e, { waitUntil() {} });

test('every route needs the admin token, and a missing token configuration fails closed', async () => {
  assert.equal((await call('/settings', undefined, { token: 'wrong' })).status, 401);
  assert.equal((await call('/settings', undefined, { env: { ...env, ADMIN_TOKEN: '' } })).status, 401);
  assert.equal((await site('/api/admin/system/settings')).status, 401);
  assert.equal((await site('/api/admin/system/settings', { headers: { Authorization: 'Bearer ' + TOKEN } })).status, 200);
});

test('a secret is stored encrypted, shown only by its hint, and audited without its value', async () => {
  const response = await set('STRIPE_SECRET_KEY', STRIPE, { note: 'ใส่คีย์ทดสอบ' });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes(STRIPE));
  const row = sqlite.prepare("SELECT * FROM system_settings WHERE key = 'STRIPE_SECRET_KEY'").get();
  assert.equal(row.secret, 1); assert.match(row.value, /^v1\./); assert.ok(!row.value.includes('wxyz')); assert.equal(row.hint, 'wxyz');
  assert.deepEqual(JSON.parse(text).settings.find(s => s.key === 'STRIPE_SECRET_KEY'),
    { key: 'STRIPE_SECRET_KEY', group: 'payments', kind: 'secret', label: 'Stripe secret key', help: 'restricted key rk_… (หรือ sk_…)',
      options: null, source: 'panel', updatedAt: row.updated_at, set: true, hint: 'wxyz', readable: true });
  const [entry] = auditRows();
  assert.equal(entry.action, 'set'); assert.equal(entry.note, 'ใส่คีย์ทดสอบ');
  assert.ok(!entry.detail.includes(STRIPE)); assert.deepEqual(JSON.parse(entry.detail), { before: null, after: { hint: 'wxyz' } });
  assert.equal((await withSettings(env)).STRIPE_SECRET_KEY, STRIPE);
  // Short secrets get no hint at all.
  await set('META_WEBHOOK_VERIFY_TOKEN', 'short-token');
  assert.equal((await setting('META_WEBHOOK_VERIFY_TOKEN')).hint, null);
});

test('without a valid SETTINGS_KEY secrets are refused but plain settings still save', async () => {
  for (const key of [undefined, 'not-base64', randomBytes(16).toString('base64')]) {
    const e = { ...env, SETTINGS_KEY: key };
    assert.equal((await call('/settings/STRIPE_SECRET_KEY', { value: STRIPE }, { method: 'PUT', env: e })).status, 503);
    assert.equal((await (await call('/settings', undefined, { env: e })).json()).keyReady, false);
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM system_settings').get().n, 0);
  assert.equal((await call('/settings/SIGNUP_CREDITS', { value: '3' }, { method: 'PUT', env: { ...env, SETTINGS_KEY: undefined } })).status, 200);
});

test('panel values win over wrangler values, which win over switch defaults', async () => {
  const workerEnv = { ...env, SIGNUP_CREDITS: '5', ANTHROPIC_API_KEY: 'from-wrangler' };
  let merged = await withSettings(workerEnv);
  assert.equal(merged.SIGNUP_CREDITS, '5'); assert.equal(merged.ANTHROPIC_API_KEY, 'from-wrangler');
  assert.equal(merged.FEATURE_PAYMENTS, 'off'); assert.equal(merged.FEATURE_MAINTENANCE, 'off'); // payments default off (non-commercial)
  assert.equal(merged.FEATURE_CLIPS, 'on');
  assert.equal(featureOn(merged, 'FEATURE_PAYMENTS'), false); assert.equal(featureOn(merged, 'FEATURE_MAINTENANCE'), false);
  assert.equal((await setting('SIGNUP_CREDITS')).source, 'unset');
  await set('SIGNUP_CREDITS', 10); await set('ANTHROPIC_API_KEY', ANTHROPIC); await set('FEATURE_PAYMENTS', 'on');
  merged = await withSettings(workerEnv); // the write cleared this isolate's cache
  assert.equal(merged.SIGNUP_CREDITS, '10'); assert.equal(merged.ANTHROPIC_API_KEY, ANTHROPIC); assert.equal(featureOn(merged, 'FEATURE_PAYMENTS'), true);
  assert.equal(merged.DB, db); assert.equal(merged.ADMIN_TOKEN, TOKEN); // bindings and locked values pass through
  const view = (await (await call('/settings', undefined, { env: workerEnv })).json()).settings;
  assert.equal(view.find(s => s.key === 'SIGNUP_CREDITS').value, '10');
  assert.equal(view.find(s => s.key === 'FEATURE_CLIPS').source, 'default');
  // Clearing falls back to the wrangler value.
  assert.equal((await call('/settings/SIGNUP_CREDITS', undefined, { method: 'DELETE', env: workerEnv })).status, 200);
  assert.equal((await withSettings(workerEnv)).SIGNUP_CREDITS, '5');
  assert.equal((await call('/settings/SIGNUP_CREDITS', undefined, { method: 'DELETE' })).status, 404);
  assert.deepEqual(auditRows().map(r => [r.target, r.action]),
    [['SIGNUP_CREDITS', 'set'], ['ANTHROPIC_API_KEY', 'set'], ['FEATURE_PAYMENTS', 'set'], ['SIGNUP_CREDITS', 'clear']]);
});

test('unreadable, tampered or unknown rows are ignored so the Worker values keep the site running', async () => {
  await set('ANTHROPIC_API_KEY', ANTHROPIC);
  const workerEnv = { ...env, ANTHROPIC_API_KEY: 'from-wrangler', ADMIN_TOKEN: TOKEN };
  // A different SETTINGS_KEY cannot decrypt the row. (Read it first: migratedDb() starts a fresh database.)
  const moved = sqlite.prepare("SELECT * FROM system_settings WHERE key = 'ANTHROPIC_API_KEY'").get();
  const { sqlite: s2, db: db2 } = migratedDb(...migrations);
  const otherKey = { ...workerEnv, SETTINGS_KEY: randomBytes(32).toString('base64'), DB: db2 };
  s2.prepare('INSERT INTO system_settings (key, value, secret, hint, updated_at) VALUES (?, ?, ?, ?, ?)').run(moved.key, moved.value, 1, moved.hint, moved.updated_at);
  s2.prepare("INSERT INTO system_settings (key, value, secret, hint, updated_at) VALUES ('ADMIN_TOKEN', 'stolen', 0, NULL, 1), ('FEATURE_CLIPS', 'off', 1, NULL, 1)").run();
  // The same ciphertext under another key name fails its additional data check.
  s2.prepare("INSERT INTO system_settings (key, value, secret, hint, updated_at) VALUES ('GOOGLE_TTS_API_KEY', ?, 1, NULL, 1)").run(moved.value);
  let merged = await withSettings({ ...otherKey, DB: db2 });
  assert.equal(merged.ANTHROPIC_API_KEY, 'from-wrangler');
  assert.equal(merged.ADMIN_TOKEN, TOKEN);
  assert.equal(merged.FEATURE_CLIPS, 'on');
  merged = await withSettings({ ...workerEnv, DB: db2 });
  assert.equal(merged.ANTHROPIC_API_KEY, ANTHROPIC);
  assert.equal(merged.GOOGLE_TTS_API_KEY, undefined);
  const view = (await (await call('/settings', undefined, { env: { ...otherKey, DB: db2 } })).json()).settings;
  assert.equal(view.find(s => s.key === 'ANTHROPIC_API_KEY').readable, false);
  s2.close();
  // A missing table (migration not applied yet) falls back to wrangler values instead of failing every request.
  const { sqlite: bare, db: bareDb } = migratedDb();
  bare.exec('DROP TABLE system_settings');
  assert.equal((await withSettings({ ...workerEnv, DB: bareDb })).ANTHROPIC_API_KEY, 'from-wrangler');
  bare.close();
});

test('invalid values, unknown keys and locked keys are refused without writing', async () => {
  const bad = [['STRIPE_SECRET_KEY', 'pk_live_123456789012'], ['SIGNUP_CREDITS', '-1'], ['SIGNUP_CREDITS', '1001'], ['SIGNUP_CREDITS', 1.5],
    ['FEATURE_PAYMENTS', 'yes'], ['SMS_PROVIDER', 'mock'], ['EMAIL_PROVIDER', 'mock'], ['RECEIPT_SELLER_TAX_ID', '12345'],
    ['SMS_GATEWAY_URL', 'http://gateway.test'], ['RECEIPT_SELLER_NAME', 'a\nb'], ['RECEIPT_SELLER_NAME', ''], ['RECEIPT_SELLER_NAME', null],
    ['RECEIPT_SELLER_NAME', 'x'.repeat(121)], ['EMAIL_FROM', 'not an email']];
  for (const [key, value] of bad) assert.equal((await set(key, value)).status, 400, `${key}=${value}`);
  for (const key of ['ADMIN_TOKEN', 'SETTINGS_KEY', 'SESSION_SECRET', 'APP_ORIGIN', 'NOPE']) assert.equal((await set(key, 'x'.repeat(40))).status, 404);
  assert.equal((await call('/settings/STRIPE_SECRET_KEY', 'not json', { method: 'PUT' })).status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM system_settings').get().n, 0);
  assert.equal(auditRows().length, 0);
  assert.equal((await set('EMAIL_FROM', 'naka-ai <no-reply@naka-ai.com>')).status, 200);
  assert.equal((await set('RECEIPT_SELLER_TAX_ID', '1234567890123')).status, 200);
});

test('import copies wrangler values once, encrypts secrets, skips invalid ones and never overwrites the panel', async () => {
  const workerEnv = { ...env, STRIPE_SECRET_KEY: STRIPE, SIGNUP_CREDITS: '3', SMS_PROVIDER: 'off', GOOGLE_TTS_VOICE: 'bad voice', EMAIL_PROVIDER: 'mock' };
  await set('SIGNUP_CREDITS', '7');
  const response = await call('/settings/import', undefined, { method: 'POST', env: workerEnv });
  const result = await response.json();
  assert.deepEqual(result.imported.sort(), ['SMS_PROVIDER', 'STRIPE_SECRET_KEY']);
  assert.deepEqual(result.skipped.map(s => s.key).sort(), ['EMAIL_PROVIDER', 'GOOGLE_TTS_VOICE']);
  assert.ok(!JSON.stringify(result).includes(STRIPE));
  assert.equal(sqlite.prepare("SELECT value FROM system_settings WHERE key = 'SIGNUP_CREDITS'").get().value, '7');
  assert.match(sqlite.prepare("SELECT value FROM system_settings WHERE key = 'STRIPE_SECRET_KEY'").get().value, /^v1\./);
  assert.equal((await withSettings({ ...env })).STRIPE_SECRET_KEY, STRIPE); // works with the wrangler secret deleted
  const again = await (await call('/settings/import', undefined, { method: 'POST', env: workerEnv })).json();
  assert.deepEqual(again.imported, []);
  assert.equal(auditRows().filter(r => r.action === 'import').length, 2);
  assert.ok(!auditRows().some(r => r.detail.includes(STRIPE)));
});

test('switches close their features on the live router; maintenance leaves the panel, health and sign-in config open', async () => {
  await set('FEATURE_MAINTENANCE', 'on');
  assert.equal((await site('/api/works')).status, 503);
  assert.equal((await (await site('/api/works')).json()).maintenance, true);
  assert.equal((await site('/api/health')).status, 200);
  assert.equal((await site('/api/auth/config')).status, 200);
  assert.equal((await site('/api/admin/system/settings', { headers: { Authorization: 'Bearer ' + TOKEN } })).status, 200);
  await set('FEATURE_MAINTENANCE', 'off');
  assert.equal((await site('/api/works')).status, 401);

  const configured = { ...env, GOOGLE_CLIENT_ID: '1-abc.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'g-secret',
    TURNSTILE_SITE_KEY: '0x4AAAAAAAtest', TURNSTILE_SECRET_KEY: 't-secret' };
  let config = await (await site('/api/auth/config', {}, configured)).json();
  assert.equal(config.googleLogin, true); assert.equal(config.turnstileSiteKey, '0x4AAAAAAAtest');
  await set('FEATURE_GOOGLE_LOGIN', 'off'); await set('FEATURE_TURNSTILE', 'off');
  config = await (await site('/api/auth/config', {}, configured)).json();
  assert.equal(config.googleLogin, false); assert.equal(config.turnstileSiteKey, null);
  assert.equal((await site('/api/auth/google/start', {}, configured)).status, 503);

  await set('FEATURE_CLIPS', 'off'); await set('FEATURE_SOCIAL', 'off'); await set('FEATURE_INBOX', 'off');
  const post = { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://naka.test' }, body: '{}' };
  assert.equal((await site('/api/affiliate/reviews', post)).status, 503);
  assert.equal((await site('/api/affiliate/reviews/', post)).status, 503);
  assert.equal((await site('/api/affiliate/reviews/some-job')).status, 401); // reading old jobs still needs only a session
  assert.equal((await site('/api/social/accounts')).status, 503);
  assert.equal((await site('/api/inbox')).status, 503);
  assert.notEqual((await (await site('/api/social/media/x')).json()).error, 'ฟีเจอร์นี้ปิดให้บริการชั่วคราว');
});

test('plans: create, edit, take off sale, keep the free plan free, and audit each change', async () => {
  const create = data => call('/plans', data, { method: 'POST' });
  const update = (id, data) => call('/plans/' + id, data, { method: 'PUT' });
  assert.equal((await create({ id: 'team', name: 'ทีม', price: 2490, monthlyCredits: 500, parallelJobs: 10, onSale: true })).status, 200);
  assert.equal((await create({ id: 'team', name: 'ซ้ำ', price: 100, monthlyCredits: 1, parallelJobs: 1, onSale: true })).status, 409);
  assert.equal((await create({ id: 'free', name: 'ฟรี', price: 0, monthlyCredits: 0, parallelJobs: 1, onSale: true })).status, 409);
  for (const data of [{ id: 'Bad Id', name: 'x', price: 10, monthlyCredits: 1, parallelJobs: 1, onSale: true },
    { id: 'cheap', name: 'x', price: 9, monthlyCredits: 1, parallelJobs: 1, onSale: true },
    { id: 'many', name: 'x', price: 10, monthlyCredits: 1, parallelJobs: 21, onSale: true },
    { id: 'noname', name: ' ', price: 10, monthlyCredits: 1, parallelJobs: 1, onSale: true },
    { id: 'nosale', name: 'x', price: 10, monthlyCredits: 1, parallelJobs: 1 }]) {
    assert.equal((await create(data)).status, 400, JSON.stringify(data));
  }
  let publicPlans = (await (await site('/api/plans')).json()).plans;
  assert.deepEqual(publicPlans.map(p => p.id), ['starter', 'pro', 'business', 'max', 'team']);
  assert.deepEqual(publicPlans.find(p => p.id === 'team'), { id: 'team', name: 'ทีม', monthlyCredits: 500, parallelJobs: 10, monthly: 2490, yearly: 24900 });

  assert.equal((await update('pro', { price: 890, note: 'ขึ้นราคา' })).status, 200);
  assert.equal((await update('max', { onSale: false })).status, 200);
  assert.equal((await update('free', { price: 500, name: 'ฟรีตลอด', onSale: false })).status, 200);
  assert.equal((await update('missing', { price: 500 })).status, 404);
  const free = sqlite.prepare("SELECT * FROM plans WHERE id = 'free'").get();
  assert.equal(free.price_thb, 0); assert.equal(free.name, 'ฟรีตลอด'); assert.equal(free.on_sale, 1);
  publicPlans = (await (await site('/api/plans')).json()).plans;
  assert.deepEqual(publicPlans.map(p => [p.id, p.monthly]), [['starter', 399], ['pro', 890], ['business', 1290], ['team', 2490]]);
  const admin = (await (await call('/plans')).json()).plans;
  assert.equal(admin.find(p => p.id === 'max').onSale, false);
  const proAudit = JSON.parse(auditRows().find(r => r.target === 'pro').detail);
  assert.equal(proAudit.before.price_thb, 790); assert.equal(proAudit.after.price_thb, 890);
  assert.deepEqual(auditRows().map(r => [r.target, r.action]), [['team', 'create'], ['pro', 'update'], ['max', 'update'], ['free', 'update']]);
  const history = (await (await call('/audit')).json()).audit;
  assert.equal(history[0].target, 'free'); assert.equal(history.length, 4);
});

test('the payments switch turns off checkout and the billing config without touching the Stripe webhook', async () => {
  const stripeEnv = { ...env, STRIPE_SECRET_KEY: STRIPE, STRIPE_WEBHOOK_SECRET: 'whsec_' + 'c'.repeat(20) };
  await set('FEATURE_PAYMENTS', 'off');
  const merged = await withSettings(stripeEnv);
  assert.equal(merged.STRIPE_SECRET_KEY, STRIPE); // kept for webhooks of payments already started
  const { handleBilling } = require(path.join(buildDir, 'billing/index.js'));
  const configUrl = new URL('https://naka.test/api/billing/config');
  assert.deepEqual(await (await handleBilling(new Request(configUrl), merged, configUrl, 'u1')).json(), { enabled: false });
  const checkoutUrl = new URL('https://naka.test/api/billing/checkout');
  const response = await handleBilling(new Request(checkoutUrl, { method: 'POST', headers: { Origin: 'https://naka.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ planId: 'starter', period: 'monthly' }) }), merged, checkoutUrl, 'u1');
  assert.equal(response.status, 503);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 0);
});
