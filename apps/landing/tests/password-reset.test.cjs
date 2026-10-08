const assert = require('node:assert/strict');
const { after, mock, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `password-reset-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--esModuleInterop',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'inherit' });
const { handleAuth, requireUser } = require(path.join(buildDir, 'auth/index.js'));
const { sha256 } = require(path.join(buildDir, 'auth/common.js'));
const { verifyPassword } = require(path.join(buildDir, 'auth/password.js'));
after(() => { mock.restoreAll(); rmSync(buildDir, { recursive: true, force: true }); });

const MIGRATIONS = ['0001_auth.sql', '0002_credits_jobs.sql', '0003_social.sql', '0004_plans.sql', '0007_payments.sql',
  '0008_receipts.sql', '0009_admin_audit.sql', '0010_stripe.sql', '0011_line_login.sql', '0012_password_login.sql',
  '0013_password_reset.sql'];

function setup(t) {
  const { sqlite, db } = migratedDb(...MIGRATIONS);
  sqlite.exec('PRAGMA foreign_keys = ON');
  t.after(() => sqlite.close());
  const env = { DB: db, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-secret-at-least-32-characters-long',
    SMS_PROVIDER: 'off', EMAIL_PROVIDER: 'resend', RESEND_API_KEY: 'test-key', EMAIL_FROM: 'NAKA-AI <reset@naka.test>' };
  const emails = [];
  const pending = [];
  let deliveryStatus = 200;
  const fetchStub = mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.resend.com/emails');
    emails.push({ url, options, body: JSON.parse(options.body) });
    return new Response('{}', { status: deliveryStatus });
  });
  t.after(() => fetchStub.mock.restore());
  const ctx = { waitUntil(promise) { pending.push(promise); } };
  const flush = async () => { await Promise.all(pending.splice(0)); };
  const call = (route, { body, origin = env.APP_ORIGIN, ip = '203.0.113.1', raw, contentType = 'application/json' } = {}) => {
    const url = new URL(`${env.APP_ORIGIN}/api/auth/${route}`);
    const post = body !== undefined || raw !== undefined;
    const request = new Request(url, { method: post ? 'POST' : 'GET',
      headers: { ...(post ? { Origin: origin, 'Content-Type': contentType } : {}), 'CF-Connecting-IP': ip },
      ...(post ? { body: raw ?? JSON.stringify(body) } : {}) });
    return handleAuth(request, env, url, ctx);
  };
  const register = (email = 'shop@example.test') => call('password/register', { body: { email, password: 'old-secret-123' } });
  const forgot = (email = 'shop@example.test', ip) => call('password/forgot', { body: { email }, ip });
  const reset = (token, newPassword = 'new-secret-456', ip) => call('password/reset', { body: { token, newPassword }, ip });
  const tokenFromEmail = () => emails.at(-1)?.body.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  return { sqlite, db, env, emails, ctx, call, register, forgot, reset, flush, tokenFromEmail,
    setDeliveryStatus(value) { deliveryStatus = value; } };
}

const cookieOf = response => response.headers.get('Set-Cookie').split(';')[0];
const signedIn = (f, cookie) => requireUser(new Request(`${f.env.APP_ORIGIN}/api/auth/me`, { headers: { Cookie: cookie } }), f.env);

test('forgot → email → reset changes login and revokes every session without issuing a new one', async t => {
  const f = setup(t);
  const first = cookieOf(await f.register());
  const second = cookieOf(await f.call('password/login', { body: { email: 'shop@example.test', password: 'old-secret-123' } }));
  const user = await signedIn(f, first);
  assert.deepEqual(await (await f.forgot()).json(), { ok: true });
  await f.flush();
  assert.equal(f.emails.length, 1);
  const sent = f.emails[0];
  assert.equal(sent.options.method, 'POST');
  assert.equal(sent.options.redirect, 'manual');
  assert.equal(sent.options.headers.Authorization, 'Bearer test-key');
  assert.equal(sent.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(sent.body.from, f.env.EMAIL_FROM);
  assert.deepEqual(sent.body.to, ['shop@example.test']);
  assert.equal(sent.body.html, undefined);
  assert.match(sent.body.text, /30 นาที/);
  const token = f.tokenFromEmail();
  assert.ok(token);
  assert.match(sent.body.text, new RegExp(`https://naka.test/login/reset/#token=${token}`));
  const row = f.sqlite.prepare('SELECT * FROM auth_password_resets').get();
  assert.equal(row.token_hash, await sha256(token));
  assert.equal(row.expires_at - row.created_at, 1800);
  assert.equal(JSON.stringify(row).includes(token), false);
  assert.equal(JSON.stringify(row).includes('shop@example.test'), false);
  const changed = await f.reset(token);
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { ok: true });
  assert.equal(changed.headers.get('Set-Cookie'), null);
  assert.equal(await signedIn(f, first), null);
  assert.equal(await signedIn(f, second), null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 0);
  const hash = f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash;
  assert.equal(await verifyPassword('new-secret-456', hash), true);
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: 'old-secret-123' } })).status, 401);
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: 'new-secret-456' } })).status, 200);
  assert.equal((await f.reset(token)).status, 400);
});

test('new request invalidates old token, expired token fails, and password validation does not burn a token', async t => {
  const f = setup(t);
  await f.register();
  await f.forgot(); await f.flush();
  const old = f.tokenFromEmail();
  await f.forgot(); await f.flush();
  const current = f.tokenFromEmail();
  assert.equal((await f.reset(old)).status, 400);
  for (const password of ['short', 'x'.repeat(129)]) {
    const response = await f.reset(current, password);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /รหัสผ่าน/);
  }
  assert.equal((await f.reset(current)).status, 200);
  await f.forgot(); await f.flush();
  const expired = f.tokenFromEmail();
  f.sqlite.prepare('UPDATE auth_password_resets SET expires_at = ? WHERE token_hash = ?').run(1, await sha256(expired));
  assert.equal((await f.reset(expired)).status, 400);
});

test('a disabled account cannot use an issued token and requests prune rows older than 24 hours', async t => {
  const f = setup(t);
  await f.register();
  await f.forgot(); await f.flush();
  const token = f.tokenFromEmail();
  f.sqlite.prepare("UPDATE users SET status = 'disabled' WHERE id = (SELECT user_id FROM auth_passwords)").run();
  assert.equal((await f.reset(token)).status, 400);
  const before = f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n;
  f.sqlite.prepare('UPDATE auth_password_resets SET created_at = 1').run();
  assert.equal((await f.forgot('unknown@example.test')).status, 200);
  assert.equal(before, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 1);
});

test('unknown, passwordless, and disabled accounts return the same response with no email', async t => {
  const f = setup(t);
  await f.register();
  f.sqlite.prepare("UPDATE users SET status = 'disabled' WHERE id = (SELECT user_id FROM auth_passwords)").run();
  f.sqlite.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('google','Google',1)").run();
  f.sqlite.prepare("INSERT INTO auth_identities (id,user_id,provider,provider_uid,email,verified_at) VALUES ('gi','google','google','g-sub','g@example.test',1)").run();
  const results = [];
  for (const email of ['nobody@example.test', 'g@example.test', 'shop@example.test']) {
    const response = await f.forgot(email);
    results.push([response.status, await response.text()]);
  }
  await f.flush();
  assert.deepEqual(results, Array(3).fill([200, '{"ok":true}']));
  assert.equal(f.emails.length, 0);
  const rows = f.sqlite.prepare('SELECT email_key, ip_key, user_id, token_hash FROM auth_password_resets').all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every(row => row.user_id === null && row.token_hash === null && row.email_key && row.ip_key));
});

test('forgot limits count unknown emails too: 3/email/hour and 10/IP/hour', async t => {
  const f = setup(t);
  for (let i = 0; i < 3; i++) assert.equal((await f.forgot('nobody@example.test')).status, 200);
  const fourth = await f.forgot('nobody@example.test');
  assert.equal(fourth.status, 429);
  assert.equal(fourth.headers.get('Retry-After'), '3600');
  assert.deepEqual(await fourth.json(), { error: 'ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่', retryAfter: 3600 });
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 3);
  assert.equal((await f.forgot('nobody@example.test')).status, 429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 3);
  for (let i = 0; i < 6; i++) assert.equal((await f.forgot(`other${i}@example.test`)).status, 200);
  assert.equal((await f.forgot('tenth@example.test')).status, 200);
  assert.equal((await f.forgot('overflow@example.test')).status, 429);
  assert.equal((await f.forgot('overflow@example.test')).status, 429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 10);
  assert.equal((await f.forgot('nobody@example.test', '203.0.113.2')).status, 429, 'email limit crosses IPs');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 10);
});

test('a limited request leaves the latest valid token untouched', async t => {
  const f = setup(t);
  await f.register();
  for (let i = 0; i < 3; i++) { assert.equal((await f.forgot()).status, 200); await f.flush(); }
  const token = f.tokenFromEmail();
  const hash = await sha256(token);
  assert.equal((await f.forgot()).status, 429);
  assert.equal((await f.forgot()).status, 429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 3);
  assert.equal(f.sqlite.prepare('SELECT used_at FROM auth_password_resets WHERE token_hash = ?').get(hash).used_at, null);
  assert.equal((await f.reset(token)).status, 200);
});

test('concurrent forgot requests cannot pass the limit together', async t => {
  const f = setup(t);
  await f.register();
  const statuses = (await Promise.all(Array.from({ length: 6 }, () => f.forgot()))).map(r => r.status);
  await f.flush();
  assert.deepEqual(statuses.toSorted(), [200, 200, 200, 429, 429, 429]);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 3);
  assert.equal(f.emails.length, 3, 'only accepted requests send email');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets WHERE used_at IS NULL').get().n, 1,
    'one live token, the others invalidated');
});

test('ten invalid tokens are counted per IP; 11th gets 429 and Retry-After', async t => {
  const f = setup(t);
  for (let i = 0; i < 10; i++) assert.equal((await f.reset(`bad-token-${i}`)).status, 400);
  const limited = await f.reset('also-bad');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '900');
  assert.match((await limited.json()).error, /15 นาที/);
  assert.equal(f.sqlite.prepare("SELECT COUNT(*) AS n FROM auth_password_attempts WHERE kind = 'login'").get().n, 10);
  assert.equal((await f.reset('also-bad', 'new-secret-456', '203.0.113.2')).status, 400);
});

test('provider availability, Origin and 4KB checks', async t => {
  const f = setup(t);
  assert.equal((await (await f.call('config')).json()).passwordReset, true);
  f.env.EMAIL_PROVIDER = 'off';
  assert.equal((await (await f.call('config')).json()).passwordReset, false);
  assert.deepEqual(await (await f.forgot()).json(), { error: 'ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อทีมงาน' });
  f.env.EMAIL_PROVIDER = 'mock';
  assert.equal((await f.forgot()).status, 503);
  f.env.APP_ORIGIN = 'http://127.0.0.1:8788';
  assert.equal((await (await f.call('config')).json()).passwordReset, true);
  f.env.APP_ORIGIN = 'https://naka.test';
  f.env.EMAIL_PROVIDER = 'resend';
  assert.equal((await f.call('password/forgot', { body: { email: 'shop@example.test' }, origin: 'https://other.test' })).status, 403);
  assert.equal((await f.call('password/reset', { body: { token: 'bad', newPassword: 'new-secret-456' }, origin: 'https://other.test' })).status, 403);
  assert.equal((await f.call('password/forgot', { raw: JSON.stringify({ email: 'shop@example.test', filler: 'x'.repeat(4096) }) })).status, 413);
  assert.equal((await f.call('password/reset', { raw: JSON.stringify({ token: 'bad', newPassword: 'x'.repeat(4096) }) })).status, 413);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_resets').get().n, 0);
});

test('Resend failure leaves a generic 200 and logs no email or token', async t => {
  const f = setup(t);
  await f.register();
  f.setDeliveryStatus(500);
  const logs = [];
  const log = mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  t.after(() => log.mock.restore());
  const response = await f.forgot();
  assert.equal(response.status, 200);
  await f.flush();
  const token = f.tokenFromEmail();
  assert.equal(logs.length, 1);
  assert.equal(logs[0].includes('shop@example.test'), false);
  assert.equal(logs[0].includes(token), false);
});

// The Cloudflare workerd + D1 runtime test moved to tests/postgres.integration.test.cjs (real PostgreSQL).

