// Email + password sign-up and sign-in (src/auth/password.ts) and the admin password reset.
const assert = require('node:assert/strict');
const { after, mock, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `password-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--esModuleInterop',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'pipe' });
const { handleAuth, requireUser } = require(path.join(buildDir, 'auth/index.js'));
const { hashPassword, verifyPassword, temporaryPassword } = require(path.join(buildDir, 'auth/password.js'));
const { handleAdminCustomers } = require(path.join(buildDir, 'admin/customers.js'));
const { getBalance } = require(path.join(buildDir, 'credits.js'));
mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external HTTP'); });
after(() => { mock.restoreAll(); rmSync(buildDir, { recursive: true, force: true }); });

const MIGRATIONS = ['0001_auth.sql', '0002_credits_jobs.sql', '0003_social.sql', '0004_plans.sql', '0007_payments.sql', '0008_receipts.sql',
  '0009_admin_audit.sql', '0010_stripe.sql', '0011_line_login.sql', '0012_password_login.sql', '0015_admin_audit_actor.sql'];

function setup(t, extra = {}) {
  const { sqlite, db } = migratedDb(...MIGRATIONS);
  sqlite.exec('PRAGMA foreign_keys = ON');
  t.after(() => sqlite.close());
  const env = { DB: db, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-secret-at-least-32-characters-long',
    SMS_PROVIDER: 'off', ADMIN_TOKEN: 'admin-token', ...extra };
  const post = (route, body, ip = '203.0.113.9') => {
    const url = new URL(`https://naka.test/api/auth/password/${route}`);
    return handleAuth(new Request(url, { method: 'POST', body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', Origin: 'https://naka.test', 'CF-Connecting-IP': ip } }), env, url);
  };
  const me = async (response) => {
    const cookie = response.headers.get('Set-Cookie').split(';')[0];
    return requireUser(new Request('https://naka.test/', { headers: { Cookie: cookie } }), env);
  };
  return { sqlite, db, env, post, me };
}

test('passwords are salted PBKDF2 hashes that verify only the right password', async () => {
  const a = await hashPassword('correct horse');
  const b = await hashPassword('correct horse');
  assert.match(a, /^pbkdf2-sha256\$100000\$[\w-]{22}\$[\w-]{43}$/);
  assert.notEqual(a, b, 'a fresh salt each time');
  assert.equal(await verifyPassword('correct horse', a), true);
  assert.equal(await verifyPassword('correct horsE', a), false);
  assert.equal(await verifyPassword('x', 'md5$1$a$b'), false);
  assert.match(temporaryPassword(), /^[a-hjkmnp-zA-HJ-NP-Z2-9]{12}$/);
});

test('sign up creates one account with a session and the signup bonus; the same email cannot sign up twice', async (t) => {
  const f = setup(t, { SIGNUP_CREDITS: '3' });
  const res = await f.post('register', { email: '  Shop@Example.COM ', password: 'secret-pass', name: 'ร้านนาคา' });
  assert.equal(res.status, 201);
  const user = await f.me(res);
  assert.equal(user.displayName, 'ร้านนาคา');
  assert.equal(user.email, 'shop@example.com');
  assert.equal(await getBalance(f.db, user.id), 3);
  const stored = f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash;
  assert.ok(!stored.includes('secret-pass'), 'never stored in plain text');

  const again = await f.post('register', { email: 'shop@example.com', password: 'another-pass' });
  assert.equal(again.status, 409);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(await getBalance(f.db, user.id), 3, 'no second bonus');
});

test('sign up rejects bad input and too many sign-ups from one IP', async (t) => {
  const f = setup(t);
  assert.equal((await f.post('register', { email: 'not-an-email', password: 'secret-pass' })).status, 400);
  assert.equal((await f.post('register', { email: 'a@b.co', password: 'short' })).status, 400);
  assert.equal((await f.post('register', { email: 'a@b.co', password: 'x'.repeat(129) })).status, 400);
  for (let i = 0; i < 5; i++) assert.equal((await f.post('register', { email: `s${i}@shop.co`, password: 'secret-pass' }, '198.51.100.7')).status, 201);
  assert.equal((await f.post('register', { email: 's9@shop.co', password: 'secret-pass' }, '198.51.100.7')).status, 429);
});

test('sign in works with the right password only, the same answer for unknown emails, and locks after 5 failures', async (t) => {
  const f = setup(t);
  await f.post('register', { email: 'shop@example.com', password: 'secret-pass' });
  const ok = await f.post('login', { email: 'SHOP@example.com', password: 'secret-pass' });
  assert.equal(ok.status, 200);
  assert.equal((await f.me(ok)).email, 'shop@example.com');

  const wrong = await f.post('login', { email: 'shop@example.com', password: 'wrong-pass' });
  const unknown = await f.post('login', { email: 'nobody@example.com', password: 'wrong-pass' });
  assert.equal(wrong.status, 401);
  assert.deepEqual(await wrong.json(), await unknown.json(), 'no hint whether the email exists');
  assert.equal(wrong.headers.get('Set-Cookie'), null);

  for (let i = 0; i < 4; i++) await f.post('login', { email: 'shop@example.com', password: 'wrong-pass' }, `192.0.2.${i}`);
  const locked = await f.post('login', { email: 'shop@example.com', password: 'secret-pass' });
  assert.equal(locked.status, 429, 'even the right password waits once the email is locked');
});

test('concurrent wrong passwords and sign-ups cannot pass the limits together; successful sign-ins do not count', async (t) => {
  const f = setup(t);
  await f.post('register', { email: 'shop@example.com', password: 'secret-pass' });
  for (let i = 0; i < 6; i++) assert.equal((await f.post('login', { email: 'shop@example.com', password: 'secret-pass' })).status, 200);

  const guesses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    f.post('login', { email: 'shop@example.com', password: `guess-${i}` }, `192.0.2.${i}`)));
  assert.deepEqual(guesses.map(r => r.status).toSorted(), [401, 401, 401, 401, 401, 429, 429, 429]);

  const signups = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    f.post('register', { email: `c${i}@shop.co`, password: 'secret-pass' }, '198.51.100.8')));
  assert.deepEqual(signups.map(r => r.status).toSorted(), [201, 201, 201, 201, 201, 429, 429, 429]);
});

test('a disabled account cannot sign in', async (t) => {
  const f = setup(t);
  const user = await f.me(await f.post('register', { email: 'shop@example.com', password: 'secret-pass' }));
  f.sqlite.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id);
  assert.equal((await f.post('login', { email: 'shop@example.com', password: 'secret-pass' })).status, 401);
});

test('admin reset gives a one-time password, signs every session out, and is audited without the password', async (t) => {
  const f = setup(t);
  const first = await f.post('register', { email: 'shop@example.com', password: 'forgotten-pass' });
  const user = await f.me(first);
  const url = new URL(`https://naka.test/api/admin/customers/${user.id}/password`);
  const reset = (body) => handleAdminCustomers(new Request(url, { method: 'POST', body: JSON.stringify(body),
    headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json', Origin: 'https://naka.test' } }), f.env, url);

  assert.equal((await reset({})).status, 400, 'a reason is required');
  const res = await reset({ note: 'ลูกค้าโทรมาแจ้งลืมรหัส' });
  assert.equal(res.status, 200);
  const { temporaryPassword: temp } = await res.json();
  assert.match(temp, /^[A-Za-z0-9]{12}$/);
  assert.equal(await f.me(first), null, 'old sessions are gone');
  assert.equal((await f.post('login', { email: 'shop@example.com', password: 'forgotten-pass' })).status, 401);
  assert.equal((await f.post('login', { email: 'shop@example.com', password: temp })).status, 200);
  const audit = f.sqlite.prepare("SELECT action, detail FROM admin_audit WHERE user_id = ?").get(user.id);
  assert.equal(audit.action, 'password');
  assert.ok(!audit.detail.includes(temp), 'the password is never written to the audit');

  // A Google-only customer has no password to reset.
  f.sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('g1', 'G', 0)").run();
  f.sqlite.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES ('gi', 'g1', 'google', 'sub', 'g@x.co', 0)").run();
  const gUrl = new URL('https://naka.test/api/admin/customers/g1/password');
  const g = await handleAdminCustomers(new Request(gUrl, { method: 'POST', body: JSON.stringify({ note: 'x' }),
    headers: { Authorization: 'Bearer admin-token', 'Content-Type': 'application/json' } }), f.env, gUrl);
  assert.equal(g.status, 400);
});

test('config advertises password sign-in and hides unconfigured methods', async (t) => {
  const f = setup(t);
  const url = new URL('https://naka.test/api/auth/config');
  const config = await (await handleAuth(new Request(url), f.env, url)).json();
  assert.deepEqual(config, { turnstileSiteKey: null, lineLogin: false, googleLogin: false, phoneLogin: false, passwordLogin: true, passwordReset: false });
});

test('password identities are allowed and the admin audit history keeps insertion order', () => {
  const { sqlite } = migratedDb();
  sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'x', 0)").run();
  sqlite.prepare("INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES ('i1','u1','password','x@example.test','x@example.test',0)").run();
  for (const id of ['c', 'a', 'b']) sqlite.prepare("INSERT INTO admin_audit (id, user_id, action, detail, note, created_at) VALUES (?, 'u1', 'credits', '{}', 'n', 5)").run(id);
  assert.deepEqual(sqlite.prepare('SELECT id FROM admin_audit ORDER BY rowid').all().map((r) => r.id), ['c', 'a', 'b']);
});

