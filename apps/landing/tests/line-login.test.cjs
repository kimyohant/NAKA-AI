const assert = require('node:assert/strict');
const { after, beforeEach, mock, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `line-login-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'inherit' });
const { handleAuth, requireUser } = require(path.join(buildDir, 'auth/index.js'));
const { identityUser } = require(path.join(buildDir, 'auth/session.js'));
const { sha256 } = require(path.join(buildDir, 'auth/common.js'));
const fetchMock = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external HTTP'); });
after(() => { mock.restoreAll(); rmSync(buildDir, { recursive: true, force: true }); });
beforeEach(() => fetchMock.mock.resetCalls());

function setup(t, overrides = {}) {
  const { sqlite, db } = migratedDb('0001_auth.sql', '0002_credits_jobs.sql', '0011_line_login.sql');
  sqlite.exec('PRAGMA foreign_keys = ON');
  t.after(() => sqlite.close());
  const env = { DB: db, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-secret-at-least-32-characters-long',
    LINE_LOGIN_CHANNEL_ID: 'line-channel-123', LINE_LOGIN_CHANNEL_SECRET: 'line-secret-test', ...overrides };
  const call = (route, cookie) => {
    const url = new URL(`https://naka.test/api/auth/${route}`);
    return handleAuth(new Request(url, { headers: cookie ? { Cookie: cookie } : {} }), env, url);
  };
  return { sqlite, db, env, call };
}

async function start(f) {
  const response = await f.call('line/start');
  const url = new URL(response.headers.get('Location'));
  const state = url.searchParams.get('state');
  const nonce = url.searchParams.get('nonce');
  const cookie = response.headers.get('Set-Cookie').split(';')[0];
  return { response, url, state, nonce, cookie };
}

function callback(f, flow, extra = '', cookie = flow.cookie) {
  return f.call(`line/callback?state=${flow.state}&code=auth-code${extra}`, cookie);
}

function mockLine(flow, profile = {}) {
  fetchMock.mock.mockImplementation(async (url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    const body = new URLSearchParams(init.body);
    if (url === 'https://api.line.me/oauth2/v2.1/token') {
      assert.equal(body.get('grant_type'), 'authorization_code');
      assert.equal(body.get('code'), 'auth-code');
      assert.equal(body.get('redirect_uri'), 'https://naka.test/api/auth/line/callback');
      assert.equal(body.get('client_id'), 'line-channel-123');
      assert.equal(body.get('client_secret'), 'line-secret-test');
      assert.match(body.get('code_verifier'), /^[A-Za-z0-9_-]{43}$/);
      return Response.json({ id_token: 'signed-id-token', token_type: 'Bearer' });
    }
    assert.equal(url, 'https://api.line.me/oauth2/v2.1/verify');
    assert.equal(body.get('id_token'), 'signed-id-token');
    assert.equal(body.get('client_id'), 'line-channel-123');
    assert.equal(body.get('nonce'), flow.nonce);
    return Response.json({ iss: 'https://access.line.me', aud: 'line-channel-123',
      sub: 'Uline-user-1', exp: Math.floor(Date.now() / 1000) + 3600, nonce: flow.nonce,
      name: 'ร้านทดสอบ', ...profile });
  });
}

test('start uses the documented LINE v2.1 URL, state cookie, PKCE S256 and exact callback', async t => {
  const f = setup(t);
  const flow = await start(f);
  assert.equal(flow.response.status, 302);
  assert.equal(flow.url.origin, 'https://access.line.me');
  assert.equal(flow.url.pathname, '/oauth2/v2.1/authorize');
  assert.equal(flow.url.searchParams.get('response_type'), 'code');
  assert.equal(flow.url.searchParams.get('client_id'), 'line-channel-123');
  assert.equal(flow.url.searchParams.get('redirect_uri'), 'https://naka.test/api/auth/line/callback');
  assert.equal(flow.url.searchParams.get('scope'), 'openid profile');
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  assert.match(flow.state, /^[a-f0-9]{64}$/);
  assert.match(flow.nonce, /^[a-f0-9]{64}$/);
  assert.match(flow.response.headers.get('Set-Cookie'), /naka_line_state=.*HttpOnly; SameSite=Lax; Path=\/; Max-Age=600; Secure/);
  const row = f.sqlite.prepare('SELECT id, verifier, expires_at FROM auth_oauth_states').get();
  const stored = JSON.parse(row.verifier);
  assert.equal(row.id, await sha256(flow.state));
  assert.equal(stored.nonce, flow.nonce);
  assert.equal(flow.url.searchParams.get('code_challenge'), await sha256(stored.verifier));
  assert.ok(row.expires_at > Math.floor(Date.now() / 1000));
  assert.equal(fetchMock.mock.callCount(), 0);
  const missing = setup(t, { LINE_LOGIN_CHANNEL_ID: undefined });
  const unavailable = await missing.call('line/start');
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /LINE/);
});

test('callback verifies ID token server-side, creates a session, and reuses the LINE account', async t => {
  const f = setup(t);
  const flow = await start(f);
  mockLine(flow);
  const first = await callback(f, flow);
  assert.equal(first.headers.get('Location'), 'https://naka.test/app/');
  assert.equal(first.headers.get('Cache-Control'), 'no-store');
  const session = first.headers.getSetCookie().find(v => v.startsWith('naka_session='));
  assert.ok(session);
  assert.match(first.headers.getSetCookie().find(v => v.startsWith('naka_line_state=')), /Max-Age=0/);
  const user = await requireUser(new Request('https://naka.test/api/auth/me', { headers: { Cookie: session.split(';')[0] } }), f.env);
  assert.equal(user.displayName, 'ร้านทดสอบ');
  assert.equal(user.email, null);
  assert.equal(f.sqlite.prepare('SELECT provider_uid FROM auth_identities WHERE provider = ?').get('line').provider_uid, 'Uline-user-1');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_states').get().n, 0);
  assert.equal(fetchMock.mock.callCount(), 2);

  const again = await start(f);
  mockLine(again);
  const second = await callback(f, again);
  assert.equal(second.headers.get('Location'), 'https://naka.test/app/');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_identities WHERE provider = ?').get('line').n, 1);
});

test('state mismatch, missing cookie, duplicate callback, expiry and provider denial never create a session', async t => {
  const f = setup(t);
  let flow = await start(f);
  const badState = await f.call(`line/callback?state=${'0'.repeat(64)}&code=auth-code`, flow.cookie);
  assert.equal(badState.headers.get('Location'), 'https://naka.test/login/?error=line');
  assert.equal(fetchMock.mock.callCount(), 0);
  const noCookie = await callback(f, flow, '', '');
  assert.equal(noCookie.headers.get('Location'), 'https://naka.test/login/?error=line');
  mockLine(flow);
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/app/');
  const replay = await callback(f, flow);
  assert.equal(replay.headers.get('Location'), 'https://naka.test/login/?error=line');
  assert.equal(fetchMock.mock.callCount(), 2);
  flow = await start(f);
  f.sqlite.prepare('UPDATE auth_oauth_states SET expires_at = 0').run();
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/login/?error=line');
  flow = await start(f);
  assert.equal((await callback(f, flow, '&error=access_denied')).headers.get('Location'), 'https://naka.test/login/?error=line');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM auth_oauth_states').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
});

test('failed ID-token verification or wrong claims redirects without a session or leaked detail', async t => {
  const f = setup(t);
  let flow = await start(f);
  fetchMock.mock.mockImplementation(async (url) => url.endsWith('/token')
    ? Response.json({ id_token: 'signed-id-token', token_type: 'Bearer' })
    : Response.json({ error_description: 'provider secret' }, { status: 400 }));
  const rejected = await callback(f, flow);
  assert.equal(rejected.headers.get('Location'), 'https://naka.test/login/?error=line');
  assert.doesNotMatch(JSON.stringify([...rejected.headers]), /provider secret|signed-id-token/);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);

  for (const claims of [
    { iss: 'https://evil.example' }, { aud: 'other-channel' },
    { exp: 0 }, { nonce: 'wrong' }, { sub: '' },
  ]) {
    flow = await start(f);
    mockLine(flow, claims);
    const response = await callback(f, flow);
    assert.equal(response.headers.get('Location'), 'https://naka.test/login/?error=line');
  }
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0);
});

test('matching Google and LINE names or emails remain separate identities', async t => {
  const f = setup(t);
  const google = await identityUser(f.env, 'google', 'google-sub', 'ร้านทดสอบ', 'same@example.test');
  const flow = await start(f);
  mockLine(flow, { email: 'same@example.test' });
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/app/');
  const line = f.sqlite.prepare("SELECT user_id, email FROM auth_identities WHERE provider = 'line'").get();
  assert.notEqual(line.user_id, google.id);
  assert.equal(line.email, null);
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
});

test('identities: one row per provider account, LINE allowed, indexed by user, tied to an existing user', () => {
  const { sqlite } = migratedDb();
  sqlite.exec("INSERT INTO users (id,display_name,created_at) VALUES ('u1','ร้าน',1),('u2','ร้าน',2)");
  sqlite.exec("INSERT INTO auth_identities (id,user_id,provider,provider_uid,email,verified_at) VALUES ('p','u1','phone','+66812345678',NULL,1),('g','u2','google','google-sub','same@example.test',2)");
  assert.throws(() => sqlite.exec("INSERT INTO auth_identities VALUES ('duplicate','u2','phone','+66812345678',NULL,3)"), /unique/);
  sqlite.exec("INSERT INTO auth_identities VALUES ('line','u1','line','Uline-user-1',NULL,3)");
  assert.throws(() => sqlite.exec("INSERT INTO auth_identities VALUES ('orphan','nobody','line','Uline-user-2',NULL,3)"), /foreign key/);
  assert.ok(sqlite.prepare("SELECT 1 FROM pg_indexes WHERE schemaname = current_schema() AND indexname = 'idx_auth_identities_user'").get());
});

test('login page shows LINE only when config explicitly enables it and explains LINE callback errors', async () => {
  const html = readFileSync(path.join(root, 'public/login/index.html'), 'utf8');
  assert.ok(html.indexOf('id="line-button"') < html.indexOf('id="google-button"'));
  assert.match(html, /id="line-button"[^>]*hidden/);
  async function page(config, search = '') {
    class Element { constructor() { this.hidden = true; this.listeners = {}; this.textContent = ''; } addEventListener(name, fn) { this.listeners[name] = fn; } }
    const nodes = new Map();
    const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement: () => new Element(), head: { appendChild() {} } };
    vm.runInNewContext(readFileSync(path.join(root, 'public/login/login.js'), 'utf8'), {
      window: { NakaAuth: { safeNext: () => '/app/', mockMode: () => false, me: async () => ({ status: 'signed-out' }) } },
      document, location: { search }, URLSearchParams, Date,
      fetch: async () => Response.json(config), clearInterval() {}, setInterval() {},
    });
    await new Promise(resolve => setImmediate(resolve));
    return document;
  }
  assert.equal((await page({ lineLogin: true })).getElementById('line-button').hidden, false);
  assert.equal((await page({ turnstileSiteKey: null })).getElementById('line-button').hidden, true);
  assert.match((await page({}, '?error=line')).getElementById('form-error').textContent, /LINE/);
});
