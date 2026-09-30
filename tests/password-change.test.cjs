const assert = require('node:assert/strict');
const { after, mock, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions } = require('miniflare');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `password-change-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--esModuleInterop',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'inherit' });
const { handleAuth, requireUser } = require(path.join(buildDir, 'auth/index.js'));
const { handleAdminCustomers } = require(path.join(buildDir, 'admin/customers.js'));
const { createSession, getUser } = require(path.join(buildDir, 'auth/session.js'));
const { verifyPassword } = require(path.join(buildDir, 'auth/password.js'));
mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external HTTP'); });
after(() => { mock.restoreAll(); rmSync(buildDir, { recursive: true, force: true }); });

const MIGRATIONS = ['0001_auth.sql', '0002_credits_jobs.sql', '0003_social.sql', '0004_plans.sql', '0007_payments.sql',
  '0008_receipts.sql', '0009_admin_audit.sql', '0010_stripe.sql', '0011_line_login.sql', '0012_password_login.sql'];

function setup(t) {
  const { sqlite, db } = migratedDb(...MIGRATIONS);
  sqlite.exec('PRAGMA foreign_keys = ON');
  t.after(() => sqlite.close());
  const env = { DB: db, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-secret-at-least-32-characters-long', SMS_PROVIDER: 'off' };
  const call = (route, { body, cookie, origin = 'https://naka.test', raw, contentType = 'application/json' } = {}) => {
    const url = new URL(`https://naka.test/api/auth/${route}`);
    const request = new Request(url, { method: body === undefined && raw === undefined ? 'GET' : 'POST',
      headers: { ...(body !== undefined || raw !== undefined ? { Origin: origin, 'Content-Type': contentType } : {}),
        ...(cookie ? { Cookie: cookie } : {}) },
      ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return handleAuth(request, env, url);
  };
  const register = () => call('password/register', { body: { email: 'shop@example.test', password: 'old-secret-123' } });
  const change = (cookie, currentPassword = 'old-secret-123', newPassword = 'new-secret-456') =>
    call('password/change', { cookie, body: { currentPassword, newPassword } });
  return { sqlite, db, env, call, register, change };
}

const cookieOf = (response) => response.headers.getSetCookie().find(value => value.startsWith('naka_session=')).split(';')[0];
const signedIn = (f, cookie) => requireUser(new Request('https://naka.test/api/auth/me', { headers: { Cookie: cookie } }), f.env);

test('changing password replaces every session in one batch; old password fails and new password works', async t => {
  const f = setup(t);
  const first = cookieOf(await f.register());
  const second = cookieOf(await f.call('password/login', { body: { email: 'shop@example.test', password: 'old-secret-123' } }));
  const user = await signedIn(f, first);
  assert.notEqual(first, second);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 2);

  const changed = await f.change(first);
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), { ok: true });
  const current = cookieOf(changed);
  assert.notEqual(current, first);
  assert.match(changed.headers.get('Set-Cookie'), /HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000; Secure/);
  assert.equal(await signedIn(f, first), null);
  assert.equal(await signedIn(f, second), null);
  assert.equal((await signedIn(f, current)).id, user.id);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 1);
  const stored = f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash;
  assert.equal(await verifyPassword('old-secret-123', stored), false);
  assert.equal(await verifyPassword('new-secret-456', stored), true);
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: 'old-secret-123' } })).status, 401);
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: 'new-secret-456' } })).status, 200);
});

test('a customer can replace an admin-issued temporary password', async t => {
  const f = setup(t);
  f.env.ADMIN_TOKEN = 'admin-token';
  const first = cookieOf(await f.register());
  const user = await signedIn(f, first);
  const url = new URL(`https://naka.test/api/admin/customers/${user.id}/password`);
  const reset = await handleAdminCustomers(new Request(url, { method: 'POST',
    headers: { Authorization: 'Bearer admin-token', Origin: 'https://naka.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ note: 'ลูกค้าขอรหัสชั่วคราว' }),
  }), f.env, url);
  assert.equal(reset.status, 200);
  const { temporaryPassword } = await reset.json();
  assert.equal(await signedIn(f, first), null);
  const signedInAgain = await f.call('password/login', { body: { email: 'shop@example.test', password: temporaryPassword } });
  assert.equal(signedInAgain.status, 200);
  const changed = await f.change(cookieOf(signedInAgain), temporaryPassword, 'my-own-password-456');
  assert.equal(changed.status, 200);
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: temporaryPassword } })).status, 401);
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: 'my-own-password-456' } })).status, 200);
});

test('wrong current password is rejected, counted in the existing login limit, and never changes sessions', async t => {
  const f = setup(t);
  const cookie = cookieOf(await f.register());
  const user = await signedIn(f, cookie);
  const before = f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash;
  const response = await f.change(cookie, 'wrong-secret');
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_attempts WHERE kind = ?').get('login').n, 2);
  assert.equal(f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash, before);
  assert.ok(await signedIn(f, cookie));
});

test('short, long and reused new passwords are rejected without revoking sessions', async t => {
  const f = setup(t);
  const cookie = cookieOf(await f.register());
  const user = await signedIn(f, cookie);
  const before = f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash;
  for (const next of ['short', 'x'.repeat(129), 'old-secret-123']) {
    const response = await f.change(cookie, 'old-secret-123', next);
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /รหัสผ่าน/);
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
  assert.equal(f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash, before);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_attempts WHERE kind = ?').get('login').n, 0);
});

test('Google or LINE account has no password form; unauthenticated caller gets 401', async t => {
  const f = setup(t);
  assert.equal((await f.change('')).status, 401);
  assert.deepEqual(await (await f.change('')).json(), { error: 'กรุณาเข้าสู่ระบบ' });
  for (const provider of ['google', 'line']) {
    const id = `${provider}-user`;
    f.sqlite.prepare('INSERT INTO users (id,display_name,created_at) VALUES (?,?,?)').run(id, provider, 1);
    f.sqlite.prepare('INSERT INTO auth_identities (id,user_id,provider,provider_uid,email,verified_at) VALUES (?,?,?,?,?,?)')
      .run(`${provider}-identity`, id, provider, `${provider}-sub`, provider === 'google' ? 'same@example.test' : null, 1);
    const user = await getUser(f.db, id);
    const cookie = (await createSession(new Request('https://naka.test/'), f.env, user)).split(';')[0];
    const response = await f.change(cookie);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'บัญชีนี้เข้าสู่ระบบด้วย Google หรือ LINE จึงไม่มีรหัสผ่าน' });
    assert.equal(response.headers.get('Set-Cookie'), null);
  }
});

test('five failed current-password attempts return 429 with Retry-After and share login attempts', async t => {
  const f = setup(t);
  const cookie = cookieOf(await f.register());
  for (let i = 0; i < 4; i++) assert.equal((await f.change(cookie, 'wrong-secret')).status, 400);
  const fifth = await f.change(cookie, 'wrong-secret');
  assert.equal(fifth.status, 429);
  assert.equal(fifth.headers.get('Retry-After'), '900');
  assert.match((await fifth.json()).error, /15 นาที/);
  assert.equal((await f.change(cookie)).status, 429, 'even the right current password waits');
  assert.equal((await f.call('password/login', { body: { email: 'shop@example.test', password: 'old-secret-123' } })).status, 429);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_password_attempts WHERE kind = ?').get('login').n, 10);
});

test('GET /me reports hasPassword accurately and keeps signed-out response unchanged', async t => {
  const f = setup(t);
  const cookie = cookieOf(await f.register());
  const withPassword = await f.call('me', { cookie });
  assert.equal(withPassword.status, 200);
  assert.equal((await withPassword.json()).hasPassword, true);
  f.sqlite.prepare("INSERT INTO users (id,display_name,created_at) VALUES ('g1','Google',1)").run();
  f.sqlite.prepare("INSERT INTO auth_identities (id,user_id,provider,provider_uid,email,verified_at) VALUES ('gi','g1','google','google-sub','same@example.test',1)").run();
  const google = await getUser(f.db, 'g1');
  const googleCookie = (await createSession(new Request('https://naka.test/'), f.env, google)).split(';')[0];
  assert.equal((await (await f.call('me', { cookie: googleCookie })).json()).hasPassword, false);
  const signedOut = await f.call('me');
  assert.equal(signedOut.status, 401);
  assert.deepEqual(await signedOut.json(), { error: 'กรุณาเข้าสู่ระบบ' });
});

test('Origin and JSON size checks reject requests before mutation', async t => {
  const f = setup(t);
  const cookie = cookieOf(await f.register());
  const body = { currentPassword: 'old-secret-123', newPassword: 'new-secret-456' };
  assert.equal((await f.call('password/change', { body, cookie, origin: 'https://other.test' })).status, 403);
  assert.equal((await f.call('password/change', { body, cookie, contentType: 'text/plain' })).status, 400);
  assert.equal((await f.call('password/change', { body: { ...body, filler: 'x'.repeat(4096) }, cookie })).status, 413);
  assert.ok(await signedIn(f, cookie));
  const user = await signedIn(f, cookie);
  assert.equal(await verifyPassword('old-secret-123', f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash), true);
});

test('a failed replacement-session insert rolls back the hash and session deletions', async t => {
  const f = setup(t);
  const cookie = cookieOf(await f.register());
  const user = await signedIn(f, cookie);
  const before = f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash;
  f.sqlite.exec(`CREATE TRIGGER fail_new_session BEFORE INSERT ON sessions
    WHEN NEW.user_id = '${user.id}' BEGIN SELECT RAISE(ABORT, 'test insert failure'); END`);
  const response = await f.change(cookie);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Set-Cookie'), null);
  assert.equal(f.sqlite.prepare('SELECT hash FROM auth_passwords WHERE user_id = ?').get(user.id).hash, before);
  assert.ok(await signedIn(f, cookie));
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user.id).n, 1);
});

test('Cloudflare workerd and real D1 retain the new session after password change', { timeout: 60000 }, async () => {
  const bundled = await build({ stdin: { contents: "export { default } from './src/index';", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  const options = { modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-01',
    d1Databases: ['DB'], cf: false,
    bindings: { APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-only-secret-at-least-32-characters', SMS_PROVIDER: 'off' },
  };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const db = await mf.getD1Database('DB');
    for (const file of MIGRATIONS) {
      const sql = readFileSync(path.join(root, 'migrations', file), 'utf8').replace(/--[^\r\n]*/g, '');
      for (const statement of sql.split(';').map(part => part.trim()).filter(Boolean)) await db.prepare(statement).run();
    }
    const call = (route, body, cookie) => mf.dispatchFetch(`https://naka.test/api/auth/${route}`, {
      method: body ? 'POST' : 'GET', redirect: 'manual',
      headers: { Origin: 'https://naka.test', 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const registered = await call('password/register', { email: 'runtime@example.test', password: 'old-secret-123' });
    assert.equal(registered.status, 201, await registered.clone().text());
    const oldCookie = cookieOf(registered);
    const before = await call('me', undefined, oldCookie);
    assert.equal(before.status, 200);
    assert.equal((await before.json()).hasPassword, true);
    const changed = await call('password/change', { currentPassword: 'old-secret-123', newPassword: 'new-secret-456' }, oldCookie);
    assert.equal(changed.status, 200, await changed.clone().text());
    const newCookie = cookieOf(changed);
    assert.equal((await call('me', undefined, oldCookie)).status, 401);
    assert.equal((await call('me', undefined, newCookie)).status, 200);
    assert.equal((await call('password/login', { email: 'runtime@example.test', password: 'old-secret-123' })).status, 401);
    assert.equal((await call('password/login', { email: 'runtime@example.test', password: 'new-secret-456' })).status, 200);
  } finally { await mf.dispose(); }
});
