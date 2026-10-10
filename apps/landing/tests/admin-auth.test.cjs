const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readdirSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `admin-auth-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const migrations = readdirSync(path.join(root, 'migrations')).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
const ORIGIN = 'https://naka.test';
const TOKEN = 'test-only-admin-token';
const now = () => Math.floor(Date.now() / 1000);
const sha = value => createHash('sha256').update(value).digest('base64url');
let sqlite, db, env, http;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...migrations));
  env = { DB: db, ADMIN_TOKEN: TOKEN, ADMIN_EMAILS: 'Owner@Naka.test, second@naka.test', APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40),
    GOOGLE_CLIENT_ID: '1-test.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'google-secret', ASSETS: { fetch: async () => new Response('asset') } };
  http = mock.method(globalThis, 'fetch', async () => { throw new Error('no external requests'); });
});
afterEach(() => { sqlite.close(); http.mock.restore(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

let counter = 0;
/** A user with the given identities and a session created `age` seconds ago; returns its cookie. */
function signedIn({ email = 'owner@naka.test', provider = 'google', age = 60, status = 'active' } = {}) {
  const id = 'u' + ++counter;
  const token = String(counter).padStart(43, 'a');
  sqlite.prepare('INSERT INTO users (id, display_name, created_at, status) VALUES (?, ?, ?, ?)').run(id, 'ผู้ใช้', now(), status);
  sqlite.prepare('INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('i' + counter, id, provider, provider + counter, email, now());
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha(token), id, now() + 86400 * 30, now() - age);
  return 'naka_session=' + token;
}
const site = (pathname, init = {}) => worker.fetch(new Request(ORIGIN + pathname, init), env, { waitUntil() {} });
const me = headers => site('/api/admin/me', { headers });
const write = (headers, value = '5') => site('/api/admin/system/settings/SIGNUP_CREDITS', { method: 'PUT',
  headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ value }) });

test('an allowed Google account with a recent sign-in is an admin; the panel records its email', async () => {
  const cookie = signedIn();
  const response = await me({ Cookie: cookie });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { kind: 'google', label: 'owner@naka.test', role: 'owner' });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await write({ Cookie: cookie, Origin: ORIGIN })).status, 200);
  assert.equal(sqlite.prepare('SELECT actor FROM system_audit').get().actor, 'owner@naka.test');
  // Customer changes record the admin too.
  sqlite.prepare("INSERT INTO users (id, display_name, created_at) VALUES ('c1', 'ลูกค้า', 1)").run();
  const grant = await site('/api/admin/customers/c1/credits', { method: 'POST',
    headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: 5, note: 'ทดสอบ' }) });
  assert.equal(grant.status, 200);
  assert.equal(sqlite.prepare("SELECT actor FROM admin_audit WHERE user_id = 'c1'").get().actor, 'owner@naka.test');
});

test('other accounts, password accounts, disabled users and stale sessions are refused', async () => {
  const cases = [
    [signedIn({ email: 'customer@example.test' }), 403, 'not_admin'],
    [signedIn({ email: 'owner@naka.test', provider: 'password' }), 403, 'not_admin'], // only Google-verified addresses count
    [signedIn({ age: 13 * 3600 }), 401, 'reauth'],
    [signedIn({ status: 'disabled' }), 401, 'signin'],
    ['naka_session=' + 'z'.repeat(43), 401, 'signin'],
    ['', 401, 'signin'],
  ];
  for (const [cookie, status, reason] of cases) {
    const response = await me(cookie ? { Cookie: cookie } : {});
    assert.equal(response.status, status, reason);
    assert.equal((await response.json()).reason, reason);
    assert.equal((await write({ Cookie: cookie, Origin: ORIGIN })).status, status);
  }
  env.ADMIN_EMAILS = '';
  assert.equal((await me({ Cookie: signedIn() })).status, 403);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM system_settings').get().n, 0);
});

test('a session-authenticated write must come from our own origin', async () => {
  const cookie = signedIn();
  for (const headers of [{}, { Origin: 'https://evil.test' }, { Origin: ORIGIN, 'Sec-Fetch-Site': 'cross-site' }]) {
    const response = await write({ Cookie: cookie, ...headers });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).reason, 'origin');
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM system_settings').get().n, 0);
  assert.equal((await site('/api/admin/system/settings', { headers: { Cookie: cookie } })).status, 200); // reads need no Origin
});

test('ADMIN_TOKEN still works as the break-glass; a wrong token never falls back to the session', async () => {
  const token = await me({ Authorization: 'Bearer ' + TOKEN });
  assert.deepEqual(await token.json(), { kind: 'token', label: 'โทเคนฉุกเฉิน', role: 'owner' });
  assert.equal((await write({ Authorization: 'Bearer ' + TOKEN })).status, 200); // bearer is not a cookie: no Origin needed
  assert.equal(sqlite.prepare('SELECT actor FROM system_audit').get().actor, 'โทเคนฉุกเฉิน');
  const cookie = signedIn();
  assert.equal((await me({ Authorization: 'Bearer wrong', Cookie: cookie })).status, 401);
  assert.equal((await me({ Authorization: 'Bearer ', Cookie: cookie })).status, 200); // empty bearer = no token stored
  env.ADMIN_TOKEN = '';
  assert.equal((await me({ Authorization: 'Bearer ' })).status, 401);
  assert.equal((await me({ Authorization: 'Bearer anything' })).status, 401);
});

test('Google sign-in returns to an admin page only, and still works during maintenance', async () => {
  sqlite.prepare("INSERT INTO system_settings (key, value, secret, hint, updated_at) VALUES ('FEATURE_MAINTENANCE', 'on', 0, NULL, 1)").run();
  assert.equal((await site('/api/works')).status, 503);
  const start = async next => {
    const response = await site('/api/auth/google/start' + (next === undefined ? '' : '?next=' + encodeURIComponent(next)));
    assert.equal(response.status, 302);
    const cookies = response.headers.getSetCookie();
    return { state: new URL(response.headers.get('Location')).searchParams.get('state'), cookies,
      cookie: cookies.map(c => c.split(';')[0]).filter(c => !c.endsWith('=')).join('; ') };
  };
  for (const bad of ['//evil.test/admin/', 'https://evil.test/admin/', '/app/', '/admin/../app/', '/admin/system', '/admin/system/?x=1']) {
    const flow = await start(bad);
    assert.ok(flow.cookies.some(c => c.startsWith('naka_oauth_next=;') && c.includes('Max-Age=0')), bad);
  }
  http.mock.mockImplementation(async url => url === 'https://oauth2.googleapis.com/token'
    ? Response.json({ access_token: 'server-issued-access-token', token_type: 'Bearer' })
    : Response.json({ sub: 'google-owner', email: 'owner@naka.test', email_verified: true, name: 'เจ้าของ' }));
  const flow = await start('/admin/system/');
  assert.ok(flow.cookie.includes('naka_oauth_next=%2Fadmin%2Fsystem%2F'));
  const done = await site(`/api/auth/google/callback?state=${flow.state}&code=test-code`, { headers: { Cookie: flow.cookie } });
  assert.equal(done.status, 302);
  assert.equal(done.headers.get('Location'), ORIGIN + '/admin/system/');
  const session = done.headers.getSetCookie().find(c => c.startsWith('naka_session=')).split(';')[0];
  assert.deepEqual(await (await me({ Cookie: session })).json(), { kind: 'google', label: 'owner@naka.test', role: 'owner' });
  // A customer sign-in still lands on /app/.
  const plain = await start();
  const customer = await site(`/api/auth/google/callback?state=${plain.state}&code=test-code`, { headers: { Cookie: plain.cookie } });
  assert.equal(customer.headers.get('Location'), ORIGIN + '/app/');
  // A failed admin sign-in goes back to the admin page with an error.
  const failed = await start('/admin/customers/');
  const error = await site(`/api/auth/google/callback?state=${'x'.repeat(43)}&code=test-code`, { headers: { Cookie: failed.cookie } });
  assert.equal(error.headers.get('Location'), ORIGIN + '/admin/customers/?error=google');
});
