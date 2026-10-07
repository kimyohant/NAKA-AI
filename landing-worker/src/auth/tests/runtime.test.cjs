const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
// These runtime/build tools are already installed by the pinned Wrangler tree.
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse } = require('miniflare');
const root = path.resolve(__dirname, '../../..');

test('Cloudflare workerd + D1: migration, OTP quota/claim, Google, session and logout', { timeout: 60000 }, async () => {
  const bundled = await build({
    stdin: { contents: "export { default } from './src/index';", resolveDir: root, loader: 'ts' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022',
  });
  let code;
  let sends = 0;
  const options = {
    modules: true, script: bundled.outputFiles[0].text, compatibilityDate: '2026-09-01', d1Databases: ['DB'], cf: false,
    bindings: { APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-only-secret-at-least-32-characters',
      TURNSTILE_SECRET_KEY: 'test-turnstile-secret',
      SMS_PROVIDER: 'thaibulksms', SMS_API_KEY: 'test-key', SMS_API_SECRET: 'test-secret', SMS_SENDER: 'NAKA-AI',
      GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-client-secret' },
    outboundService: async request => {
      if (request.url === 'https://challenges.cloudflare.com/turnstile/v0/siteverify') {
        const params = new URLSearchParams(await request.text());
        assert.equal(params.get('secret'), 'test-turnstile-secret');
        assert.equal(params.get('response'), 'test-turnstile-token');
        return RuntimeResponse.json({ success: true, hostname: 'naka.test', action: 'otp_request' });
      }
      if (request.url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(await request.text());
        assert.equal(params.get('code_verifier').length, 43);
        return RuntimeResponse.json({ access_token: 'test-google-token', token_type: 'Bearer' });
      }
      if (request.url === 'https://openidconnect.googleapis.com/v1/userinfo') {
        assert.equal(request.headers.get('Authorization'), 'Bearer test-google-token');
        return RuntimeResponse.json({ sub: 'test-subject', email: 'member@example.test', email_verified: true });
      }
      assert.equal(request.url, 'https://api-v2.thaibulksms.com/sms');
      const params = new URLSearchParams(await request.text());
      code = params.get('message').match(/\b\d{6}\b/)[0];
      sends++;
      return RuntimeResponse.json({ phone_number_list: [{ number: '66812345678', message_id: 'mock-message' }], bad_phone_number_list: [] }, { status: 201 });
    },
  };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const db = await mf.getD1Database('DB');
    const sql = ['0001_auth.sql', '0002_credits_jobs.sql'].map(name => readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n').replace(/--[^\r\n]*/g, '');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const call = (route, body, cookie) => mf.dispatchFetch(`https://naka.test/api/auth/${route}`, {
      method: body ? 'POST' : 'GET', redirect: 'manual',
      headers: { Origin: 'https://naka.test', 'Content-Type': 'application/json', 'CF-Connecting-IP': '192.0.2.1', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const results = await Promise.all(Array.from({ length: 4 }, () => call('otp/request', { phone: '0812345678', turnstileToken: 'test-turnstile-token' })));
    assert.equal(results.filter(response => response.status === 200).length, 1,
      JSON.stringify(await Promise.all(results.map(async response => ({ status: response.status, body: await response.clone().text() })))));
    assert.equal(results.filter(response => response.status === 429).length, 3);
    assert.equal(sends, 1);
    const verified = await call('otp/verify', { phone: '0812345678', code });
    assert.equal(verified.status, 200, await verified.clone().text());
    const cookie = verified.headers.get('Set-Cookie').split(';')[0];
    const user = (await verified.json()).user;
    await db.prepare("INSERT INTO credit_ledger (user_id, delta, reason) VALUES (?, 37, 'grant')").bind(user.id).run();
    const account = await call('me', undefined, cookie);
    assert.equal(account.status, 200);
    assert.equal((await account.json()).credits, 37);
    assert.equal((await call('otp/verify', { phone: '0812345678', code })).status, 400);
    assert.equal((await call('logout', {}, cookie)).status, 204);
    assert.equal((await call('me', undefined, cookie)).status, 401);
    const start = await call('google/start');
    assert.equal(start.status, 302);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const stateCookie = start.headers.get('Set-Cookie').split(';')[0];
    const google = await call(`google/callback?state=${state}&code=test-code`, undefined, stateCookie);
    assert.equal(google.headers.get('Location'), 'https://naka.test/app/');
    const googleCookie = google.headers.getSetCookie().find(value => value.startsWith('naka_session=')).split(';')[0];
    const profile = await (await call('me', undefined, googleCookie)).json();
    assert.equal(profile.user.email, 'member@example.test');
    assert.equal((await call(`google/callback?state=${state}&code=test-code`, undefined, stateCookie)).headers.get('Location'), 'https://naka.test/login/?error=google');
  } finally { await mf.dispose(); }
});
