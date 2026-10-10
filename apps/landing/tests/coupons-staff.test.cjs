// Discount codes (src/billing/coupons.ts + checkout) and back-office roles (src/admin/auth.ts supportMay,
// src/admin/staff.ts). Stripe is a stand-in at fetch; no money moves.
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `coupons-staff-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--esModuleInterop', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const billing = require(path.join(buildDir, 'billing', 'index.js'));
const { discountFor } = require(path.join(buildDir, 'billing', 'coupons.js'));
const { supportMay } = require(path.join(buildDir, 'admin', 'auth.js'));

const ORIGIN = 'https://naka.test';
const TOKEN = 'test-only-admin-token';
const t = () => Math.floor(Date.now() / 1000);
const sha = value => createHash('sha256').update(value).digest('base64url');
let sqlite, db, env, stripe;

beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  env = { DB: db, ADMIN_TOKEN: TOKEN, ADMIN_EMAILS: 'owner@naka.test', APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40),
    STRIPE_SECRET_KEY: 'rk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_test_signing_secret', FEATURE_PAYMENTS: 'on', ASSETS: { fetch: async () => new Response('asset') } };
  sqlite.exec(`INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้านเอ', 1), ('u2', 'ร้านบี', 1)`);
  stripe = [];
  mock.method(globalThis, 'fetch', async (url, init) => {
    const u = new URL(String(url));
    if (u.origin !== 'https://api.stripe.com') throw new Error('unexpected ' + url);
    const form = new URLSearchParams(String(init.body));
    stripe.push(form);
    const id = 'cs_test_' + stripe.length;
    return Response.json({ object: 'checkout.session', id, url: 'https://checkout.stripe.com/c/pay/' + id, status: 'open', payment_status: 'unpaid',
      amount_total: Number(form.get('line_items[0][price_data][unit_amount]')), currency: 'thb', client_reference_id: form.get('client_reference_id'),
      metadata: { payment_id: form.get('metadata[payment_id]') } });
  });
});
afterEach(() => { mock.restoreAll(); sqlite.close(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const admin = (pathname, init = {}, headers = { Authorization: 'Bearer ' + TOKEN }) => worker.fetch(new Request(ORIGIN + pathname, {
  ...init, headers: { ...headers, ...(init.json !== undefined ? { 'Content-Type': 'application/json', Origin: ORIGIN } : {}) },
  ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) }), env, { waitUntil() {} });
const customer = (route, body, user = 'u1') => {
  const url = new URL(`${ORIGIN}/api/billing${route}`);
  return billing.handleBilling(new Request(url, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env, url, user);
};
const code = (json) => admin('/api/admin/coupons', { method: 'POST', json });

test('the discount never takes a payment below 10 baht', () => {
  assert.equal(discountFor({ kind: 'percent', value: 20 }, 39900), 7980);
  assert.equal(discountFor({ kind: 'amount', value: 100 }, 39900), 10000);
  assert.equal(discountFor({ kind: 'amount', value: 1000 }, 39900), 38900, 'leaves 10 baht');
  assert.equal(discountFor({ kind: 'percent', value: 90 }, 1000), 0);
});

test('admin codes: validated, listed with their state; switching off is recorded', async () => {
  for (const bad of [{ code: 'x', kind: 'percent', value: 10 }, { code: 'OK10', kind: 'percent', value: 95 }, { code: 'OK10', kind: 'gift', value: 1 },
    { code: 'OK10', kind: 'amount', value: 0 }, { code: 'OK10', kind: 'percent', value: 10, planIds: ['nope'] }, { code: 'OK10', kind: 'percent', value: 10, period: 'weekly' },
    { code: 'OK10', kind: 'percent', value: 10, startsAt: 100, endsAt: 50 }]) {
    assert.equal((await code(bad)).status, 400, JSON.stringify(bad));
  }
  let r = await (await code({ code: 'save20', kind: 'percent', value: 20, planIds: ['starter', 'pro'], maxUses: 2, note: 'เปิดร้าน' })).json();
  assert.equal(r.coupons[0].code, 'SAVE20', 'codes are upper case');
  assert.deepEqual(r.coupons[0].planIds, ['starter', 'pro']);
  assert.equal(r.coupons[0].state, 'live');
  assert.equal((await code({ code: 'SAVE20', kind: 'amount', value: 5 })).status, 409);
  await code({ code: 'LATER', kind: 'amount', value: 50, startsAt: t() + 3600 });
  r = await (await admin('/api/admin/coupons/SAVE20', { method: 'PUT', json: { active: false } })).json();
  assert.deepEqual(Object.fromEntries(r.coupons.map(c => [c.code, c.state])), { SAVE20: 'off', LATER: 'scheduled' });
  assert.deepEqual(sqlite.prepare("SELECT target, action FROM system_audit WHERE area = 'coupon' ORDER BY rowid").all().map(a => a.target + ':' + a.action),
    ['SAVE20:create', 'LATER:create', 'SAVE20:update']);
});

test('checkout with a code: Stripe is asked for the discounted price, the payment remembers the code, the rules hold', async () => {
  await code({ code: 'SAVE20', kind: 'percent', value: 20, planIds: ['starter'], maxUses: 2 });
  const preview = await (await customer('/coupon', { code: ' save20 ', planId: 'starter', period: 'monthly' })).json();
  assert.deepEqual(preview, { code: 'SAVE20', label: 'ลด 20%', price: 399, discount: 79.8, amount: 319.2 });
  assert.match((await (await customer('/coupon', { code: 'SAVE20', planId: 'pro', period: 'monthly' })).json()).error, /ใช้กับแพ็กเกจนี้ไม่ได้/);
  assert.match((await (await customer('/coupon', { code: 'NOPE', planId: 'starter', period: 'monthly' })).json()).error, /ไม่พบโค้ด/);

  const paid = await customer('/checkout', { planId: 'starter', period: 'monthly', coupon: 'save20' });
  assert.equal(paid.status, 201);
  const body = await paid.json();
  assert.equal(body.amount, 319.2); assert.equal(body.discount, 79.8); assert.equal(body.coupon, 'SAVE20');
  assert.equal(stripe[0].get('line_items[0][price_data][unit_amount]'), '31920');
  assert.match(stripe[0].get('line_items[0][price_data][product_data][name]'), /โค้ด SAVE20/);

  // one use per customer while that checkout is open
  const again = await customer('/checkout', { planId: 'starter', period: 'monthly', coupon: 'SAVE20' });
  assert.equal(again.status, 400); assert.match((await again.json()).error, /คุณใช้โค้ดนี้ครบแล้ว/);
  // a second customer takes the last use; a third finds it used up
  sqlite.exec(`INSERT INTO users (id, display_name, created_at) VALUES ('u3', 'ร้านซี', 1)`);
  assert.equal((await customer('/checkout', { planId: 'starter', period: 'monthly', coupon: 'SAVE20' }, 'u2')).status, 201);
  const full = await customer('/checkout', { planId: 'starter', period: 'monthly', coupon: 'SAVE20' }, 'u3');
  assert.equal(full.status, 400); assert.match((await full.json()).error, /ครบจำนวนแล้ว/);
  // an unpaid checkout that expired gives its use back
  sqlite.prepare("UPDATE payments SET expires_at = 1 WHERE user_id = 'u2'").run();
  assert.equal((await customer('/checkout', { planId: 'starter', period: 'monthly', coupon: 'SAVE20' }, 'u3')).status, 201);
  // no code: the full price, as before
  assert.equal((await customer('/checkout', { planId: 'pro', period: 'monthly' }, 'u2')).status, 201);
  assert.equal(stripe.at(-1).get('line_items[0][price_data][unit_amount]'), '79000');

  const listed = await (await admin('/api/admin/payments?q=' + encodeURIComponent('ร้านเอ'))).json();
  assert.equal(listed.payments[0].coupon, 'SAVE20'); assert.equal(listed.payments[0].discount, 79.8);
  const csv = await (await admin('/api/admin/payments.csv')).text();
  assert.ok(csv.split('\r\n')[0].includes('โค้ดส่วนลด,ส่วนลด (บาท)'));
  assert.ok(csv.includes(',319.20,SAVE20,79.80,'));
});

test('the last use is taken inside the insert: a code switched off between the check and the payment is refused', async () => {
  await code({ code: 'FLASH', kind: 'amount', value: 50 });
  const original = env.DB.prepare.bind(env.DB);
  let armed = true;
  // switch the code off right after the first look at it, before the payment is written
  env.DB = { ...env.DB, batch: env.DB.batch.bind(env.DB), prepare(sql) {
    const statement = original(sql);
    if (armed && sql.includes('INSERT INTO payments')) { armed = false; sqlite.prepare("UPDATE coupons SET active = 0 WHERE code = 'FLASH'").run(); }
    return statement;
  } };
  const response = await customer('/checkout', { planId: 'starter', period: 'monthly', coupon: 'FLASH' });
  assert.equal(response.status, 400);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 0);
  assert.equal(stripe.length, 0, 'Stripe never asked');
});

let counter = 0;
function signedIn(email) {
  const id = 'staff' + ++counter, token = String(counter).padStart(43, 'b');
  sqlite.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(id, 'ทีม', t());
  sqlite.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES (?, ?, 'google', ?, ?, ?)").run('si' + counter, id, 'g' + counter, email, t());
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha(token), id, t() + 86400, t() - 60);
  return { Cookie: 'naka_session=' + token };
}

test('roles: owners add support staff; support does customer care but not settings, prices, codes or staff', async () => {
  const cookie = signedIn('helper@naka.test');
  assert.equal((await admin('/api/admin/me', {}, cookie)).status, 403, 'not staff yet');
  assert.equal((await admin('/api/admin/staff', { method: 'POST', json: { email: 'owner@naka.test' } })).status, 409, 'owners are set in the config');
  let staff = await (await admin('/api/admin/staff', { method: 'POST', json: { email: ' Helper@Naka.test ', note: 'แอดมินตอบแชต' } })).json();
  assert.deepEqual(staff.owners, ['owner@naka.test']);
  assert.deepEqual(staff.staff.map(s => [s.email, s.role]), [['helper@naka.test', 'support']]);

  assert.deepEqual(await (await admin('/api/admin/me', {}, cookie)).json(), { kind: 'google', label: 'helper@naka.test', role: 'support' });
  const as = (pathname, init = {}) => admin(pathname, { ...init, ...(init.method ? {} : {}) }, { ...cookie, Origin: ORIGIN });
  assert.equal((await as('/api/admin/overview')).status, 200);
  assert.equal((await as('/api/admin/customers')).status, 200);
  const grant = await admin('/api/admin/customers/u1/credits', { method: 'POST', json: { amount: 5, note: 'ชดเชย' } }, cookie);
  assert.equal(grant.status, 200, 'customer care');
  assert.equal(sqlite.prepare("SELECT actor FROM admin_audit WHERE user_id = 'u1'").get().actor, 'helper@naka.test');
  for (const [method, route, json] of [['POST', '/api/admin/customers/u1/package', { planId: 'pro', months: 1, note: 'x' }],
    ['PUT', '/api/admin/system/settings/SIGNUP_CREDITS', { value: '5' }], ['GET', '/api/admin/system/settings'], ['POST', '/api/admin/coupons', { code: 'X10', kind: 'amount', value: 1 }],
    ['GET', '/api/admin/staff'], ['POST', '/api/admin/staff', { email: 'x@naka.test' }], ['POST', '/api/admin/credits/u1', { amount: 1 }], ['GET', '/api/admin/alerts']]) {
    const response = await admin(route, method === 'GET' ? {} : { method, json }, cookie);
    assert.equal(response.status, 403, `${method} ${route}`);
    assert.equal((await response.json()).reason, 'role');
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM coupons").get().n, 0);

  staff = await (await admin('/api/admin/staff/helper%40naka.test', { method: 'DELETE' })).json();
  assert.deepEqual(staff.staff, []);
  assert.equal((await admin('/api/admin/me', {}, cookie)).status, 403, 'removed: refused at the next request');
  assert.deepEqual(sqlite.prepare("SELECT action FROM system_audit WHERE area = 'staff' ORDER BY rowid").all().map(a => a.action), ['create', 'remove']);
});

test('supportMay: reads yes (not secrets or staff), care writes yes, everything else no', () => {
  assert.equal(supportMay('GET', '/api/admin/payments.csv'), true);
  assert.equal(supportMay('GET', '/api/admin/system/plans'), true);
  assert.equal(supportMay('GET', '/api/admin/system/settings'), false);
  assert.equal(supportMay('POST', '/api/admin/customers/u1/password'), true);
  assert.equal(supportMay('POST', '/api/admin/customers/u1/package'), false);
  assert.equal(supportMay('POST', '/api/admin/studio-system/tasks/4/cancel'), true);
  assert.equal(supportMay('PUT', '/api/admin/products/3'), true);
  assert.equal(supportMay('PUT', '/api/admin/system/plans/pro'), false);
  assert.equal(supportMay('POST', '/api/admin/content/clips'), false);
  assert.equal(supportMay('DELETE', '/api/admin/content/announcements/x'), false);
});
