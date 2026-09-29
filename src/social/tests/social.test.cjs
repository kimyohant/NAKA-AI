const assert = require('node:assert/strict');
const { test, after, mock } = require('node:test');
const { DatabaseSync } = require('node:sqlite');
const { readFileSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.wrangler', `social-tests-${process.pid}`);
mkdirSync(output, { recursive: true });
const compiled = buildSync({ stdin: { contents: `export * from './src/social/index'; export * from './src/social/crypto';
  export * from './src/social/media'; export * from './src/social/meta';`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs' });
writeFileSync(path.join(output, 'social.cjs'), compiled.outputFiles[0].text);
const { handleSocial, publishDuePosts, encryptToken, decryptToken, tokenContext, signedMediaUrl, GRAPH_VERSION, MAX_UPLOAD } = require(path.join(output, 'social.cjs'));
const migration = readFileSync(path.join(root, 'migrations/0003_social.sql'), 'utf8');
class D1 {
  constructor() {
    this.sql = new DatabaseSync(':memory:');
    this.sql.exec('PRAGMA foreign_keys = ON');
    this.sql.exec(readFileSync(path.join(root, 'migrations/0001_auth.sql'), 'utf8'));
    this.sql.exec(migration);
    this.sql.exec("INSERT INTO users (id, created_at) VALUES ('user-a', 0), ('user-b', 0)");
  }
  prepare(query) {
    let values = []; const db = this.sql;
    return {
      bind(...bound) { values = bound; return this; },
      async first() { const row = db.prepare(query).get(...values); return row ? { ...row } : null; },
      async all() { return { success: true, results: db.prepare(query).all(...values).map(row => ({ ...row })) }; },
      async run() { const result = db.prepare(query).run(...values); return { success: true, meta: { changes: result.changes } }; },
      execute() { return { success: true, results: db.prepare(query).all(...values) }; },
    };
  }
  async batch(statements) {
    this.sql.exec('BEGIN');
    try { const result = statements.map(s => s.execute()); this.sql.exec('COMMIT'); return result; }
    catch (error) { this.sql.exec('ROLLBACK'); throw error; }
  }
}
class R2 {
  files = new Map();
  async put(key, value, metadata) { this.files.set(key, { bytes: new Uint8Array(value), ...metadata }); }
  async head(key) { const file = this.files.get(key); return file ? { size: file.bytes.length } : null; }
  async get(key) { const file = this.files.get(key); return file ? { size: file.bytes.length, body: file.bytes } : null; }
  async delete(key) { this.files.delete(key); }
}
let time = 1800000000000;
mock.method(Date, 'now', () => time);
const http = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected live HTTP'); });
after(() => {
  mock.restoreAll();
  assert.equal(path.dirname(output), path.join(root, '.wrangler'));
  rmSync(output, { recursive: true, force: true });
});
const count = (db, table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const mp4 = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0]);
function setup(t, overrides = {}) {
  time = 1800000000000;
  const DB = new D1(); t.after(() => DB.sql.close());
  const env = { DB, MEDIA: new R2(), APP_ORIGIN: 'https://naka.test', META_APP_ID: '12345', META_APP_SECRET: 'test-app-secret',
    SOCIAL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'), ...overrides };
  http.mock.resetCalls(); http.mock.mockImplementation(async () => { throw new Error('Unexpected HTTP'); });
  const call = (route, { method = 'GET', body, user = 'user-a', headers = {} } = {}) => {
    const url = new URL(route.startsWith('https:') ? route : `${env.APP_ORIGIN}/api/social/${route}`);
    const request = new Request(url, { method, ...(body === undefined ? {} : { body }), duplex: 'half',
      headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json', ...headers } });
    return handleSocial(request, env, url, user);
  };
  const send = (route, body, opts = {}) => call(route, { method: 'POST', body: JSON.stringify(body), ...opts });
  const addAccount = async (platform = 'facebook', user = 'user-a', id = crypto.randomUUID()) => {
    const external = platform === 'facebook' ? '100' : '200';
    const encrypted = await encryptToken(env, 'private-page-token', tokenContext(user, platform, external));
    DB.sql.prepare(`INSERT INTO social_accounts (id, user_id, platform, external_id, name, token_enc, status, created_at)
      VALUES (?, ?, ?, ?, 'Test account', ?, 'active', ?)`).run(id, user, platform, external, encrypted, time / 1000);
    return id;
  };
  const upload = async (user = 'user-a', type = 'video/mp4') => {
    const response = await call('uploads', { method: 'POST', body: type === 'video/mp4' ? mp4 : webm, user, headers: { 'Content-Type': type } });
    assert.equal(response.status, 201, await response.clone().text());
    return (await response.json()).mediaKey;
  };
  const queue = async (platform = 'facebook', extra = {}) => {
    const accountId = await addAccount(platform); const mediaKey = await upload();
    const response = await send('posts', { accountId, mediaKey, caption: 'ทดสอบ', ...extra });
    assert.equal(response.status, 202, await response.clone().text());
    return { accountId, mediaKey, postId: (await response.json()).postId };
  };
  const post = id => ({ ...DB.sql.prepare('SELECT * FROM scheduled_posts WHERE id = ?').get(id) });
  const run = (maxPosts = 5) => publishDuePosts(env, { maxPosts });
  return { env, db: DB.sql, call, send, addAccount, upload, queue, post, run };
}

test('migration is repeatable and rejects cross-owner account/media references', async t => {
  const f = setup(t); f.db.exec(migration);
  const item = await f.queue();
  assert.throws(() => f.db.prepare('UPDATE scheduled_posts SET user_id = ? WHERE id = ?').run('user-b', item.postId));
  assert.equal(f.db.prepare('PRAGMA foreign_key_check').all().length, 0);
});
test('AES-GCM uses random IVs, authenticates owner/context, and rejects tampering and bad keys', async t => {
  const f = setup(t); const context = tokenContext('a', 'facebook', '1');
  const a = await encryptToken(f.env, 'sensitive', context); const b = await encryptToken(f.env, 'sensitive', context);
  assert.notEqual(a, b); assert.ok(!a.includes('sensitive'));
  assert.equal(await decryptToken(f.env, a, context), 'sensitive');
  await assert.rejects(decryptToken(f.env, a, tokenContext('b', 'facebook', '1')));
  const parts = a.split('.'); parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  await assert.rejects(decryptToken(f.env, parts.join('.'), context));
  for (const key of ['', 'bad', Buffer.alloc(16).toString('base64')]) await assert.rejects(encryptToken({ ...f.env, SOCIAL_TOKEN_KEY: key }, 'sensitive', context));
  await assert.rejects(decryptToken({ ...f.env, SOCIAL_TOKEN_KEY: Buffer.alloc(32, 8).toString('base64') }, a, context));
});
test('router enforces session, origin, methods, and safe errors', async t => {
  const f = setup(t);
  const request = new Request('https://naka.test/api/other');
  assert.equal(await handleSocial(request, f.env, new URL(request.url), null), null);
  for (const route of ['accounts', 'posts', 'meta/start', 'meta/callback']) assert.equal((await f.call(route, { user: null })).status, 401);
  assert.equal((await f.call('uploads', { method: 'POST', user: null, body: mp4 })).status, 401);
  for (const Origin of ['', 'https://evil.test']) assert.equal((await f.send('posts', {}, { headers: { Origin } })).status, 403);
  assert.equal((await f.call('accounts/a', { method: 'DELETE', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  assert.equal((await f.call('https://evil.test/api/social/accounts')).status, 403);
  assert.equal((await f.call('unknown')).status, 404);
  const method = await f.call('uploads'); assert.equal(method.status, 405); assert.equal(method.headers.get('Allow'), 'POST');
  assert.equal(method.headers.get('Cache-Control'), 'no-store');
  assert.equal((await f.call('meta/start', { method: 'POST' })).status, 405);
});
test('missing R2, encryption key, and Meta config fail closed without HTTP', async t => {
  const f = setup(t, { MEDIA: undefined });
  assert.equal((await f.call('uploads', { method: 'POST', body: mp4 })).status, 503);
  assert.equal((await f.send('posts', {})).status, 503);
  f.env.SOCIAL_TOKEN_KEY = undefined;
  assert.equal((await f.call('meta/start')).status, 503);
  assert.equal(http.mock.callCount(), 0);
});
test('uploads check MIME, magic bytes, empty/declared/streamed size and persist ownership', async t => {
  const f = setup(t);
  const key = await f.upload(); await f.upload('user-b', 'video/webm');
  assert.equal(f.db.prepare('SELECT user_id FROM social_media WHERE key = ?').get(key).user_id, 'user-a');
  for (const [body, headers, expected] of [[mp4, { 'Content-Type': 'text/html' }, 400],
    [Buffer.alloc(0), { 'Content-Type': 'video/mp4' }, 400], [webm, { 'Content-Type': 'video/mp4' }, 400],
    [mp4, { 'Content-Type': 'video/mp4', 'Content-Length': String(MAX_UPLOAD + 1) }, 413]]) {
    assert.equal((await f.call('uploads', { method: 'POST', body, headers })).status, expected);
  }
  let cancelled = false;
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_UPLOAD)); controller.enqueue(new Uint8Array(1)); }, cancel() { cancelled = true; } });
  assert.equal((await f.call('uploads', { method: 'POST', body: stream, headers: { 'Content-Type': 'video/mp4', 'Content-Length': '1' } })).status, 413);
  assert.ok(cancelled); assert.equal(f.env.MEDIA.files.size, 2);
});
test('signed media works without a session and rejects tampering, expiry, duplicates, and missing files', async t => {
  const f = setup(t); const key = await f.upload(); const url = await signedMediaUrl(f.env, key);
  const response = await f.call(url, { user: null });
  assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), mp4);
  assert.equal(response.headers.get('Content-Type'), 'video/mp4');
  for (const bad of [url.replace('sig=', 'sig=x'), url + '&exp=1800003600', url.replace(key, crypto.randomUUID() + '.mp4'), url.replace('1800003600', '1800007200')])
    assert.equal((await f.call(bad, { user: null })).status, 403);
  await f.env.MEDIA.delete(key); assert.equal((await f.call(url, { user: null })).status, 404);
  time += 3600000; assert.equal((await f.call(url, { user: null })).status, 403);
});

async function start(f) {
  const response = await f.call('meta/start'); assert.equal(response.status, 302);
  return { url: new URL(response.headers.get('Location')), cookie: response.headers.get('Set-Cookie').split(';')[0], response };
}
const callback = (f, flow, suffix = '', opts = {}) => f.call(`meta/callback?state=${flow.url.searchParams.get('state')}&code=private-code${suffix}`, { headers: { Cookie: flow.cookie }, ...opts });
function oauthMock({ pages, failProfile = false } = {}) {
  http.mock.mockImplementation(async (input, init) => {
    const url = new URL(input); assert.equal(url.origin, 'https://graph.facebook.com');
    assert.equal(init.redirect, 'manual'); assert.ok(url.pathname.startsWith(`/${GRAPH_VERSION}/`));
    if (url.pathname.endsWith('/oauth/access_token')) {
      assert.equal(url.searchParams.get('client_secret'), 'test-app-secret');
      return Response.json({ access_token: 'private-user-token', expires_in: 5184000 });
    }
    if (url.pathname.endsWith('/me/accounts')) return Response.json(pages || { data: [{ id: '100', name: 'My Page', access_token: 'private-page-token', tasks: ['CREATE_CONTENT'], instagram_business_account: { id: '200' } }] });
    if (url.pathname.endsWith('/200')) return failProfile ? new Response('secret', { status: 500 }) : Response.json({ id: '200', username: 'my_instagram' });
    throw new Error('Unexpected provider request');
  });
}
test('OAuth binds state to user and cookie, consumes once, encrypts pages and linked Instagram', async t => {
  const f = setup(t); const flow = await start(f);
  assert.equal(flow.url.origin, 'https://www.facebook.com');
  assert.ok(flow.url.searchParams.get('scope').includes('instagram_content_publish'));
  assert.ok(flow.response.headers.get('Set-Cookie').includes('HttpOnly'));
  assert.notEqual(f.db.prepare('SELECT id FROM social_oauth_states').get().id, flow.url.searchParams.get('state'));
  oauthMock();
  const result = await callback(f, flow); assert.equal(result.headers.get('Location'), 'https://naka.test/app/?connected=meta');
  const rows = f.db.prepare('SELECT * FROM social_accounts').all(); assert.equal(rows.length, 2);
  for (const row of rows) assert.equal(await decryptToken(f.env, row.token_enc, tokenContext(row.user_id, row.platform, row.external_id)), 'private-page-token');
  assert.equal(count(f.db, 'social_oauth_states'), 0);
  assert.equal((await callback(f, flow)).headers.get('Location'), 'https://naka.test/app/?error=meta');
  const visible = await (await f.call('accounts')).json();
  assert.equal(visible.accounts.length, 2); assert.deepEqual(Object.keys(visible.accounts[0]).sort(), ['id', 'name', 'platform', 'status']);
  assert.deepEqual(await (await f.call('accounts', { user: 'user-b' })).json(), { accounts: [] });
});
test('OAuth rejects missing/duplicate/expired state, another session and denial before HTTP', async t => {
  const f = setup(t); const flow = await start(f);
  for (const response of [await callback(f, flow, '', { headers: {} }), await callback(f, flow, '&state=bad'),
    await callback(f, flow, '', { user: 'user-b' }), await callback(f, flow, '', { headers: { Cookie: `${flow.cookie}; ${flow.cookie}` } })])
    assert.ok(response.headers.get('Location').endsWith('error=meta'));
  assert.equal(http.mock.callCount(), 0);
  await callback(f, flow, '&error=access_denied'); assert.equal(count(f.db, 'social_oauth_states'), 0);
  const expired = await start(f); time += 600000; await callback(f, expired); assert.equal(http.mock.callCount(), 0);
});
test('parallel OAuth callbacks exchange once; reconnect retains local account IDs', async t => {
  const f = setup(t); const flow = await start(f); oauthMock();
  const results = await Promise.all([callback(f, flow), callback(f, flow)]);
  assert.equal(results.filter(r => r.headers.get('Location').endsWith('connected=meta')).length, 1);
  assert.equal(http.mock.callCount(), 4);
  const old = f.db.prepare('SELECT id FROM social_accounts ORDER BY id').all();
  await callback(f, await start(f)); assert.deepEqual(f.db.prepare('SELECT id FROM social_accounts ORDER BY id').all(), old);
});
test('OAuth handles denial, no eligible pages, malformed tokens, partial failures atomically', async t => {
  const f = setup(t);
  for (const options of [{ pages: { data: [] } }, { failProfile: true }, { pages: { data: [{ id: '100', access_token: 'private', name: 'Page', tasks: [] }] } }]) {
    const flow = await start(f); oauthMock(options); assert.ok((await callback(f, flow)).headers.get('Location').endsWith('error=meta'));
    assert.equal(count(f.db, 'social_accounts'), 0);
  }
  const flow = await start(f); http.mock.mockImplementation(async () => Response.json({ access_token: null }));
  await callback(f, flow); assert.equal(count(f.db, 'social_accounts'), 0);
});
test('OAuth pagination uses a fixed Graph host and cursor, never upstream next URL', async t => {
  const f = setup(t); const flow = await start(f); let pages = 0;
  http.mock.mockImplementation(async (input) => {
    const url = new URL(input); assert.equal(url.origin, 'https://graph.facebook.com');
    if (url.pathname.endsWith('oauth/access_token')) return Response.json({ access_token: 'private' });
    pages++;
    if (pages === 1) return Response.json({ data: [{ id: '100', name: 'One', access_token: 'private', tasks: ['MANAGE'] }], paging: { next: 'https://evil.test/steal', cursors: { after: 'safe-cursor' } } });
    assert.equal(url.searchParams.get('after'), 'safe-cursor');
    return Response.json({ data: [{ id: '101', name: 'Two', access_token: 'private', tasks: ['PROFILE_PLUS_CREATE_CONTENT'] }] });
  });
  assert.ok((await callback(f, flow)).headers.get('Location').endsWith('connected=meta'));
  assert.equal(count(f.db, 'social_accounts'), 2);
});
test('disconnect is owned, erases token, cancels queued jobs and never revokes another user', async t => {
  const f = setup(t); const item = await f.queue();
  assert.equal((await f.call(`accounts/${item.accountId}`, { method: 'DELETE', user: 'user-b' })).status, 204);
  assert.equal(f.post(item.postId).status, 'queued');
  assert.equal((await f.call(`accounts/${item.accountId}`, { method: 'DELETE' })).status, 204);
  const row = f.db.prepare('SELECT * FROM social_accounts').get(); assert.equal(row.token_enc, ''); assert.equal(row.status, 'revoked');
  assert.equal(f.post(item.postId).status, 'failed'); assert.deepEqual(await f.run(), { published: 0, failed: 0 });
  assert.equal(http.mock.callCount(), 0);
});
test('schedule validates ownership, expiry, caption, timestamps and Instagram format', async t => {
  const f = setup(t); const accountId = await f.addAccount('instagram'); const mediaKey = await f.upload();
  const body = { accountId, mediaKey, caption: 'ok' };
  assert.equal((await f.send('posts', body, { user: 'user-b' })).status, 404);
  const otherMedia = await f.upload('user-b'); assert.equal((await f.send('posts', { ...body, mediaKey: otherMedia })).status, 404);
  for (const patch of [{ caption: 'x'.repeat(2201) }, { publishAt: 'tomorrow' }, { publishAt: time / 1000 - 61 }, { publishAt: time / 1000 + 31 * 86400 }, { publishAt: null }])
    assert.equal((await f.send('posts', { ...body, ...patch })).status, 400);
  assert.equal((await f.send('posts', { ...body, mediaKey: await f.upload('user-a', 'video/webm') })).status, 400);
  f.db.exec(`UPDATE social_accounts SET token_expires_at = ${time / 1000 + 60}`);
  assert.equal((await f.send('posts', { ...body, publishAt: time / 1000 + 60 })).status, 409);
  assert.equal((await f.send('posts', body)).status, 202);
  assert.deepEqual(await (await f.call('posts', { user: 'user-b' })).json(), { posts: [] });
});
test('concurrent crons claim once, respect due time and maxPosts, send one Facebook publication', async t => {
  const f = setup(t); const item = await f.queue('facebook', { publishAt: time / 1000 + 60 });
  http.mock.mockImplementation(async (input, init) => {
    const url = new URL(input); assert.equal(url.origin, 'https://graph-video.facebook.com');
    assert.equal(url.pathname, `/${GRAPH_VERSION}/100/videos`); assert.equal(init.headers.Authorization, 'Bearer private-page-token');
    const body = new URLSearchParams(init.body); assert.equal(body.get('description'), 'ทดสอบ'); assert.ok(body.get('file_url').includes('&sig='));
    return Response.json({ id: '300' });
  });
  assert.deepEqual(await f.run(), { published: 0, failed: 0 }); time += 60000;
  const results = await Promise.all([f.run(1), f.run(1), f.run(1)]);
  assert.equal(results.reduce((n, r) => n + r.published, 0), 1); assert.equal(http.mock.callCount(), 1);
  assert.equal(f.post(item.postId).external_post_id, '300'); assert.equal(f.post(item.postId).status, 'published');
  await f.run(); assert.equal(http.mock.callCount(), 1);
  await assert.rejects(f.run(0)); await assert.rejects(f.run(21));
});
test('Instagram persists its container and polls on later cron before final publication', async t => {
  const f = setup(t); const item = await f.queue('instagram'); let ready = false; let creates = 0; let publishes = 0;
  http.mock.mockImplementation(async (input, init) => {
    const url = new URL(input);
    if (url.pathname.endsWith('/media')) { creates++; assert.equal(new URLSearchParams(init.body).get('media_type'), 'REELS'); return Response.json({ id: '400' }); }
    if (url.pathname.endsWith('/media_publish')) { publishes++; assert.equal(new URLSearchParams(init.body).get('creation_id'), '400'); return Response.json({ id: '500' }); }
    assert.equal(url.searchParams.get('fields'), 'status_code'); return Response.json({ status_code: ready ? 'FINISHED' : 'IN_PROGRESS' });
  });
  assert.deepEqual(await f.run(), { published: 0, failed: 0 }); assert.equal(f.post(item.postId).container_id, '400');
  assert.equal(f.post(item.postId).attempts, 0); assert.equal(f.post(item.postId).polls, 1);
  time += 60000; ready = true; assert.deepEqual(await f.run(), { published: 1, failed: 0 });
  assert.equal(creates, 1); assert.equal(publishes, 1); assert.equal(f.post(item.postId).external_post_id, '500');
});
test('transient preparation errors retry with backoff and exhaust at five; details sanitized', async t => {
  const f = setup(t); const item = await f.queue('instagram');
  http.mock.mockImplementation(async () => Response.json({ error: { code: 4, is_transient: true, message: 'private-page-token secret' } }, { status: 429 }));
  for (let attempt = 1; attempt <= 5; attempt++) {
    const result = await f.run(); const row = f.post(item.postId);
    assert.equal(row.attempts, attempt); assert.equal(row.status, attempt === 5 ? 'failed' : 'queued');
    assert.equal(result.failed, attempt === 5 ? 1 : 0);
    assert.ok(!row.error.includes('private')); assert.ok(row.error.includes('code_4'));
    time = row.next_attempt_at * 1000;
  }
  const visible = JSON.stringify(await (await f.call('posts')).json()); assert.ok(!visible.includes('code_4')); assert.ok(!visible.includes('lease_id'));
});
test('timeouts or malformed success after publishing are terminal to prevent duplicate posts', async t => {
  for (const reply of [() => { throw new Error('secret network timeout'); }, () => Response.json({ success: true })]) {
    const f = setup(t); const item = await f.queue(); http.mock.mockImplementation(async () => reply());
    assert.deepEqual(await f.run(), { published: 0, failed: 1 }); assert.equal(f.post(item.postId).phase, 'publish_sent');
    time += 86400000; await f.run(); assert.equal(http.mock.callCount(), 1);
  }
});
test('expired leases recover preparation only and quarantine uncertain publish', async t => {
  const f = setup(t); const item = await f.queue();
  f.db.prepare("UPDATE scheduled_posts SET status='publishing', lease_id='old', lease_until=?, phase='publish_sent', attempts=1 WHERE id=?").run(time / 1000 - 1, item.postId);
  assert.deepEqual(await f.run(), { published: 0, failed: 1 }); assert.equal(f.post(item.postId).error, 'publish_outcome_unknown');
  assert.equal(http.mock.callCount(), 0);
  f.db.prepare("UPDATE scheduled_posts SET status='publishing', lease_id='old', lease_until=?, phase='prepare' WHERE id=?").run(time / 1000 - 1, item.postId);
  http.mock.mockImplementation(async () => Response.json({ id: '300' })); assert.deepEqual(await f.run(), { published: 1, failed: 0 });
});
test('lease fencing stops an old worker before sending a final publication', async t => {
  const f = setup(t); const item = await f.queue('instagram');
  http.mock.mockImplementation(async input => {
    if (input.endsWith('/media')) return Response.json({ id: '400' });
    // Simulate a worker pausing until its lease is expired, without another publisher.
    time += 181000; return Response.json({ status_code: 'FINISHED' });
  });
  await f.run(); assert.equal(http.mock.callCount(), 2); assert.equal(f.post(item.postId).status, 'failed');
});
test('missing media, expired/revoked/disabled accounts never publish', async t => {
  for (const variant of ['media', 'expired', 'revoked', 'disabled']) {
    const f = setup(t); const item = await f.queue();
    if (variant === 'media') await f.env.MEDIA.delete(item.mediaKey);
    if (variant === 'expired') f.db.exec(`UPDATE social_accounts SET token_expires_at = ${time / 1000}`);
    if (variant === 'revoked') f.db.exec("UPDATE social_accounts SET status = 'revoked'");
    if (variant === 'disabled') f.db.exec("UPDATE users SET status = 'disabled'");
    assert.deepEqual(await f.run(), { published: 0, failed: 1 }); assert.equal(http.mock.callCount(), 0);
  }
});
test('Meta revoked token marks account unavailable and erases ciphertext', async t => {
  const f = setup(t); const item = await f.queue('instagram');
  http.mock.mockImplementation(async () => Response.json({ error: { code: 190, message: 'sensitive' } }, { status: 400 }));
  assert.deepEqual(await f.run(), { published: 0, failed: 1 });
  const account = f.db.prepare('SELECT status, token_enc FROM social_accounts WHERE id = ?').get(item.accountId);
  assert.equal(account.status, 'error'); assert.equal(account.token_enc, '');
});

test('explicit Facebook rate-limit rejection retries, but uncertain 5xx never retries publication', async t => {
  const f = setup(t); const item = await f.queue();
  http.mock.mockImplementation(async () => Response.json({ error: { code: 4 } }, { status: 429 }));
  assert.deepEqual(await f.run(), { published: 0, failed: 0 }); assert.equal(f.post(item.postId).phase, 'prepare');
  time += 60000; http.mock.mockImplementation(async () => new Response('secret', { status: 500 }));
  assert.deepEqual(await f.run(), { published: 0, failed: 1 });
  time += 3600000; await f.run(); assert.equal(http.mock.callCount(), 2);
});

test('Instagram processing deadline and provider error never reach media_publish', async t => {
  for (const status of ['ERROR', 'EXPIRED', 'PUBLISHED', 'IN_PROGRESS']) {
    const f = setup(t); const item = await f.queue('instagram');
    f.db.prepare("UPDATE scheduled_posts SET container_id = '400', polls = 30 WHERE id = ?").run(item.postId);
    http.mock.mockImplementation(async input => { assert.ok(!input.includes('media_publish')); return Response.json({ status_code: status }); });
    assert.deepEqual(await f.run(), { published: 0, failed: 1 }); assert.equal(http.mock.callCount(), 1);
  }
});

test('maxPosts limits work across several due posts', async t => {
  const f = setup(t); const item = await f.queue();
  await f.send('posts', { accountId: item.accountId, mediaKey: item.mediaKey, caption: 'Second' });
  http.mock.mockImplementation(async () => Response.json({ id: '300' }));
  assert.deepEqual(await f.run(1), { published: 1, failed: 0 }); assert.equal(http.mock.callCount(), 1);
  assert.equal(f.db.prepare("SELECT COUNT(*) AS n FROM scheduled_posts WHERE status = 'queued'").get().n, 1);
});

test('failed media metadata write removes the R2 object and exposes no database details', async t => {
  const f = setup(t);
  const prepare = f.env.DB.prepare.bind(f.env.DB);
  f.env.DB.prepare = query => query.startsWith('INSERT INTO social_media') ? { bind() { return this; }, async run() { throw new Error('private DB'); } } : prepare(query);
  const result = await f.call('uploads', { method: 'POST', body: mp4, headers: { 'Content-Type': 'video/mp4' } });
  assert.equal(result.status, 500); assert.ok(!(await result.text()).includes('private')); assert.equal(f.env.MEDIA.files.size, 0);
});

test('old revoked-token response cannot erase a token from a concurrent reconnect', async t => {
  const f = setup(t); const item = await f.queue('instagram');
  http.mock.mockImplementation(async () => {
    const encrypted = await encryptToken(f.env, 'replacement', tokenContext('user-a', 'instagram', '200'));
    f.db.prepare('UPDATE social_accounts SET token_enc = ? WHERE id = ?').run(encrypted, item.accountId);
    return Response.json({ error: { code: 190 } }, { status: 400 });
  });
  await f.run(); const account = f.db.prepare('SELECT * FROM social_accounts').get();
  assert.equal(account.status, 'active');
  assert.equal(await decryptToken(f.env, account.token_enc, tokenContext('user-a', 'instagram', '200')), 'replacement');
});
