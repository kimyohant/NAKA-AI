// The Worker on a real PostgreSQL server, through the production driver (server/postgres.ts) with a
// connection pool, so requests really run at the same time. Replaces the old Cloudflare workerd + D1
// (Miniflare) runtime tests: concurrent limits, one-time tokens and serialized admin grants must hold.
//
//   TEST_DATABASE_URL=postgres://naka_admin:…@127.0.0.1:5432/naka npm test
// Skipped without TEST_DATABASE_URL. Each test works in its own throwaway schema.
require('tsx/cjs');
const assert = require('node:assert/strict');
const { after, mock, test } = require('node:test');
const path = require('node:path');

const url = process.env.TEST_DATABASE_URL;
const skip = url ? false : 'set TEST_DATABASE_URL to run against PostgreSQL';
const root = path.resolve(__dirname, '..');
const MONTH = 30 * 86400;

const ctx = { waitUntil: p => { p.catch?.(() => {}); }, passThroughOnException() {} };
// A pool, so requests really overlap; TEST_DB_POOL_MAX=1 for servers that take one connection (PGlite).
const POOL = Number(process.env.TEST_DB_POOL_MAX ?? 10);
after(() => mock.restoreAll());

/** A fresh schema with the baseline applied, and an env whose DB is a pooled connection to it. */
async function setup(t, bindings = {}) {
  const { connect } = require('../server/postgres.ts');
  const { migrate } = require('../server/migrate.ts');
  const { d1OnPostgres } = require('../src/db/pg-d1.ts');
  const schema = `it_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const database = connect(url, { schema, max: POOL });
  await database.sql.unsafe(`CREATE SCHEMA ${schema}`);
  // PGlite's socket server ignores the search_path startup parameter; with one connection, set it here
  if (POOL === 1) await database.sql.unsafe(`SET search_path TO ${schema}`);
  await migrate(database.sql, path.join(root, 'migrations', 'pg'));
  t.after(async () => {
    await database.sql.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await database.close();
  });
  const env = {
    DB: d1OnPostgres(database.executor), ASSETS: { fetch: async () => new Response('Not Found', { status: 404 }) },
    APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-only-secret-at-least-32-characters', SMS_PROVIDER: 'off',
    ...bindings,
  };
  const worker = require('../src/index.ts').default;
  const call = (route, body, cookie, extra = {}) => worker.fetch(new Request(`https://naka.test/api/${route}`, {
    method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { Origin: 'https://naka.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1',
      ...(cookie ? { Cookie: cookie } : {}), ...extra },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), env, ctx);
  const sql = database.sql;
  return { env, call, sql };
}

const cookieOf = response => response.headers.getSetCookie().find(v => v.startsWith('naka_session=')).split(';')[0];

test('four OTP requests at once: one is sent, three hit the limit; sign-in, credits, logout, Google', { skip, timeout: 60000 }, async t => {
  let code;
  let sends = 0;
  mock.method(globalThis, 'fetch', async (input, init) => {
    const request = new Request(input, init);
    if (request.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
      return Response.json({ success: true, hostname: 'naka.test', action: 'otp_request' });
    }
    if (request.url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'test-google-token', token_type: 'Bearer' });
    if (request.url === 'https://openidconnect.googleapis.com/v1/userinfo') {
      return Response.json({ sub: 'test-subject', email: 'member@example.test', email_verified: true });
    }
    assert.equal(request.url, 'https://api-v2.thaibulksms.com/sms');
    code = new URLSearchParams(await request.text()).get('message').match(/\b\d{6}\b/)[0];
    sends++;
    return Response.json({ phone_number_list: [{ number: '66812345678', message_id: 'm' }], bad_phone_number_list: [] }, { status: 201 });
  });
  const { call, sql } = await setup(t, {
    TURNSTILE_SECRET_KEY: 'test-turnstile-secret', SMS_PROVIDER: 'thaibulksms', SMS_API_KEY: 'k', SMS_API_SECRET: 's', SMS_SENDER: 'NAKA-AI',
    GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret',
  });
  const results = await Promise.all(Array.from({ length: 4 }, () => call('auth/otp/request', { phone: '0812345678', turnstileToken: 'test-turnstile-token' })));
  assert.deepEqual(results.map(r => r.status).sort(), [200, 429, 429, 429]);
  assert.equal(sends, 1);
  const verified = await call('auth/otp/verify', { phone: '0812345678', code });
  assert.equal(verified.status, 200, await verified.clone().text());
  const cookie = cookieOf(verified);
  const user = (await verified.json()).user;
  await sql`INSERT INTO credit_ledger (user_id, delta, reason) VALUES (${user.id}, 37, 'grant')`;
  assert.equal((await (await call('auth/me', undefined, cookie)).json()).credits, 37);
  assert.equal((await call('auth/otp/verify', { phone: '0812345678', code })).status, 400, 'a code is used once');
  assert.equal((await call('auth/logout', {}, cookie)).status, 204);
  assert.equal((await call('auth/me', undefined, cookie)).status, 401);
  const start = await call('auth/google/start');
  assert.equal(start.status, 302);
  const state = new URL(start.headers.get('Location')).searchParams.get('state');
  const stateCookie = start.headers.get('Set-Cookie').split(';')[0];
  const google = await call(`auth/google/callback?state=${state}&code=test-code`, undefined, stateCookie);
  assert.equal(google.headers.get('Location'), 'https://naka.test/app/');
  assert.equal((await (await call('auth/me', undefined, cookieOf(google))).json()).user.email, 'member@example.test');
  assert.equal((await call(`auth/google/callback?state=${state}&code=test-code`, undefined, stateCookie)).headers.get('Location'),
    'https://naka.test/login/?error=google', 'the state is used once');
});

test('two submissions of one reset token at once: exactly one wins and every session is revoked', { skip, timeout: 60000 }, async t => {
  const { sha256 } = require('../src/auth/common.ts');
  const { verifyPassword } = require('../src/auth/password.ts');
  const { call, sql } = await setup(t);
  const registered = await call('auth/password/register', { email: 'runtime@example.test', password: 'old-secret-123' });
  assert.equal(registered.status, 201, await registered.clone().text());
  const [{ user_id: userId }] = await sql`SELECT user_id FROM auth_identities WHERE provider = 'password'`;
  const token = 'a'.repeat(43);
  const now = Math.floor(Date.now() / 1000);
  await sql`INSERT INTO auth_password_resets (email_key, ip_key, user_id, token_hash, expires_at, created_at)
    VALUES ('email-hmac', 'ip-hmac', ${userId}, ${await sha256(token)}, ${now + 1800}, ${now})`;
  const [first, second] = await Promise.all([
    call('auth/password/reset', { token, newPassword: 'first-secret-456' }),
    call('auth/password/reset', { token, newPassword: 'second-secret-456' }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 400]);
  const [{ hash }] = await sql`SELECT hash FROM auth_passwords WHERE user_id = ${userId}`;
  assert.notEqual(await verifyPassword('first-secret-456', hash), await verifyPassword('second-secret-456', hash));
  assert.equal(Number((await sql`SELECT count(*) AS n FROM sessions WHERE user_id = ${userId}`)[0].n), 0);
});

test('a password change keeps the new session and ends the old one', { skip, timeout: 60000 }, async t => {
  const { call } = await setup(t);
  const registered = await call('auth/password/register', { email: 'runtime@example.test', password: 'old-secret-123' });
  assert.equal(registered.status, 201, await registered.clone().text());
  const oldCookie = cookieOf(registered);
  assert.equal((await (await call('auth/me', undefined, oldCookie)).json()).hasPassword, true);
  const changed = await call('auth/password/change', { currentPassword: 'old-secret-123', newPassword: 'new-secret-456' }, oldCookie);
  assert.equal(changed.status, 200, await changed.clone().text());
  assert.equal((await call('auth/me', undefined, oldCookie)).status, 401);
  assert.equal((await call('auth/me', undefined, cookieOf(changed))).status, 200);
  assert.equal((await call('auth/password/login', { email: 'runtime@example.test', password: 'old-secret-123' })).status, 401);
  assert.equal((await call('auth/password/login', { email: 'runtime@example.test', password: 'new-secret-456' })).status, 200);
});

test('concurrent admin grants and renewals are serialized with an exact audit before/after', { skip, timeout: 60000 }, async t => {
  const TOKEN = 'test-admin-token-at-least-32-characters-long';
  const { call, sql } = await setup(t, { ADMIN_TOKEN: TOKEN });
  await sql`INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'runtime', 1)`;
  const post = (action, data) => call(`admin/customers/u1/${action}`, data, undefined, { Authorization: 'Bearer ' + TOKEN });
  const grants = await Promise.all(Array.from({ length: 8 }, () => post('credits', { amount: 5, note: 'พร้อมกัน' })));
  for (const response of grants) assert.equal(response.status, 200, await response.text());
  const audit = async action => (await sql`SELECT detail FROM admin_audit WHERE action = ${action} ORDER BY rowid`).map(r => JSON.parse(r.detail));
  const grantsAudit = await audit('credits');
  assert.deepEqual(grantsAudit.map(a => a.before.credits), [0, 5, 10, 15, 20, 25, 30, 35]);
  assert.deepEqual(grantsAudit.map(a => a.after.credits), [5, 10, 15, 20, 25, 30, 35, 40]);
  const renewals = await Promise.all(Array.from({ length: 5 }, () => post('package', { planId: 'starter', months: 1, note: 'ต่อพร้อมกัน' })));
  for (const response of renewals) assert.equal(response.status, 200, await response.text());
  const [sub] = await sql`SELECT * FROM subscriptions WHERE user_id = 'u1'`;
  const packageAudit = await audit('package');
  assert.equal(Number(sub.expires_at), packageAudit[0].after.expiresAt + 4 * MONTH);
  assert.equal(Number(sub.next_credit_at), packageAudit[0].after.nextCreditAt);
  assert.equal(Number((await sql`SELECT sum(delta) AS n FROM credit_ledger WHERE user_id = 'u1'`)[0].n), 40);
  for (let i = 1; i < 5; i++) assert.deepEqual(packageAudit[i].before, packageAudit[i - 1].after);
});

// Studio credit holds (migrations/pg/0002_shared.sql), called as the studio calls them: one SQL call each.
const hold = (sql, user, amount, ref) =>
  sql`SELECT ok, hold_id, balance FROM hold_credits(${user}, ${amount}::bigint, ${ref})`.then(rows => rows[0]);
const balanceOf = async (sql, user) => Number((await sql`SELECT coalesce(sum(delta), 0) AS b FROM credit_ledger WHERE user_id = ${user}`)[0].b);

test('ten studio holds at once for a balance that covers five: five are held, none overdraws, refunds happen once', { skip, timeout: 60000 }, async t => {
  const { sql } = await setup(t);
  await sql`INSERT INTO credit_ledger (user_id, delta, reason) VALUES ('u1', 50, 'grant')`;
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => hold(sql, 'u1', 10, `studio:task-${i}`)));
  const held = results.filter(r => r.ok);
  assert.equal(held.length, 5);
  assert.deepEqual(held.map(r => r.balance).sort((a, b) => a - b), [0, 10, 20, 30, 40], 'each hold saw the one before it');
  for (const refused of results.filter(r => !r.ok)) assert.deepEqual([refused.hold_id, refused.balance], [null, 0]);
  assert.equal(await balanceOf(sql, 'u1'), 0);

  // every hold refunded twice, all at once: the credits come back once
  await Promise.all([...held, ...held].map(r => sql`SELECT refund_hold(${r.hold_id}::bigint)`));
  assert.equal(await balanceOf(sql, 'u1'), 50);
  assert.equal(Number((await sql`SELECT count(*) AS n FROM credit_ledger WHERE reason = 'studio_refund'`)[0].n), 5);
});

test('studio holds and landing jobs at once draw on one balance without overdrawing it', { skip, timeout: 60000 }, async t => {
  const { env, sql } = await setup(t);
  const { enqueueJob } = require('../src/jobs.ts');
  await sql`INSERT INTO credit_ledger (user_id, delta, reason) VALUES ('u2', 50, 'grant')`;
  const results = await Promise.all(Array.from({ length: 10 }, (_, i) => i % 2
    ? hold(sql, 'u2', 10, `studio:mixed-${i}`).then(r => Boolean(r.ok))
    : enqueueJob(env.DB, { userId: 'u2', kind: 'image', input: {}, costCredits: 10, countsTowardLimit: false }).then(r => r.ok)));
  assert.equal(results.filter(Boolean).length, 5);
  assert.equal(await balanceOf(sql, 'u2'), 0);
});
