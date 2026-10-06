const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readdirSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `marketer-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const { normalizeTrending, parseMetric } = require(path.join(buildDir, 'marketer/trending.js'));
const { runQueue } = require(path.join(buildDir, 'jobs.js'));
const { makeMarketerHandlers } = require(path.join(buildDir, 'marketer/ai.js'));
const migrations = readdirSync(path.join(root, 'migrations')).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
const ORIGIN = 'https://naka.test';
const TOKEN = 'test-only-admin-token';
const now = () => Math.floor(Date.now() / 1000);
const sha = value => createHash('sha256').update(value).digest('base64url');
let sqlite, db, env, http, pending;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...migrations));
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40), ANTHROPIC_API_KEY: 'test-anthropic-key',
    ASSETS: { fetch: async () => new Response('asset') } };
  http = mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected external request'); });
  pending = [];
});
afterEach(() => { sqlite.close(); http.mock.restore(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const ctx = { waitUntil: p => pending.push(p) };
const site = (pathname, init = {}) => worker.fetch(new Request(ORIGIN + pathname, init), env, ctx);
let counter = 0;
function customer(credits = 5) {
  const id = 'u' + ++counter, token = String(counter).padStart(43, 'c');
  sqlite.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(id, 'ร้าน', now());
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha(token), id, now() + 86400, now());
  if (credits) sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason) VALUES (?, ?, 'grant')").run(id, credits);
  return { id, cookie: 'naka_session=' + token };
}
const post = (pathname, body, cookie, headers = {}) => site(pathname, { method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: cookie, ...headers }, body: JSON.stringify(body) });
const balance = id => sqlite.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE user_id = ?').get(id).n;
function seedVideo(fields = {}) {
  const row = { id: crypto.randomUUID(), url: 'https://www.tiktok.com/@shop/video/' + ++counter, category: 'beauty', views: 1000, likes: 50,
    comments: 5, shares: 5, revenue: null, title: 'คลิป', created: now(), active: 1, ...fields };
  sqlite.prepare(`INSERT INTO trending_videos (id, source, url, category, title, views, likes, comments, shares, revenue_thb, active, created_at, updated_at)
    VALUES (?, 'curated', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(row.id, row.url, row.category, row.title, row.views, row.likes, row.comments, row.shares, row.revenue, row.active, row.created, row.created);
  return row;
}
/** An Anthropic Messages API reply carrying `output` as the structured JSON text. */
function anthropicReply(output, stop = 'end_turn') {
  return new Response(JSON.stringify({ id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(output) }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }),
  { headers: { 'Content-Type': 'application/json' } });
}
const INSIGHT = { title: 'รายงาน', summary: 'สรุป', sections: [{ heading: 'ตลาด', points: ['ข้อ 1'] }], actions: [{ title: 'ทำ', detail: 'รายละเอียด', when: 'สัปดาห์นี้' }], caveats: [] };

test('metrics and export rows from FastMoss/Kalodata-style files normalize to baht, Thai categories and clean links', () => {
  assert.equal(parseMetric('13.84M'), 13840000); assert.equal(parseMetric('$726K'), 726000); assert.equal(parseMetric('฿1,234'), 1234);
  assert.equal(parseMetric('2.1万'), 21000); assert.equal(parseMetric('1.5 ล้าน'), 1500000); assert.equal(parseMetric('n/a'), null);
  const row = normalizeTrending({ 'Video URL': 'https://www.tiktok.com/@shop/video/1?is_from_webapp=1&_r=1', 'Play Count': '5.23M', 'Revenue': '$160K',
    Category: 'Beauty & Personal Care', 'Video Title': 'ใหม่ เซราวี', Likes: '12K', Country: 'Thailand' }, 36);
  assert.equal(row.url, 'https://www.tiktok.com/@shop/video/1'); assert.equal(row.views, 5230000); assert.equal(row.revenueThb, 160000 * 36);
  assert.equal(row.category, 'beauty'); assert.equal(row.region, 'TH'); assert.equal(row.likes, 12000);
  // A baht column is never converted; a dollar column without a rate is unknown.
  assert.equal(normalizeTrending({ url: 'https://vt.tiktok.com/abc/', 'Revenue THB': '50000', 'Revenue USD': '9' }, 36).revenueThb, 50000);
  assert.equal(normalizeTrending({ url: 'https://vt.tiktok.com/abc/', 'Revenue USD': '9' }).revenueThb, null);
  assert.equal(normalizeTrending({ url: 'https://vt.tiktok.com/x/', หมวดสินค้า: 'อาหารเสริม' }).category, 'health');
  for (const url of ['http://www.tiktok.com/@a/video/1', 'https://evil.test/video', 'https://user:pw@tiktok.com/x', 'javascript:alert(1)']) {
    assert.ok('error' in normalizeTrending({ url }), url);
  }
});

test('trending is public, filtered by category, views and date, sorted, and hides inactive clips; the switch closes it', async () => {
  seedVideo({ category: 'beauty', views: 5_000_000, revenue: 100, title: 'ครีม' });
  seedVideo({ category: 'beauty', views: 50_000, revenue: 900_000, likes: 20_000, title: 'เซรั่ม' });
  seedVideo({ category: 'food', views: 2_000_000, title: 'ขนม', created: now() - 40 * 86400 });
  seedVideo({ category: 'beauty', views: 9_000_000, title: 'ซ่อน', active: 0 });
  const list = async q => (await (await site('/api/marketer/trending' + q)).json()).videos.map(v => v.title);
  assert.deepEqual(await list(''), ['ครีม', 'ขนม', 'เซรั่ม']);
  assert.deepEqual(await list('?category=beauty&sort=revenue'), ['เซรั่ม', 'ครีม']);
  assert.deepEqual(await list('?sort=engagement'), ['เซรั่ม', 'ขนม', 'ครีม']); // 60 of 2M beats 60 of 5M
  assert.deepEqual(await list('?views=over_1m'), ['ครีม', 'ขนม']);
  assert.deepEqual(await list('?days=30'), ['ครีม', 'เซรั่ม']);
  assert.deepEqual(await list("?category=' OR 1=1"), ['ครีม', 'ขนม', 'เซรั่ม']);
  const video = (await (await site('/api/marketer/trending?category=beauty&sort=revenue')).json()).videos[0];
  assert.equal(video.categoryLabel, 'ความงามและของใช้ส่วนตัว'); assert.equal(video.engagement, 40); // (20,000 + 5 + 5) of 50,000
  // Through the panel, which also clears the settings cache.
  const off = await site('/api/admin/system/settings/FEATURE_MARKETER', { method: 'PUT',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, body: JSON.stringify({ value: 'off' }) });
  assert.equal(off.status, 200);
  assert.equal((await site('/api/marketer/trending')).status, 503);
});

test('tasks need a session, our origin and credits; a queued insight holds one credit and runs right away', async () => {
  const shop = customer(1);
  assert.equal((await post('/api/marketer/tasks/insight', { prompt: 'วิเคราะห์' }, '')).status, 401);
  assert.equal((await post('/api/marketer/tasks/insight', { prompt: 'วิเคราะห์' }, shop.cookie, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await post('/api/marketer/tasks/insight', { prompt: '' }, shop.cookie)).status, 400);
  assert.equal((await post('/api/marketer/tasks/bulk', { productName: 'สบู่', brief: 'บรีฟ', count: 11 }, shop.cookie)).status, 400);
  seedVideo({ title: 'คลิปเซรั่มขายดี', views: 3_000_000, revenue: 250_000 });
  let sent;
  http.mock.mockImplementation(async (url, init) => { sent = { url: String(url), body: JSON.parse(init.body) }; return anthropicReply(INSIGHT); });
  const created = await post('/api/marketer/tasks/insight', { templateId: 'trending_products', prompt: 'สินค้ามาแรงในหมวดความงาม', expert: 'tiktok_shop', category: 'beauty' }, shop.cookie);
  assert.equal(created.status, 202);
  const { jobId } = await created.json();
  assert.equal(balance(shop.id), 0);
  await Promise.all(pending);
  assert.match(sent.url, /\/v1\/messages/);
  assert.equal(sent.body.model, 'claude-opus-5-5');
  assert.equal(sent.body.output_config.format.type, 'json_schema');
  assert.match(sent.body.system, /TikTok Shop/); assert.match(sent.body.system, /อย\./);
  assert.match(sent.body.messages[0].content[0].text, /คลิปเซรั่มขายดี/); // grounded on the trending table
  const done = await (await site('/api/marketer/tasks/' + jobId, { headers: { Cookie: shop.cookie } })).json();
  assert.equal(done.status, 'done'); assert.deepEqual(done.output, INSIGHT);
  // Out of credits now; another customer cannot read this task.
  assert.equal((await post('/api/marketer/tasks/insight', { prompt: 'อีกงาน' }, shop.cookie)).status, 402);
  assert.equal((await site('/api/marketer/tasks/' + jobId, { headers: { Cookie: customer().cookie } })).status, 404);
  const history = await (await site('/api/marketer/tasks', { headers: { Cookie: shop.cookie } })).json();
  assert.deepEqual(history.tasks.map(t => [t.kind, t.status, t.title]), [['insight', 'done', 'สินค้ามาแรงตอนนี้']]);
});

test('without an AI key a task fails permanently and the credit comes back', async () => {
  const shop = customer(1);
  env.ANTHROPIC_API_KEY = '';
  const { jobId } = await (await post('/api/marketer/tasks/bulk', { productName: 'สบู่', brief: 'สบู่มะลิ 129 บาท', count: 3, duration: 15 }, shop.cookie)).json();
  await Promise.all(pending);
  const task = await (await site('/api/marketer/tasks/' + jobId, { headers: { Cookie: shop.cookie } })).json();
  assert.equal(task.status, 'failed'); assert.match(task.error, /ยังไม่เปิดใช้งาน/);
  assert.equal(balance(shop.id), 1);
});

test('recreate sends the video stills as images in order with the clip metrics, never more than eight', async () => {
  const shop = customer(3);
  const video = seedVideo({ title: 'ฮุกแรง', views: 2_000_000, revenue: 70_000 });
  const frame = Buffer.from('fake-jpeg').toString('base64');
  assert.equal((await post('/api/marketer/tasks/recreate', { frames: Array(9).fill(frame), productName: 'สบู่', newContent: 'ใหม่' }, shop.cookie)).status, 400);
  assert.equal((await post('/api/marketer/tasks/recreate', { productName: 'สบู่', newContent: 'ใหม่' }, shop.cookie)).status, 400);
  let sent;
  const output = { original: { hook: 'h', structure: 's', pacing: 'p', whyItWorks: ['w'], shots: [] }, remake: { title: 't', hook: 'h', shots: [], caption: 'c', hashtags: [], productionNotes: [] } };
  http.mock.mockImplementation(async (url, init) => { sent = JSON.parse(init.body); return anthropicReply(output); });
  await post('/api/marketer/tasks/recreate', { mode: 'replace', frames: [frame, frame, frame], seconds: 30, trendingId: video.id,
    productName: 'สบู่มะลิ', newContent: 'แม่ค้าถือสบู่', channel: 'shopee' }, shop.cookie);
  await Promise.all(pending);
  const content = sent.messages[0].content;
  assert.deepEqual(content.filter(b => b.type === 'image').map(b => b.source.media_type), ['image/jpeg', 'image/jpeg', 'image/jpeg']);
  assert.match(content[0].text, /วินาทีที่ 0/); assert.match(content[2].text, /วินาทีที่ 10/);
  const last = content[content.length - 1].text;
  assert.match(last, /ฮุกแรง/); assert.match(last, /2,000,000/); assert.match(last, /70,000 บาท/);
  assert.match(sent.system, /โหมดเปลี่ยนองค์ประกอบ/); assert.match(sent.system, /Shopee/);
});

test('a refused or cut-off answer never shows as a finished task', async () => {
  const shop = customer(2);
  http.mock.mockImplementation(async () => anthropicReply({}, 'refusal'));
  const { jobId } = await (await post('/api/marketer/tasks/insight', { prompt: 'x' }, shop.cookie)).json();
  await Promise.all(pending);
  const task = await (await site('/api/marketer/tasks/' + jobId, { headers: { Cookie: shop.cookie } })).json();
  assert.equal(task.status, 'failed'); assert.match(task.error, /ไม่สามารถทำงานนี้/); assert.equal(balance(shop.id), 2);
});

test('product pages: Open Graph and JSON-LD are read, private redirects refused, images only through signed links', async () => {
  const shop = customer();
  const html = `<html><head><title>ไม่ใช้</title><meta property="og:title" content="สบู่มะลิ &amp; ใบเตย | Shopee Thailand">
    <meta property="og:image" content="https://cf.shopee.co.th/file/abc"><meta name="description" content="หอมนาน">
    <script type="application/ld+json">{"@type":"Product","offers":{"price":"129","priceCurrency":"THB"},"image":["https://cf.shopee.co.th/file/one"]}</script></head></html>`;
  http.mock.mockImplementation(async (url) => {
    if (String(url).startsWith('https://shop.example.co.th/item')) return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    if (String(url) === 'https://shop.example.co.th/redirect') return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/admin' } });
    if (String(url) === 'https://cf.shopee.co.th/file/one') return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    if (String(url) === 'https://cf.shopee.co.th/file/abc') return new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } });
    throw new Error('unexpected ' + url);
  });
  assert.equal((await post('/api/marketer/product', { url: 'https://shop.example.co.th/item/1' }, '')).status, 401);
  const product = await (await post('/api/marketer/product', { url: 'https://shop.example.co.th/item/1' }, shop.cookie)).json();
  assert.equal(product.productName, 'สบู่มะลิ & ใบเตย'); assert.equal(product.price, '129 บาท'); assert.equal(product.description, 'หอมนาน');
  assert.equal(product.images.length, 2); assert.ok(product.images.every(src => src.startsWith('/api/marketer/image?')));
  const image = await site(product.images[0]);
  assert.equal(image.status, 200); assert.equal(image.headers.get('content-type'), 'image/jpeg');
  assert.equal((await site(product.images[1])).status, 415); // svg is not passed through
  const forged = product.images[0].replace(/u=[^&]+/, 'u=' + encodeURIComponent('https://evil.test/x.jpg'));
  assert.equal((await site(forged)).status, 403);
  for (const url of ['http://shop.example.co.th/item', 'https://127.0.0.1/x', 'https://localhost/x', 'https://intranet/x']) {
    assert.equal((await post('/api/marketer/product', { url }, shop.cookie)).status, 400, url);
  }
  const redirect = await post('/api/marketer/product', { url: 'https://shop.example.co.th/redirect' }, shop.cookie);
  assert.equal(redirect.status, 400); assert.match((await redirect.json()).error, /เปิดไม่ได้/);
});

test('admins curate the gallery: add with TikTok oEmbed, edit, import a USD export, delete; customers cannot', async () => {
  const admin = { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' };
  const call = (p, method, body) => site('/api/admin/marketer/trending' + p, { method, headers: admin, ...(body ? { body: JSON.stringify(body) } : {}) });
  http.mock.mockImplementation(async (url) => {
    assert.match(String(url), /^https:\/\/www\.tiktok\.com\/oembed\?url=/);
    return Response.json({ title: 'แกะกล่องหมอนโรงแรม', author_name: 'ร้านหมอน', thumbnail_url: 'https://p16.tiktokcdn.com/cover.jpg' });
  });
  assert.equal((await site('/api/admin/marketer/trending')).status, 401);
  let data = await (await call('', 'POST', { url: 'https://www.tiktok.com/@pillow/video/77', category: 'home', views: '1.19M', revenue: '411K' })).json();
  const added = data.videos[0];
  assert.equal(added.title, 'แกะกล่องหมอนโรงแรม'); assert.equal(added.views, 1190000); assert.equal(added.revenue, 411000); assert.equal(added.source, 'curated');
  assert.equal(added.thumbnail, 'https://p16.tiktokcdn.com/cover.jpg');
  data = await (await call('/' + added.id, 'PATCH', { active: false, category: 'kitchen' })).json();
  assert.equal(data.videos[0].active, false); assert.equal(data.videos[0].category, 'kitchen');
  assert.equal((await call('/' + added.id, 'PATCH', { category: 'nope' })).status, 400);
  data = await (await call('/import', 'POST', { currency: 'USD', usdRate: 35, rows: [
    { 'Video Link': 'https://www.tiktok.com/@a/video/1', Views: '2.3M', GMV: '1,000', Category: 'Food & Beverages' },
    { 'Video Link': 'https://www.tiktok.com/@a/video/1', Views: '1', GMV: '1' },
    { 'Video Link': 'not a link' },
    { 'Video Link': 'https://www.tiktok.com/@pillow/video/77', Views: '2M' },
  ] })).json();
  assert.equal(data.imported, 2); assert.equal(data.skippedCount, 1);
  const food = data.videos.find(v => v.url.endsWith('/video/1'));
  assert.equal(food.revenue, 35000); assert.equal(food.category, 'food'); assert.equal(food.source, 'import');
  const pillow = data.videos.find(v => v.id === added.id);
  assert.equal(pillow.views, 2000000); assert.equal(pillow.source, 'curated'); assert.equal(pillow.active, false); // an import updates numbers only
  assert.equal((await call('/import', 'POST', { currency: 'USD', rows: [{}] })).status, 400);
  assert.equal((await call('/sync', 'POST')).status, 400); // no API configured
  data = await (await call('/' + added.id, 'DELETE')).json();
  assert.equal(data.videos.some(v => v.id === added.id), false);
});

test('the provider API sync maps a wrapped list and keeps the key in the Authorization header', async () => {
  env.TRENDING_API_URL = 'https://data.example.com/trending';
  env.TRENDING_API_KEY = 'provider-key';
  http.mock.mockImplementation(async (url, init) => {
    assert.equal(String(url), 'https://data.example.com/trending');
    assert.equal(init.headers.Authorization, 'Bearer provider-key');
    return Response.json({ data: [{ video_url: 'https://www.tiktok.com/@x/video/9', play_count: 1200000, gmv: 5000, category_name: 'Pet Supplies' }, { video_url: 'bad' }] });
  });
  const res = await site('/api/admin/marketer/trending/sync', { method: 'POST', headers: { Authorization: 'Bearer ' + TOKEN } });
  const data = await res.json();
  assert.equal(data.imported, 1); assert.equal(data.skipped, 1);
  assert.equal(data.videos[0].category, 'pets'); assert.equal(data.videos[0].source, 'api');
});

test('the queue knows every marketer job kind', () => {
  assert.deepEqual(Object.keys(makeMarketerHandlers(env)).sort(), ['marketer_bulk', 'marketer_insight', 'marketer_recreate']);
  assert.equal(typeof runQueue, 'function');
});
