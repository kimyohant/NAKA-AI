// naka-studio single sign-on: GET /api/sso/studio/authorize → one-time code → POST /api/sso/studio/token
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readdirSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `studio-sso-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const migrations = readdirSync(path.join(root, 'migrations')).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
const ORIGIN = 'https://naka.test';
const STUDIO = 'https://studio.naka.test';
const SECRET = 'test-only-studio-sso-secret-0123456789';
const now = () => Math.floor(Date.now() / 1000);
const sha = value => createHash('sha256').update(value).digest('base64url');
const STATE = 'state-abcdefghijklmnop';
let sqlite, db, env, http;

beforeEach(() => {
  ({ sqlite, db } = migratedDb(...migrations));
  env = { DB: db, ADMIN_EMAILS: 'owner@naka.test', APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40),
    STUDIO_URL: STUDIO, STUDIO_SSO_SECRET: SECRET, ASSETS: { fetch: async () => new Response('asset') } };
  http = mock.method(globalThis, 'fetch', async () => { throw new Error('no external requests'); });
});
afterEach(() => { sqlite.close(); http.mock.restore(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

let counter = 0;
function signedIn({ email = 'owner@naka.test', provider = 'google' } = {}) {
  const id = 'u' + ++counter;
  const token = String(counter).padStart(43, 'a');
  sqlite.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(id, 'ร้าน ' + counter, now());
  sqlite.prepare('INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('i' + counter, id, provider, provider + counter, email, now());
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha(token), id, now() + 86400, now());
  return { id, cookie: 'naka_session=' + token };
}
const site = (pathname, init = {}) => worker.fetch(new Request(ORIGIN + pathname, init), env, { waitUntil() {} });
const authorize = (cookie, state = STATE) => site('/api/sso/studio/authorize?state=' + state, { headers: cookie ? { Cookie: cookie } : {} });
const redeem = (code, secret = SECRET) => site('/api/sso/studio/token', {
  method: 'POST', headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
const codeFrom = res => new URL(res.headers.get('Location')).searchParams.get('code');

test('signed-out members are sent to login and come back to authorize', async () => {
  const res = await authorize(null);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('Location'), '/login/?next=' + encodeURIComponent('/api/sso/studio/authorize?state=' + STATE));
});

test('admin gets a one-time code on the studio callback; the code works once with the shared secret', async () => {
  const { id, cookie } = signedIn();
  const res = await authorize(cookie);
  assert.equal(res.status, 302);
  const back = new URL(res.headers.get('Location'));
  assert.equal(back.origin + back.pathname, STUDIO + '/api/v1/auth/naka/callback');
  assert.equal(back.searchParams.get('state'), STATE);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const code = codeFrom(res);
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM studio_sso_codes WHERE code_hash = ?').get(sha(code)).n, 1, 'stored hashed');

  assert.equal((await redeem(code, 'wrong-secret-wrong-secret-wrong-secret')).status, 401);
  const ok = await redeem(code);
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { user: { id, displayName: 'ร้าน ' + counter, email: 'owner@naka.test' }, admin: true });
  assert.equal((await redeem(code)).status, 400, 'a code is single use');
});

test('STUDIO_ACCESS defaults to admins: other members are turned back to /app/', async () => {
  const { cookie } = signedIn({ email: 'shop@example.test', provider: 'password' });
  const res = await authorize(cookie);
  assert.equal(res.headers.get('Location'), '/app/?studio=denied');
  // a password account using the admin address is not an admin (Google must have verified it)
  const lookalike = signedIn({ email: 'owner@naka.test', provider: 'password' });
  assert.equal((await authorize(lookalike.cookie)).headers.get('Location'), '/app/?studio=denied');
});

test('members mode lets every member in, without the admin flag', async () => {
  env.STUDIO_ACCESS = 'members';
  const { cookie } = signedIn({ email: 'shop@example.test', provider: 'password' });
  const ok = await redeem(codeFrom(await authorize(cookie)));
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).admin, false);
});

test('access is checked again at redemption', async () => {
  env.STUDIO_ACCESS = 'members';
  const { cookie } = signedIn({ email: 'shop@example.test', provider: 'password' });
  const code = codeFrom(await authorize(cookie));
  env.STUDIO_ACCESS = 'admins';
  assert.equal((await redeem(code)).status, 403);
});

test('expired codes, bad state and missing configuration are refused', async () => {
  const { cookie } = signedIn();
  const code = codeFrom(await authorize(cookie));
  sqlite.prepare('UPDATE studio_sso_codes SET expires_at = ?').run(now() - 1);
  assert.equal((await redeem(code)).status, 400);
  assert.equal((await authorize(cookie, 'short')).status, 400);

  env.STUDIO_URL = 'http://studio.naka.test'; // plain http off localhost is refused
  assert.equal((await authorize(cookie)).headers.get('Location'), '/app/?studio=off');
  env.STUDIO_URL = STUDIO;
  env.STUDIO_ACCESS = 'off';
  assert.equal((await authorize(cookie)).headers.get('Location'), '/app/?studio=off');
  env.STUDIO_ACCESS = 'admins';
  env.STUDIO_SSO_SECRET = 'too-short';
  assert.equal((await redeem('a'.repeat(43), 'too-short')).status, 503);
});

test('/api/auth/me carries the studio link only for members who may open it', async () => {
  const admin = signedIn();
  const shop = signedIn({ email: 'shop@example.test', provider: 'password' });
  const me = cookie => site('/api/auth/me', { headers: { Cookie: cookie } }).then(r => r.json());
  assert.deepEqual((await me(admin.cookie)).studio, { url: STUDIO + '/' });
  assert.equal((await me(shop.cookie)).studio, undefined);
  env.STUDIO_URL = '';
  assert.equal((await me(admin.cookie)).studio, undefined);
});
