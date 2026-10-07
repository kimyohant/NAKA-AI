const assert = require('node:assert/strict');
const { publicPath, skipNoPublic } = require('./helpers/landing.cjs');
const { after, afterEach, beforeEach, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `receipts-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir,
], { cwd: root, stdio: 'inherit' });
const { issueReceipt, backfillReceipts, handleReceipts } = require(path.join(buildDir, 'receipts/index.js'));
const { thaiBahtWords, inclusiveVatSatang } = require(path.join(buildDir, 'receipts/money.js'));
after(() => {
  assert.equal(path.dirname(buildDir), path.join(root, '.wrangler'));
  rmSync(buildDir, { recursive: true, force: true });
});

let sqlite, db, env;
const paidAt = Date.parse('2026-09-30T08:00:00Z') / 1000;
beforeEach(() => {
  ({ sqlite, db } = migratedDb('0001_auth.sql', '0002_credits_jobs.sql', '0004_plans.sql', '0007_payments.sql', '0008_receipts.sql'));
  env = { DB: db, RECEIPT_SELLER_NAME: 'บริษัท นาคา ทดสอบ จำกัด', RECEIPT_SELLER_ADDRESS: '99 ถนนทดสอบ\nกรุงเทพมหานคร 10110',
    RECEIPT_SELLER_TAX_ID: '0123456789012', RECEIPT_VAT_REGISTERED: '1' };
  sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'ร้านทดสอบ', 0), ('u2', 'อีกร้าน', 0)").run();
  sqlite.prepare(`INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES
    ('phone1', 'u1', 'phone', '+66812345678', NULL, 0),
    ('google1', 'u1', 'google', 'google-u1', 'buyer@example.test', 0)`).run();
});
afterEach(() => sqlite.close());

function payment(id, { user = 'u1', status = 'successful', amount = 39900, at = paidAt, period = 'monthly' } = {}) {
  sqlite.prepare(`INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at)
    VALUES (?, ?, 'starter', ?, ?, 'card', ?, ?, ?)`).run(id, user, period, amount, status, paidAt - 10, at);
  return id;
}
function call(route = '', user = 'u1', method = 'GET') {
  const url = new URL('https://naka.test/api/receipts' + route);
  return handleReceipts(new Request(url, { method }), env, url, user);
}
async function detail(id, user) { return (await call('/' + id, user)).json(); }
function rows() { return sqlite.prepare('SELECT * FROM receipts ORDER BY year, seq').all(); }

test('repeated and concurrent issuance returns one immutable identity without consuming numbers', async () => {
  payment('p1');
  const results = await Promise.all(Array.from({ length: 20 }, () => issueReceipt(env, 'p1')));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(results[0].number, 'RC2026-000001');
  assert.deepEqual(await issueReceipt(env, 'p1'), results[0]);
  assert.equal(rows().length, 1);
  payment('p2');
  assert.equal((await issueReceipt(env, 'p2')).number, 'RC2026-000002');
});

test('concurrent different payments receive consecutive unique sequences', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => payment('p' + i));
  await Promise.all(ids.flatMap(id => [issueReceipt(env, id), issueReceipt(env, id)]));
  assert.deepEqual(rows().map(row => row.seq), Array.from({ length: 12 }, (_, i) => i + 1));
  assert.equal(new Set(rows().map(row => row.number)).size, 12);
});

test('numbering uses paid_at in UTC+7 and resets exactly at Thai midnight', async () => {
  const instants = ['2025-12-31T16:30:00Z', '2025-12-31T16:59:59Z', '2025-12-31T17:00:00Z', '2025-12-31T17:30:00Z'];
  const results = [];
  for (const [i, at] of instants.entries()) {
    payment('p' + i, { at: Date.parse(at) / 1000 });
    results.push(await issueReceipt(env, 'p' + i));
  }
  assert.deepEqual(results.map(r => r.number), ['RC2025-000001', 'RC2025-000002', 'RC2026-000001', 'RC2026-000002']);
  assert.match((await detail(results[0].id)).paidDate, /31 ธันวาคม 2568/);
  assert.match((await detail(results[2].id)).paidDate, /1 มกราคม 2569/);
});

test('pending, failed, expired, missing and undated payments issue nothing', async () => {
  for (const status of ['pending', 'failed', 'expired']) {
    payment(status, { status });
    assert.equal(await issueReceipt(env, status), null);
  }
  payment('undated', { at: null });
  assert.equal(await issueReceipt(env, 'undated'), null);
  assert.equal(await issueReceipt(env, 'missing'), null);
  assert.equal(rows().length, 0);
});

test('missing seller config defers issuance, then backfill issues successful payments only', async () => {
  payment('paid'); payment('pending', { status: 'pending' });
  env.RECEIPT_SELLER_NAME = '  ';
  assert.equal(await issueReceipt(env, 'paid'), null);
  assert.equal(await backfillReceipts(env), 0);
  env.RECEIPT_SELLER_NAME = 'ผู้ขาย';
  assert.equal(await backfillReceipts(env), 1);
  assert.equal(await backfillReceipts(env), 0);
  const original = await issueReceipt(env, 'paid');
  delete env.RECEIPT_SELLER_NAME;
  assert.deepEqual(await issueReceipt(env, 'paid'), original, 'existing receipts remain available after config removal');
});

test('backfill is bounded, oldest-payment first, counts only actual inserts during overlap', async () => {
  for (let i = 0; i < 5; i++) payment('p' + i, { at: paidAt - i });
  const counts = await Promise.all([backfillReceipts(env, { max: 2 }), backfillReceipts(env, { max: 2 })]);
  assert.equal(counts.reduce((a, b) => a + b, 0), 2);
  assert.deepEqual(rows().map(row => row.payment_id), ['p4', 'p3']);
  assert.equal(await backfillReceipts(env, { max: 2 }), 2);
  assert.equal(await backfillReceipts(env), 1);
  for (const max of [0, -1, 1.5, NaN, Infinity]) assert.equal(await backfillReceipts(env, { max }), 0);
});

test('default backfill limit is 50', async () => {
  for (let i = 0; i < 51; i++) payment('p' + String(i).padStart(2, '0'));
  assert.equal(await backfillReceipts(env), 50);
  assert.equal(await backfillReceipts(env), 1);
});

test('missing/disabled buyers cannot issue or starve eligible backfill payments', async () => {
  payment('orphan', { user: 'missing', at: paidAt - 2 });
  payment('disabled', { user: 'u2', at: paidAt - 1 });
  sqlite.prepare("UPDATE users SET status = 'disabled' WHERE id = 'u2'").run();
  payment('valid');
  assert.equal(await issueReceipt(env, 'orphan'), null);
  assert.equal(await issueReceipt(env, 'disabled'), null);
  assert.equal(await backfillReceipts(env, { max: 1 }), 1);
  assert.equal(rows()[0].payment_id, 'valid');
});

test('an aborted insert does not leave a gap and a later backfill can retry', async () => {
  payment('bad'); payment('good');
  sqlite.exec("CREATE TRIGGER reject_bad BEFORE INSERT ON receipts WHEN NEW.payment_id = 'bad' BEGIN SELECT RAISE(ABORT, 'test failure'); END;");
  await assert.rejects(issueReceipt(env, 'bad'), /test failure/);
  assert.equal(await backfillReceipts(env), 1, 'one failed payment does not abort all the others');
  assert.equal(rows()[0].number, 'RC2026-000001');
  sqlite.exec('DROP TRIGGER reject_bad');
  assert.equal(await backfillReceipts(env), 1);
  assert.equal(rows()[1].number, 'RC2026-000002');
});

test('schema enforces one receipt per payment and one sequence per year', async () => {
  const receipt = await issueReceipt(env, payment('p1'));
  payment('p2');
  const r = rows()[0];
  const insert = sqlite.prepare('INSERT INTO receipts (id, payment_id, user_id, year, seq, number, issued_at, snapshot) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  assert.throws(() => insert.run('r2', 'p1', 'u1', r.year, 2, 'RC2026-000002', r.issued_at, r.snapshot), /UNIQUE/);
  assert.throws(() => insert.run('r2', 'p2', 'u1', r.year, 1, 'different', r.issued_at, r.snapshot), /UNIQUE/);
  assert.equal(rows()[0].id, receipt.id);
});

test('VAT-inclusive 399 baht splits into 26.10 VAT and 372.90 net', async () => {
  const receipt = await detail((await issueReceipt(env, payment('p1'))).id);
  assert.equal(receipt.amount, 399);
  assert.equal(receipt.vat, 26.1);
  assert.equal(receipt.subtotal, 372.9);
  assert.equal(receipt.vatText, '26.10');
  assert.equal(receipt.subtotalText, '372.90');
  assert.equal(receipt.title, 'ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ');
  assert.equal(receipt.amountWords, 'สามร้อยเก้าสิบเก้าบาทถ้วน');
  assert.equal(inclusiveVatSatang(8), 1);
  assert.equal(inclusiveVatSatang(7), 0);
});

test('only the exact VAT flag 1 enables VAT; optional seller fields can be absent', async () => {
  for (const [i, flag] of [undefined, '0', 'true', ' 1 '].entries()) {
    env.RECEIPT_VAT_REGISTERED = flag;
    delete env.RECEIPT_SELLER_ADDRESS; delete env.RECEIPT_SELLER_TAX_ID;
    const receipt = await detail((await issueReceipt(env, payment('p' + i))).id);
    assert.equal(receipt.title, 'ใบเสร็จรับเงิน');
    assert.equal(receipt.vatRegistered, false);
    assert.equal(receipt.vat, null);
    assert.equal(receipt.vatText, null);
    assert.equal(receipt.subtotal, receipt.amount);
    assert.equal(receipt.seller.taxId, null);
  }
});

test('all printed data stays snapshotted after changes to plans, buyer, payment and environment', async () => {
  const ref = await issueReceipt(env, payment('p1', { period: 'yearly', amount: 129025 }));
  const original = await detail(ref.id);
  assert.equal(original.buyer.phone, '+66812345678');
  assert.equal(original.buyer.email, 'buyer@example.test');
  sqlite.prepare("UPDATE plans SET name = 'เปลี่ยนชื่อ' WHERE id = 'starter'").run();
  sqlite.prepare("UPDATE users SET display_name = 'เปลี่ยนชื่อผู้ซื้อ' WHERE id = 'u1'").run();
  sqlite.prepare("UPDATE auth_identities SET email = 'changed@example.test' WHERE provider = 'google'").run();
  sqlite.prepare("UPDATE payments SET period = 'monthly', amount_satang = 1, paid_at = 0 WHERE id = 'p1'").run();
  Object.assign(env, { RECEIPT_SELLER_NAME: 'ใหม่', RECEIPT_SELLER_ADDRESS: 'ใหม่', RECEIPT_SELLER_TAX_ID: '', RECEIPT_VAT_REGISTERED: '0' });
  assert.deepEqual(await issueReceipt(env, 'p1'), ref);
  assert.deepEqual(await detail(ref.id), original);
  assert.equal(original.periodLabel, 'รายปี');
  assert.equal(original.amountText, '1,290.25');
});

test('list is owner-scoped, newest first and exposes baht, not satang', async () => {
  const first = await issueReceipt(env, payment('p1'));
  const second = await issueReceipt(env, payment('p2', { amount: 129025, period: 'yearly' }));
  await issueReceipt(env, payment('other', { user: 'u2' }));
  sqlite.prepare('UPDATE receipts SET issued_at = issued_at - 10 WHERE id = ?').run(first.id);
  const response = await call();
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const list = (await response.json()).receipts;
  assert.deepEqual(list.map(r => r.id), [second.id, first.id]);
  assert.equal(list[0].amount, 1290.25);
  assert.deepEqual(Object.keys(list[0]).sort(), ['amount', 'id', 'issuedAt', 'number', 'period', 'planName']);
  assert.deepEqual(await (await call('', 'empty')).json(), { receipts: [] });
});

test('other users and missing receipts get identical 404s; handlers are read-only', async () => {
  const ref = await issueReceipt(env, payment('p1'));
  const other = await call('/' + ref.id, 'u2');
  const missing = await call('/00000000-0000-0000-0000-000000000000');
  assert.equal(other.status, 404);
  assert.equal(missing.status, 404);
  assert.deepEqual(await other.json(), await missing.json());
  assert.equal((await call('/' + ref.id)).status, 200);
  assert.equal((await call('', '')).status, 401);
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = await call('/' + ref.id, 'u1', method);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'GET');
  }
  assert.equal((await call('/%27%20OR%201=1')).status, 404);
  const url = new URL('https://naka.test/api/receipts-other');
  assert.equal(await handleReceipts(new Request(url), env, url, 'u1'), null);
});

test('database errors return a Thai message without internal details', async () => {
  env.DB = { prepare() { throw new Error('SECRET database connection'); } };
  const response = await call();
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'โหลดใบเสร็จไม่สำเร็จ กรุณาลองใหม่' });
});

test('Thai amount words handle satang, special tens/ones and millions exactly', () => {
  const examples = new Map([
    [0, 'ศูนย์บาทถ้วน'], [50, 'ศูนย์บาทห้าสิบสตางค์'], [1, 'ศูนย์บาทหนึ่งสตางค์'],
    [2100, 'ยี่สิบเอ็ดบาทถ้วน'], [10100, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    [100000000, 'หนึ่งล้านบาทถ้วน'], [129025, 'หนึ่งพันสองร้อยเก้าสิบบาทยี่สิบห้าสตางค์'],
    [100, 'หนึ่งบาทถ้วน'], [1100, 'สิบเอ็ดบาทถ้วน'], [100000100, 'หนึ่งล้านเอ็ดบาทถ้วน'],
    [100000000000000, 'หนึ่งล้านล้านบาทถ้วน'],
  ]);
  for (const [amount, words] of examples) assert.equal(thaiBahtWords(amount), words);
  for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => thaiBahtWords(invalid), RangeError);
});

// Execute the actual browser script with a minimal DOM. No network, browser dependency or real payment.
async function page({ data, status = 200, search = '?id=receipt-id', authStatus = 200, networkFailure = false } = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, { textContent: '', hidden: true, disabled: true, listeners: {}, attributes: {},
      addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute(name, value) { this.attributes[name] = value; } });
    return elements.get(id);
  };
  const requests = [];
  let redirect, prints = 0;
  const document = { getElementById: get, fonts: { ready: Promise.resolve() } };
  const context = { document, URLSearchParams, location: { pathname: '/app/receipts/', search, replace(value) { redirect = value; } },
    window: { print() { prints++; } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkFailure) throw new Error('network details must not leak');
      return Response.json(url === '/api/auth/me' ? { user: { id: 'u1' } } : data ?? {}, { status: url === '/api/auth/me' ? authStatus : status });
    } };
  vm.runInNewContext(readFileSync(publicPath('app/receipts/receipts.js'), 'utf8'), context);
  for (let i = 0; i < 20 && get('main').attributes['aria-busy'] !== 'false'; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(get('main').attributes['aria-busy'], 'false', 'page settles');
  return { get, requests, document, redirect, prints: () => prints };
}

test('receipt page renders snapshots as text, reveals VAT and invokes printing', { skip: skipNoPublic }, async () => {
  const data = await detail((await issueReceipt(env, payment('p1'))).id);
  data.seller.name = '<img src=x onerror=alert(1)>';
  const ui = await page({ data });
  assert.equal(ui.get('seller-name').textContent, data.seller.name);
  assert.equal(ui.get('receipt').hidden, false);
  assert.equal(ui.get('vat-row').hidden, false);
  assert.equal(ui.get('vat').textContent, '26.10');
  assert.equal(ui.get('total').textContent, '399.00');
  assert.equal(ui.get('print').disabled, false);
  await ui.get('print').listeners.click();
  assert.equal(ui.prints(), 1);
  assert.deepEqual(ui.requests.map(r => r.url), ['/api/auth/me', '/api/receipts/receipt-id']);
  assert.ok(ui.requests.every(r => r.options.credentials === 'same-origin' && r.options.cache === 'no-store'));
});

test('unregistered receipt page hides all VAT lines and empty optional contacts', { skip: skipNoPublic }, async () => {
  env.RECEIPT_VAT_REGISTERED = '0'; delete env.RECEIPT_SELLER_TAX_ID;
  const data = await detail((await issueReceipt(env, payment('p1', { user: 'u2' }))).id, 'u2');
  const ui = await page({ data });
  for (const id of ['vat-row', 'subtotal-row', 'vat-note', 'seller-tax-row', 'buyer-phone-row', 'buyer-email-row']) assert.equal(ui.get(id).hidden, true);
});

test('receipt page redirects expired sessions preserving the full return path', { skip: skipNoPublic }, async () => {
  for (const options of [{ authStatus: 401 }, { status: 401 }]) {
    const ui = await page({ ...options, search: '?id=abc&from=billing' });
    assert.equal(ui.redirect, '/login/?next=' + encodeURIComponent('/app/receipts/?id=abc&from=billing'));
    assert.equal(ui.get('print').disabled, true);
  }
});

test('missing IDs, 404 and network failure show safe messages without a printable receipt', { skip: skipNoPublic }, async () => {
  for (const options of [{ search: '' }, { status: 404 }, { networkFailure: true }, { status: 500 }]) {
    const ui = await page(options);
    assert.equal(ui.get('receipt').hidden, true);
    assert.equal(ui.get('print').disabled, true);
    assert.equal(ui.get('error').hidden, false);
    assert.doesNotMatch(ui.get('error-message').textContent, /network details/);
    assert.equal(ui.get('retry').hidden, options.search === '' || options.status === 404);
  }
});
