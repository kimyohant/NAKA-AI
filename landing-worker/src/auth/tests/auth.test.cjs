const assert = require('node:assert/strict');
const { test, after, mock } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');
const buildDir = path.join(root, '.wrangler', `auth-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'inherit' });
const { handleAuth, requireUser } = require(path.join(buildDir, 'auth/index.js'));
const { normalizePhone } = require(path.join(buildDir, 'auth/otp.js'));
const { identityUser } = require(path.join(buildDir, 'auth/session.js'));
const { sha256 } = require(path.join(buildDir, 'auth/common.js'));
const migration = readFileSync(path.join(root, 'migrations/0001_auth.sql'), 'utf8');
const creditMigration = readFileSync(path.join(root, 'migrations/0002_credits_jobs.sql'), 'utf8');

// Execute the production SQL against SQLite, with D1's atomic batch semantics.
// HTTP alone is mocked; limits and one-time claims use the real SQL predicates.
class D1 {
  constructor() { this.sql = new DatabaseSync(':memory:'); this.sql.exec('PRAGMA foreign_keys = ON'); this.sql.exec(migration); this.sql.exec(creditMigration); }
  prepare(query) {
    const db = this.sql;
    let bindings = [];
    return {
      bind(...values) { bindings = values; return this; },
      async first() { const row = db.prepare(query).get(...bindings); return row ? { ...row } : null; },
      async run() { const result = db.prepare(query).run(...bindings); return { success: true, meta: { changes: result.changes } }; },
      execute() { return { success: true, results: db.prepare(query).all(...bindings) }; },
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); this.sql.exec('COMMIT'); return results; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}

let time = 1800000000000;
mock.method(Date, 'now', () => time);
const http = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected external HTTP'); });
after(() => {
  mock.restoreAll();
  assert.equal(path.dirname(buildDir), path.join(root, '.wrangler'));
  rmSync(buildDir, { recursive: true, force: true });
});

function setup(t, overrides = {}) {
  time = 1800000000000;
  const DB = new D1();
  t.after(() => DB.sql.close());
  const env = { DB, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-secret-at-least-32-characters-long',
    TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
    SMS_PROVIDER: 'thaibulksms', SMS_API_KEY: 'test-key', SMS_API_SECRET: 'test-secret', SMS_SENDER: 'NAKA-AI',
    GOOGLE_CLIENT_ID: 'test-google-client', GOOGLE_CLIENT_SECRET: 'test-google-secret', ...overrides };
  const messages = [];
  http.mock.resetCalls();
  http.mock.mockImplementation(async (url, init) => {
    if (url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      const body = new URLSearchParams(init.body);
      assert.equal(body.get('secret'), 'test-turnstile-secret');
      assert.equal(body.get('response'), 'test-turnstile-token');
      return Response.json({ success: true, hostname: new URL(env.APP_ORIGIN).hostname, action: 'otp_request' });
    }
    assert.equal(url, 'https://api-v2.thaibulksms.com/sms');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'manual');
    assert.equal(init.headers.Authorization, `Basic ${btoa('test-key:test-secret')}`);
    const body = new URLSearchParams(init.body);
    assert.equal(body.get('sender'), 'NAKA-AI');
    const phone = body.get('msisdn');
    const code = body.get('message').match(/\b\d{6}\b/)[0];
    messages.push({ phone, code });
    return Response.json({ phone_number_list: [{ number: phone.slice(1), message_id: 'message-test' }], bad_phone_number_list: [] }, { status: 201 });
  });
  const req = (route, data, options = {}) => new Request(`${env.APP_ORIGIN}/api/auth/${route}`, {
    method: data === undefined ? 'GET' : 'POST',
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    ...options,
    headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...options.headers },
  });
  const call = async (route, data, options) => { const request = req(route, data, options); return handleAuth(request, env, new URL(request.url)); };
  const send = (phone = '0812345678', options) => call('otp/request', { phone, turnstileToken: 'test-turnstile-token' }, options);
  const verify = (code = messages.at(-1).code, phone = '0812345678', options) => call('otp/verify', { phone, code }, options);
  return { env, db: DB.sql, messages, req, call, send, verify };
}
function sessionCookie(response) { return response.headers.getSetCookie().find(v => v.startsWith('naka_session=')).split(';')[0]; }
const scalar = (db, sql) => Object.values(db.prepare(sql).get())[0];

test('migration is repeatable, enables identity uniqueness, and has foreign keys', t => {
  const f = setup(t);
  f.db.exec(migration);
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.throws(() => f.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?)').run('hash', 'missing-user', 10, 0));
});

test('Thai mobile numbers normalize and malformed values are rejected', async t => {
  const f = setup(t);
  for (const phone of ['0812345678', '+66812345678', ' 081-234-5678 ', '(081) 234 5678']) assert.equal(normalizePhone(phone), '+66812345678');
  for (const phone of [null, 812345678, '', '021234567', '+16505551234', '66812345678', '08123456789', 'x0812345678', '0812345678,0899999999']) {
    assert.equal((await f.send(phone)).status, 400);
  }
  assert.equal(http.mock.callCount(), 0);
});

test('POST requires same-origin JSON and enforces streamed body size', async t => {
  const f = setup(t);
  for (const origin of ['', 'null', 'https://evil.test']) assert.equal((await f.send(undefined, { headers: { Origin: origin } })).status, 403);
  assert.equal((await f.send(undefined, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.send(undefined, { headers: { 'Content-Type': 'text/plain' } })).status, 400);
  for (const body of ['{oops', '[]', 'null']) assert.equal((await f.send(undefined, { body })).status, 400);
  assert.equal((await f.send(undefined, { body: JSON.stringify({ phone: 'ก'.repeat(1600) }) })).status, 413);
  assert.equal((await f.send(undefined, { headers: { 'Content-Length': '9999' } })).status, 413);
  assert.equal(http.mock.callCount(), 0);
});

test('router returns null outside auth and enforces methods with non-cacheable errors', async t => {
  const f = setup(t);
  const request = new Request('https://naka.test/api/health');
  assert.equal(await handleAuth(request, f.env, new URL(request.url)), null);
  assert.equal((await f.call('unknown')).status, 404);
  const result = await f.call('otp/request');
  assert.equal(result.status, 405);
  assert.equal(result.headers.get('Allow'), 'POST');
  assert.equal(result.headers.get('Cache-Control'), 'no-store');
  assert.equal((await f.call('me', {})).status, 405);
});

test('OTP is HMAC protected and cools down for exactly 60 seconds', async t => {
  const f = setup(t);
  assert.deepEqual(await (await f.send()).json(), { ok: true, retryAfter: 60 });
  const row = f.db.prepare('SELECT * FROM otp_codes').get();
  assert.equal(row.phone, '+66812345678');
  assert.equal(row.code_hash.length, 43);
  assert.notEqual(row.code_hash, f.messages[0].code);
  assert.equal(row.expires_at - row.created_at, 300);
  const blocked = await f.send('+66812345678');
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  time += 59000;
  assert.equal((await (await f.send()).json()).retryAfter, 1);
  time += 1000;
  assert.equal((await f.send()).status, 200);
  assert.equal(f.messages.length, 2);
});

test('Turnstile requires production secret and skips only unconfigured loopback HTTP', async t => {
  const f = setup(t, { TURNSTILE_SECRET_KEY: undefined });
  assert.equal((await f.send()).status, 503);
  assert.equal(http.mock.callCount(), 0);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM auth_otp_requests'), 0);
  f.env.APP_ORIGIN = 'http://127.0.0.1:8789';
  assert.equal((await f.call('otp/request', { phone: '0812345678' })).status, 200);
  assert.equal(f.messages.length, 1);
});

test('Turnstile rejects malformed tokens before HTTP, quota, or SMS', async t => {
  const f = setup(t);
  for (const turnstileToken of [undefined, null, 12, '', ' ', 'x'.repeat(2049)]) {
    const response = await f.call('otp/request', { phone: '0812345678', turnstileToken });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'ยืนยันว่าไม่ใช่บอตไม่สำเร็จ กรุณาลองใหม่');
  }
  assert.equal(http.mock.callCount(), 0);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM auth_otp_requests'), 0);
});

test('Turnstile fails closed for invalid, replayed, wrong-host/action and unavailable responses', async t => {
  const f = setup(t);
  const replies = [
    () => Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    () => Response.json({ success: true, hostname: 'evil.test', action: 'otp_request' }),
    () => Response.json({ success: true, hostname: 'naka.test', action: 'other' }),
    () => Response.json({ success: 'true', hostname: 'naka.test', action: 'otp_request' }),
    () => new Response('private provider body', { status: 503 }),
    () => new Response('invalid-json'), () => { throw new Error('private timeout'); },
  ];
  for (const reply of replies) {
    http.mock.mockImplementation(async (url, init) => {
      assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
      assert.equal(new URLSearchParams(init.body).get('remoteip'), '192.0.2.1');
      assert.equal(init.redirect, 'manual');
      return reply();
    });
    const result = await f.send();
    assert.equal(result.status, 400);
    assert.equal((await result.json()).error, 'ยืนยันว่าไม่ใช่บอตไม่สำเร็จ กรุณาลองใหม่');
  }
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM auth_otp_requests'), 0);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM otp_codes'), 0);
});

test('maximum Turnstile token fits the request limit and permits SMS only after verification', async t => {
  const f = setup(t);
  let validated = false;
  http.mock.mockImplementation(async (url, init) => {
    if (url.includes('siteverify')) {
      assert.equal(new URLSearchParams(init.body).get('response').length, 2048);
      validated = true;
      return Response.json({ success: true, hostname: 'naka.test', action: 'otp_request' });
    }
    assert.ok(validated);
    return Response.json({ phone_number_list: [{ number: '66812345678', message_id: 'ok' }] });
  });
  assert.equal((await f.call('otp/request', { phone: '0812345678', turnstileToken: 'x'.repeat(2048) })).status, 200);
  assert.equal(http.mock.callCount(), 2);
});

test('parallel OTP sends admit only one request', async t => {
  const f = setup(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.send()));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal(results.filter(r => r.status === 429).length, 7);
  assert.equal(f.messages.length, 1);
});

test('rolling hourly phone quota survives successful verification and resets at boundary', async t => {
  const f = setup(t);
  for (let i = 0; i < 3; i++) { assert.equal((await f.send()).status, 200); assert.equal((await f.verify()).status, 200); time += 60000; }
  const result = await f.send();
  assert.equal(result.status, 429);
  assert.equal((await result.json()).retryAfter, 3420);
  time += 3420000;
  assert.equal((await f.send()).status, 200);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM users'), 1);
});

test('per-IP quota allows 60 verified requests per hour without changing phone quota', async t => {
  const f = setup(t);
  for (let i = 0; i < 60; i++) assert.equal((await f.send(`081234${String(i).padStart(4, '0')}`)).status, 200);
  const response = await f.send('0899999999');
  assert.equal(response.status, 429);
  assert.equal((await response.json()).retryAfter, 3600);
  assert.equal((await f.send('0899999999', { headers: { 'CF-Connecting-IP': '192.0.2.2' } })).status, 200);
  assert.notEqual(scalar(f.db, 'SELECT ip_hash FROM auth_otp_requests LIMIT 1'), '192.0.2.1');
});

test('five incorrect OTP attempts lock the challenge, including the right code afterward', async t => {
  const f = setup(t);
  await f.send();
  const wrong = f.messages[0].code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.equal((await f.verify(wrong)).status, 400);
  assert.equal((await f.verify(wrong)).status, 429);
  assert.equal((await f.verify()).status, 429);
  assert.equal(scalar(f.db, 'SELECT attempts FROM otp_codes'), 5);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM sessions'), 0);
});

test('correct OTP on fifth attempt is accepted; malformed codes do not consume attempts', async t => {
  const f = setup(t);
  await f.send();
  for (const code of ['12345', 'abcdef', 123456]) assert.equal((await f.verify(code)).status, 400);
  assert.equal(scalar(f.db, 'SELECT attempts FROM otp_codes'), 0);
  const wrong = f.messages[0].code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) await f.verify(wrong);
  assert.equal((await f.verify()).status, 200);
});

test('OTP expires at five minutes and codes cannot cross phones or survive resend', async t => {
  const f = setup(t);
  await f.send();
  const previous = f.messages[0].code;
  assert.equal((await f.verify(previous, '0899999999')).status, 400);
  time += 300000;
  assert.equal((await f.verify(previous)).status, 400);
  await f.send();
  // Challenge salt changes even in the unlikely event the random digits repeat.
  const row = f.db.prepare('SELECT * FROM otp_codes').get();
  assert.equal(row.attempts, 0);
  if (previous !== f.messages.at(-1).code) assert.equal((await f.verify(previous)).status, 400);
  assert.equal((await f.verify()).status, 200);
});

test('parallel verifies and replay create at most one session', async t => {
  const f = setup(t);
  await f.send();
  const results = await Promise.all([f.verify(), f.verify()]);
  assert.equal(results.filter(r => r.status === 200).length, 1);
  assert.equal((await f.verify()).status, 400);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM sessions'), 1);
});

test('login issues secure hashed session; me reads user; logout revokes it', async t => {
  const f = setup(t);
  assert.equal((await f.call('me')).status, 401);
  await f.send();
  const result = await f.verify();
  assert.equal(result.status, 200);
  const user = (await result.json()).user;
  assert.equal(user.phone, '+66812345678');
  assert.equal(user.email, null);
  const setCookie = result.headers.get('Set-Cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=2592000']) assert.ok(setCookie.includes(flag));
  const cookie = sessionCookie(result);
  const token = cookie.split('=')[1];
  assert.equal(scalar(f.db, 'SELECT id FROM sessions'), await sha256(token));
  const headers = { Cookie: cookie };
  assert.deepEqual(await (await f.call('me', undefined, { headers })).json(), { user, credits: 0 });
  assert.deepEqual(await requireUser(f.req('me', undefined, { headers }), f.env), user);
  const logout = await f.call('logout', {}, { headers });
  assert.equal(logout.status, 204);
  assert.ok(logout.headers.get('Set-Cookie').includes('Max-Age=0'));
  assert.equal((await f.call('me', undefined, { headers })).status, 401);
  assert.equal((await f.call('logout', {})).status, 204);
});

test('session rotation invalidates old cookie and returning phone retains user id', async t => {
  const f = setup(t);
  await f.send();
  const first = await f.verify();
  const user = (await first.json()).user;
  const old = sessionCookie(first);
  time += 60000;
  await f.send();
  const second = await f.verify(undefined, undefined, { headers: { Cookie: old } });
  assert.equal((await second.json()).user.id, user.id);
  assert.notEqual(sessionCookie(second), old);
  assert.equal((await f.call('me', undefined, { headers: { Cookie: old } })).status, 401);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM users'), 1);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM sessions'), 1);
});

test('expired, duplicate, malformed sessions and disabled accounts cannot authenticate', async t => {
  const f = setup(t);
  await f.send();
  const cookie = sessionCookie(await f.verify());
  for (const value of ['naka_session=bogus', `${cookie}; ${cookie}`]) assert.equal((await f.call('me', undefined, { headers: { Cookie: value } })).status, 401);
  f.db.exec("UPDATE users SET status = 'disabled'");
  assert.equal((await f.call('me', undefined, { headers: { Cookie: cookie } })).status, 401);
  f.db.exec("UPDATE users SET status = 'active'");
  time += 2592000000;
  assert.equal((await f.call('me', undefined, { headers: { Cookie: cookie } })).status, 401);
});

test('disabled phone user cannot obtain a replacement session', async t => {
  const f = setup(t);
  await f.send(); await f.verify();
  f.db.exec("UPDATE users SET status = 'disabled'");
  time += 60000;
  await f.send();
  assert.equal((await f.verify()).status, 403);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM users'), 1);
});

test('provider failures never activate an OTP and retain throttling without leaking response', async t => {
  const f = setup(t, { APP_ORIGIN: 'http://127.0.0.1:8789', TURNSTILE_SECRET_KEY: undefined });
  http.mock.mockImplementation(async () => new Response('private provider details and secret', { status: 500 }));
  const result = await f.send();
  assert.equal(result.status, 502);
  assert.ok(!(await result.text()).includes('private'));
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM otp_codes'), 0);
  assert.equal((await f.send()).status, 429);
});

test('provider partial success, malformed payload and timeout are rejected', async t => {
  const f = setup(t, { APP_ORIGIN: 'http://127.0.0.1:8789', TURNSTILE_SECRET_KEY: undefined });
  const replies = [() => Response.json({ phone_number_list: [], bad_phone_number_list: [{}] }),
    () => Response.json({ phone_number_list: [{ number: '66899999999', message_id: 'wrong' }] }),
    () => new Response('not-json'), () => { throw new Error('timeout'); }];
  for (let i = 0; i < replies.length; i++) {
    http.mock.mockImplementation(async () => replies[i]());
    assert.equal((await f.send(`081234000${i}`)).status, 502);
  }
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM otp_codes'), 0);
});

test('mock SMS is restricted to loopback HTTP, and real sender configuration is required', async t => {
  const f = setup(t, { SMS_PROVIDER: 'mock', TURNSTILE_SECRET_KEY: undefined });
  assert.equal((await f.send()).status, 503);
  f.env.APP_ORIGIN = 'http://example.test';
  assert.equal((await f.send()).status, 503);
  f.env.APP_ORIGIN = 'http://127.0.0.1:8788';
  const logs = [];
  const logger = mock.method(console, 'log', value => logs.push(value));
  t.after(() => logger.mock.restore());
  assert.equal((await f.send()).status, 200);
  const code = logs[0].match(/\b\d{6}\b/)[0];
  const verified = await f.verify(code);
  assert.equal(verified.status, 200);
  assert.ok(!verified.headers.get('Set-Cookie').includes('; Secure'));
  assert.equal(http.mock.callCount(), 0);
  f.env.SMS_PROVIDER = 'thaibulksms';
  delete f.env.SMS_SENDER;
  assert.equal((await f.send()).status, 503);
});

test('bad app origin, mismatched request host and weak secret fail closed', async t => {
  const f = setup(t);
  const request = new Request('https://evil.test/api/auth/me');
  assert.equal((await handleAuth(request, f.env, new URL(request.url))).status, 403);
  f.env.SESSION_SECRET = 'short';
  assert.equal((await f.send()).status, 503);
  const validRequest = f.req('me');
  f.env.APP_ORIGIN = 'https://naka.test/subpath';
  assert.equal((await handleAuth(validRequest, f.env, new URL(validRequest.url))).status, 503);
  assert.equal(http.mock.callCount(), 0);
});

async function startGoogle(f) {
  const response = await f.call('google/start');
  assert.equal(response.status, 302);
  const url = new URL(response.headers.get('Location'));
  const state = url.searchParams.get('state');
  const cookie = response.headers.getSetCookie()[0].split(';')[0];
  return { response, url, state, cookie };
}
function mockGoogle(profile = { sub: 'google-subject-1', email: 'member@example.test', email_verified: true, name: 'สมาชิกทดสอบ' }) {
  http.mock.mockImplementation(async (url, init) => {
    if (url === 'https://oauth2.googleapis.com/token') {
      const data = new URLSearchParams(init.body);
      assert.equal(data.get('client_id'), 'test-google-client');
      assert.equal(data.get('redirect_uri'), 'https://naka.test/api/auth/google/callback');
      assert.equal(data.get('grant_type'), 'authorization_code');
      assert.equal(data.get('code_verifier').length, 43);
      return Response.json({ access_token: 'server-issued-access-token', token_type: 'Bearer' });
    }
    assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
    assert.equal(init.headers.Authorization, 'Bearer server-issued-access-token');
    return Response.json(profile);
  });
}
const callback = (f, flow, suffix = '') => f.call(`google/callback?state=${flow.state}&code=test-code${suffix}`, undefined, { headers: { Cookie: flow.cookie } });

test('Google start persists expiring hashed state and sends PKCE S256', async t => {
  const f = setup(t);
  const flow = await startGoogle(f);
  assert.equal(flow.url.origin, 'https://accounts.google.com');
  assert.equal(flow.url.searchParams.get('scope'), 'openid email profile');
  assert.equal(flow.url.searchParams.get('code_challenge_method'), 'S256');
  const row = f.db.prepare('SELECT * FROM auth_oauth_states').get();
  assert.equal(row.id, await sha256(flow.state));
  assert.equal(flow.url.searchParams.get('code_challenge'), await sha256(row.verifier));
  assert.equal(row.expires_at, Math.floor(time / 1000) + 600);
  assert.ok(flow.response.headers.get('Set-Cookie').includes('Max-Age=600'));
});

test('Google rejects missing, mismatched, duplicate and expired state before HTTP', async t => {
  const f = setup(t);
  const flow = await startGoogle(f);
  const attempts = [
    f.call(`google/callback?state=${flow.state}&code=test-code`),
    callback(f, { ...flow, state: 'x'.repeat(43) }),
    callback(f, flow, `&state=${flow.state}`),
  ];
  for (const result of await Promise.all(attempts)) {
    assert.equal(result.status, 302);
    assert.equal(result.headers.get('Location'), 'https://naka.test/login/?error=google');
    assert.ok(result.headers.get('Set-Cookie').includes('Max-Age=0'));
  }
  time += 600000;
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/login/?error=google');
  assert.equal(http.mock.callCount(), 0);
});

test('Google callback creates user and session, and state is single-use', async t => {
  const f = setup(t);
  const flow = await startGoogle(f);
  mockGoogle();
  const result = await callback(f, flow);
  assert.equal(result.headers.get('Location'), 'https://naka.test/app/');
  const me = await (await f.call('me', undefined, { headers: { Cookie: sessionCookie(result) } })).json();
  assert.equal(me.user.email, 'member@example.test');
  assert.equal(me.user.phone, null);
  assert.equal(me.user.displayName, 'สมาชิกทดสอบ');
  assert.equal(result.headers.getSetCookie().length, 2);
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/login/?error=google');
  assert.equal(http.mock.callCount(), 2);
});

test('parallel Google callbacks exchange an authorization code only once', async t => {
  const f = setup(t);
  const flow = await startGoogle(f);
  mockGoogle();
  const results = await Promise.all([callback(f, flow), callback(f, flow)]);
  assert.equal(results.filter(r => r.headers.get('Location') === 'https://naka.test/app/').length, 1);
  assert.equal(http.mock.callCount(), 2);
});

test('Google denial consumes state without token exchange', async t => {
  const f = setup(t);
  const flow = await startGoogle(f);
  assert.equal((await callback(f, flow, '&error=access_denied')).headers.get('Location'), 'https://naka.test/login/?error=google');
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM auth_oauth_states'), 0);
  assert.equal(http.mock.callCount(), 0);
});

test('unverified Google email, malformed profile and token exchange failure create no account', async t => {
  const f = setup(t);
  for (const profile of [{ sub: 'x', email: 'test@example.test', email_verified: false },
    { sub: '', email: 'test@example.test', email_verified: true },
    { sub: 'x', email: 'bad-email', email_verified: true }]) {
    const flow = await startGoogle(f);
    mockGoogle(profile);
    assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/login/?error=google');
  }
  const flow = await startGoogle(f);
  http.mock.mockImplementation(async () => new Response('internal credentials', { status: 401 }));
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/login/?error=google');
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM users'), 0);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM sessions'), 0);
});

test('Google uses stable sub, updates email, and does not merge distinct identities by email', async t => {
  const f = setup(t);
  const one = await identityUser(f.env, 'google', 'subject-1', 'Member', 'first@example.test');
  const again = await identityUser(f.env, 'google', 'subject-1', 'Member', 'second@example.test');
  assert.equal(one.id, again.id);
  assert.equal(again.email, 'second@example.test');
  const two = await identityUser(f.env, 'google', 'subject-2', 'Member', 'second@example.test');
  assert.notEqual(one.id, two.id);
  const raced = await Promise.all([identityUser(f.env, 'phone', '+66812345678', 'Member'), identityUser(f.env, 'phone', '+66812345678', 'Member')]);
  assert.equal(raced[0].id, raced[1].id);
  assert.equal(scalar(f.db, 'SELECT COUNT(*) FROM users'), 3);
});
