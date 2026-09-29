const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { Miniflare, convertV4MiniflareOptions, Response: RuntimeResponse } = require('miniflare');
const root = path.resolve(__dirname, '../../..');

test('workerd + D1 + R2: OAuth, real session, upload, signed URL, concurrent cron and disconnect', { timeout: 60000 }, async () => {
  // The production router belongs to Claude. This harness uses its required requireUser contract.
  const built = await build({ stdin: { contents: `
    import { handleSocial, publishDuePosts } from './src/social';
    import { requireUser } from './src/auth';
    import { signedMediaUrl } from './src/social/media';
    export default { async fetch(request, env) {
      const url = new URL(request.url);
      if (url.pathname === '/test/cron') return Response.json(await publishDuePosts(env, { maxPosts: 2 }));
      if (url.pathname === '/test/sign') return Response.json({ url: await signedMediaUrl(env, url.searchParams.get('key')) });
      const user = url.pathname.startsWith('/api/social/media/') ? null : await requireUser(request, env);
      return await handleSocial(request, env, url, user?.id ?? null) ?? new Response(null, { status: 404 });
    } };`, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022' });
  let publications = 0; let mediaUrl; let outbound = 0;
  const options = { modules: true, script: built.outputFiles[0].text, compatibilityDate: '2026-09-01', cf: false,
    d1Databases: ['DB'], r2Buckets: ['MEDIA'], bindings: { APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 'test-session-secret-at-least-32-characters',
      META_APP_ID: '12345', META_APP_SECRET: 'test-meta-secret', SOCIAL_TOKEN_KEY: Buffer.alloc(32, 7).toString('base64') },
    outboundService: async request => {
      outbound++;
      const url = new URL(request.url);
      assert.ok(['graph.facebook.com', 'graph-video.facebook.com'].includes(url.hostname));
      if (url.pathname.endsWith('/oauth/access_token')) return RuntimeResponse.json({ access_token: 'mock-user-token', expires_in: 5184000 });
      if (url.pathname.endsWith('/me/accounts')) return RuntimeResponse.json({ data: [{ id: '100', name: 'Mock Page', access_token: 'mock-page-token', tasks: ['CREATE_CONTENT'] }] });
      assert.ok(url.pathname.endsWith('/100/videos'));
      assert.equal(request.headers.get('Authorization'), 'Bearer mock-page-token');
      const body = new URLSearchParams(await request.text()); mediaUrl = body.get('file_url'); publications++;
      return RuntimeResponse.json({ id: '300' });
    },
  };
  const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);
  try {
    const db = await mf.getD1Database('DB');
    const sql = ['0001_auth.sql', '0003_social.sql'].map(name => readFileSync(path.join(root, 'migrations', name), 'utf8')).join('\n').replace(/--[^\r\n]*/g, '');
    for (const statement of sql.split(';').map(value => value.trim()).filter(Boolean)) await db.prepare(statement).run();
    const now = Math.floor(Date.now() / 1000);
    await db.prepare("INSERT INTO users (id, created_at) VALUES ('member', ?)").bind(now).run();
    const token = Buffer.alloc(32, 5).toString('base64url');
    const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))).toString('base64url');
    await db.prepare("INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 'member', ?, ?)").bind(hash, now + 3600, now).run();
    const cookie = `naka_session=${token}`;
    const call = (route, options = {}) => mf.dispatchFetch(route.startsWith('https:') ? route : `https://naka.test${route}`, {
      redirect: 'manual', ...options, headers: { Origin: 'https://naka.test', Cookie: cookie, ...options.headers },
    });
    assert.equal((await call('/api/social/accounts', { headers: { Cookie: '' } })).status, 401);
    const start = await call('/api/social/meta/start'); assert.equal(start.status, 302);
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const stateCookie = start.headers.get('Set-Cookie').split(';')[0];
    const connected = await call(`/api/social/meta/callback?state=${state}&code=mock-code`, { headers: { Cookie: `${cookie}; ${stateCookie}` } });
    assert.equal(connected.headers.get('Location'), 'https://naka.test/app/?connected=meta');
    const account = (await (await call('/api/social/accounts')).json()).accounts[0];
    const stored = await db.prepare('SELECT token_enc FROM social_accounts').first(); assert.ok(stored.token_enc.startsWith('v1.')); assert.ok(!stored.token_enc.includes('mock-page-token'));
    const clip = Buffer.from([0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0]);
    const upload = await call('/api/social/uploads', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: clip });
    assert.equal(upload.status, 201, await upload.clone().text());
    const { mediaKey } = await upload.json();
    const enqueue = await call('/api/social/posts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountId: account.id, mediaKey, caption: 'Runtime test' }) });
    assert.equal(enqueue.status, 202, await enqueue.clone().text());
    const results = await Promise.all([call('/test/cron'), call('/test/cron')]);
    const totals = await Promise.all(results.map(r => r.json())); assert.equal(totals.reduce((sum, row) => sum + row.published, 0), 1); assert.equal(publications, 1);
    const downloaded = await call(mediaUrl, { headers: { Cookie: '' } }); assert.equal(downloaded.status, 200);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), clip);
    assert.equal((await call(mediaUrl.replace('sig=', 'sig=bad'), { headers: { Cookie: '' } })).status, 403);
    assert.equal((await call(`/api/social/accounts/${account.id}`, { method: 'DELETE' })).status, 204);
    assert.equal((await db.prepare('SELECT token_enc FROM social_accounts').first()).token_enc, '');
    const posts = (await (await call('/api/social/posts')).json()).posts; assert.equal(posts[0].externalPostId, '300');
    assert.equal(outbound, 4);
  } finally { await mf.dispose(); }
});
