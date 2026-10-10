// Site content from the back office (src/content/*, migrations/pg/0008_site_content.sql): the home page's clip
// gallery (hide, order, upload) and announcements, and how pages are served with them.
const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `site-content-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const { parseGallery, renderGallery, forgetShowcase } = require(path.join(buildDir, 'content/showcase.js'));

const TOKEN = 'test-only-admin-token';
const HOME = readFileSync(path.join(root, 'public/index.html'), 'utf8');
let sqlite, db, env, media;
const t = () => Math.floor(Date.now() / 1000);

/** public/ as the Assets binding serves it: "/" is index.html, with an ETag */
const assets = { async fetch(request) {
  const p = new URL(request.url).pathname;
  if (p === '/' || p === '/index.html') return new Response(HOME, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"file"' } });
  if (p === '/pricing/') return new Response('<html><head><title>x</title></head><body>ราคา</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"p"' } });
  if (p === '/admin/') return new Response('<html><head></head><body>admin</body></html>', { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"a"' } });
  if (p === '/app.js') return new Response('js', { headers: { 'Content-Type': 'text/javascript', ETag: '"js"' } });
  return new Response('Not Found', { status: 404 });
} };
/** the R2 calls the app makes, in memory */
function memoryBucket() {
  const files = new Map();
  return { files,
    async put(key, value, options = {}) { files.set(key, { bytes: new Uint8Array(value), type: options.httpMetadata?.contentType }); },
    async get(key, options = {}) {
      const f = files.get(key); if (!f) return null;
      const offset = options.range?.offset ?? 0, length = options.range?.length ?? f.bytes.length - offset;
      const part = f.bytes.slice(offset, offset + length);
      return { key, size: f.bytes.length, httpMetadata: { contentType: f.type }, body: new Blob([part]).stream() };
    },
    async delete(keys) { for (const k of [].concat(keys)) files.delete(k); } };
}

beforeEach(() => {
  ({ sqlite, db } = migratedDb());
  media = memoryBucket();
  env = { DB: db, ADMIN_TOKEN: TOKEN, APP_ORIGIN: 'https://naka.test', SESSION_SECRET: 's'.repeat(40), ASSETS: assets, MEDIA: media };
  forgetShowcase();
});
afterEach(() => sqlite.close());
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const site = (pathname, init = {}, e = env) => worker.fetch(new Request('https://naka.test' + pathname, {
  ...init, headers: { Authorization: 'Bearer ' + TOKEN, ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) },
  ...(init.json !== undefined ? { body: JSON.stringify(init.json) } : {}) }), e, { waitUntil() {} });
const tabCount = (html, tab) => Number(new RegExp(`data-tab="${tab}"[^>]*>[^<]*<span>(\\d+)</span>`).exec(html)[1]);
const MP4 = () => { const b = new Uint8Array(64); b.set([0, 0, 0, 24], 0); b.set([...'ftypisom'].map(c => c.charCodeAt(0)), 4); return b; };
const PNG = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
function uploadForm(fields = {}, files = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ category: 'review', title: 'ครีม <b>ใหม่</b>', subtitle: 'จากรูปเดียว', chip: 'ความงาม', ...fields })) form.append(k, v);
  form.append('video', new File([files.video ?? MP4()], 'a.mp4', { type: 'video/mp4' }));
  form.append('poster', new File([files.poster ?? PNG()], 'a.png', { type: 'image/png' }));
  return form;
}

test('the written gallery: every card found once, with a stable id and its category', () => {
  const { cards } = parseGallery(HOME);
  assert.ok(cards.length >= 70, `${cards.length} cards`);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length, 'ids are unique');
  assert.ok(cards.every(c => c.id.startsWith('static:') && c.html.startsWith('<article') && c.html.endsWith('</article>')));
  assert.deepEqual([...new Set(cards.map(c => c.category))].sort(), ['bot', 'drama', 'live', 'naka', 'review']);
  assert.equal(cards[0].id, 'static:/showcase/h3/review-soap.mp4');
  assert.equal(cards[0].title, 'สบู่สมุนไพรทำมือ');
  assert.ok(cards.some(c => c.id.startsWith('static:chat:') && !c.video));
  assert.equal(renderGallery(HOME, []), HOME, 'no rows: the page exactly as written');
});

test('render: hidden cards leave, the order is applied, uploads are escaped, and the counts follow', () => {
  const { cards } = parseGallery(HOME);
  const firstReview = cards.find(c => c.category === 'review');
  const lastDrama = cards.filter(c => c.category === 'drama').at(-1);
  const rows = [
    { id: firstReview.id, kind: 'static', category: '', title: '', subtitle: '', chip: '', video_key: null, poster_key: null, hidden: 1, sort: null },
    { id: lastDrama.id, kind: 'static', category: '', title: '', subtitle: '', chip: '', video_key: null, poster_key: null, hidden: 0, sort: -5 },
    { id: 'u1', kind: 'upload', category: 'live', title: '<img src=x onerror=alert(1)>', subtitle: '', chip: '', video_key: 'showcase/v.mp4', poster_key: 'showcase/p.jpg', hidden: 0, sort: -10 },
  ];
  const out = renderGallery(HOME, rows);
  assert.ok(!out.includes(firstReview.html), 'hidden card removed');
  const order = parseGallery(out).cards;
  assert.equal(order[0].id, 'static:/showcase-media/showcase/v.mp4', 'the upload first (lowest sort)');
  assert.equal(order[1].id, lastDrama.id, 'then the card moved up');
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;') && !out.includes('<img src=x onerror'), 'admin text is escaped');
  assert.equal(tabCount(out, 'review'), tabCount(HOME, 'review') - 1);
  assert.equal(tabCount(out, 'live'), tabCount(HOME, 'live') + 1);
  assert.equal(tabCount(out, 'all'), order.length);
  assert.match(out, new RegExp(`คลังคลิปจริง · ${order.filter(c => c.video).length} คลิป`));
});

test('pages as served: "/" carries the managed gallery with no stale ETag; other files untouched; the menu script loads the announcement', async () => {
  const plain = await site('/');
  const html = await plain.text();
  assert.equal(plain.headers.get('etag'), null);
  assert.equal(html, HOME, 'nothing changes while there are no rows');
  const conditional = await site('/', { headers: { 'If-None-Match': '"file"' } });
  assert.equal(conditional.status, 200, 'never a 304 that skips the managed parts');

  const { cards } = parseGallery(HOME);
  sqlite.prepare("INSERT INTO showcase_clips (id, kind, hidden, updated_at) VALUES (?, 'static', 1, 1)").run(cards[0].id);
  forgetShowcase();
  assert.ok(!(await (await site('/')).text()).includes(cards[0].html));

  assert.equal((await site('/pricing/')).headers.get('etag'), '"p"', 'only the home page is rewritten');
  assert.match(readFileSync(path.join(root, 'public/account-menu.js'), 'utf8'), /announce\.js/);
  const js = await site('/app.js');
  assert.equal(js.headers.get('etag'), '"js"');
});

test('admin clips: the catalogue in page order, hide and show, a full reorder; a stale order is refused', async () => {
  const r = await (await site('/api/admin/content/clips')).json();
  assert.equal(r.mediaReady, true);
  const ids = r.clips.map(c => c.id);
  assert.equal(ids[0], 'static:/showcase/h3/review-soap.mp4');

  let clips = (await (await site('/api/admin/content/clips/' + encodeURIComponent(ids[0]), { method: 'PUT', json: { hidden: true } })).json()).clips;
  assert.equal(clips[0].hidden, true);
  assert.ok(!(await (await site('/')).text()).includes('/showcase/h3/review-soap.mp4'), 'the page changes at once');
  assert.equal((await site('/api/admin/content/clips/' + encodeURIComponent(ids[0]), { method: 'PUT', json: { hidden: 'yes' } })).status, 400);
  assert.equal((await site('/api/admin/content/clips/static%3Anope', { method: 'PUT', json: { hidden: true } })).status, 404);

  const reversed = [...ids].reverse();
  clips = (await (await site('/api/admin/content/clips/order', { method: 'PUT', json: { ids: reversed } })).json()).clips;
  assert.deepEqual(clips.map(c => c.id), reversed);
  for (const bad of [ids.slice(1), [...ids.slice(1), ids[1]], [...ids.slice(1), 'static:x']]) {
    assert.equal((await site('/api/admin/content/clips/order', { method: 'PUT', json: { ids: bad } })).status, 409);
  }
  const audit = sqlite.prepare("SELECT target, action FROM system_audit WHERE area = 'content' ORDER BY rowid").all();
  assert.deepEqual(audit.map(a => a.action), ['update', 'update']);
});

test('admin clips: upload checks the real file types, goes first, is served with byte ranges, and deleting removes the files', async () => {
  const post = (form, e = env) => worker.fetch(new Request('https://naka.test/api/admin/content/clips', { method: 'POST', body: form,
    headers: { Authorization: 'Bearer ' + TOKEN } }), e, { waitUntil() {} });
  assert.equal((await post(uploadForm({}, { video: PNG() }))).status, 400, 'a PNG named .mp4 is refused');
  assert.equal((await post(uploadForm({}, { poster: MP4() }))).status, 400);
  assert.equal((await post(uploadForm({ category: 'nope' }))).status, 400);
  assert.equal((await post(uploadForm({ title: '' }))).status, 400);
  assert.equal((await post(uploadForm(), { ...env, MEDIA: undefined })).status, 503);
  assert.equal(media.files.size, 0, 'nothing stored by refused uploads');

  const created = await post(uploadForm());
  assert.equal(created.status, 201);
  const { id, clips } = await created.json();
  assert.equal(clips[0].id, id);
  assert.equal(clips[0].kind, 'upload');
  assert.deepEqual([...media.files.keys()].sort(), [`showcase/${id}.mp4`, `showcase/${id}.png`]);
  const home = await (await site('/')).text();
  assert.ok(home.includes(`/showcase-media/showcase/${id}.mp4`));
  assert.ok(home.includes('ครีม &lt;b&gt;ใหม่&lt;/b&gt;') && home.includes('<span class="g-chip">ความงาม</span>'));

  const whole = await site(`/showcase-media/showcase/${id}.mp4`);
  assert.equal(whole.status, 200); assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal((await whole.arrayBuffer()).byteLength, 64);
  const part = await site(`/showcase-media/showcase/${id}.mp4`, { headers: { Range: 'bytes=4-11' } });
  assert.equal(part.status, 206); assert.equal(part.headers.get('content-range'), 'bytes 4-11/64');
  assert.equal(new TextDecoder().decode(await part.arrayBuffer()), 'ftypisom');
  assert.equal((await site(`/showcase-media/showcase/${id}.mp4`, { headers: { Range: 'bytes=999-' } })).status, 416);
  assert.equal((await site('/showcase-media/../secret')).status, 404);
  assert.equal((await site('/showcase-media/marketer/u/out/x.mp4')).status, 404, 'only showcase files are public here');

  const staticId = clips.find(c => c.kind === 'static').id;
  assert.equal((await site('/api/admin/content/clips/' + encodeURIComponent(staticId), { method: 'DELETE' })).status, 400);
  const after = (await (await site('/api/admin/content/clips/' + id, { method: 'DELETE' })).json()).clips;
  assert.ok(!after.some(c => c.id === id));
  assert.equal(media.files.size, 0);
  assert.deepEqual(sqlite.prepare("SELECT action FROM system_audit WHERE area = 'content' ORDER BY rowid").all().map(a => a.action), ['create', 'remove']);
});

test('announcements: validated, the newest live one is public, scheduled and switched-off ones are not', async () => {
  const create = (json) => site('/api/admin/content/announcements', { method: 'POST', json });
  for (const bad of [{ message: '', tone: 'info' }, { message: 'x', tone: 'loud' }, { message: 'x', tone: 'info', linkUrl: 'javascript:alert(1)', linkLabel: 'a' },
    { message: 'x', tone: 'info', linkUrl: '//evil.test', linkLabel: 'a' }, { message: 'x', tone: 'info', linkUrl: '/pricing/' }, { message: 'a\nb', tone: 'info' },
    { message: 'x', tone: 'info', startsAt: 100, endsAt: 50 }]) {
    assert.equal((await create(bad)).status, 400, JSON.stringify(bad));
  }
  const empty = await site('/api/announcement');
  assert.deepEqual(await empty.json(), { announcement: null });
  assert.equal(empty.headers.get('cache-control'), 'public, max-age=60');

  const now = t();
  let list = (await (await create({ message: 'ปิดปรับปรุงคืนนี้', tone: 'warning', linkUrl: '/status/', linkLabel: 'ดูเวลา' })).json()).announcements;
  const first = list[0];
  assert.equal(first.state, 'showing');
  list = (await (await create({ message: 'โปรหน้า', tone: 'promo', startsAt: now + 3600 })).json()).announcements;
  assert.deepEqual(list.map(a => a.state), ['scheduled', 'showing']);
  assert.deepEqual((await (await site('/api/announcement')).json()).announcement,
    { id: first.id, message: 'ปิดปรับปรุงคืนนี้', linkUrl: '/status/', linkLabel: 'ดูเวลา', tone: 'warning' });

  list = (await (await site('/api/admin/content/announcements/' + first.id, { method: 'PUT', json: { active: false } })).json()).announcements;
  assert.equal(list.find(a => a.id === first.id).state, 'off');
  assert.deepEqual(await (await site('/api/announcement')).json(), { announcement: null });
  assert.equal((await site('/api/admin/content/announcements/' + first.id, { method: 'DELETE' })).status, 200);
  assert.equal((await site('/api/admin/content/announcements/' + first.id, { method: 'DELETE' })).status, 404);
  assert.deepEqual(sqlite.prepare("SELECT action FROM system_audit WHERE area = 'content' ORDER BY rowid").all().map(a => a.action), ['create', 'create', 'update', 'remove']);

  // maintenance closes the customer API, but the announcement explaining it still shows
  await create({ message: 'ปิดปรับปรุง', tone: 'warning' });
  const closed = await site('/api/announcement', {}, { ...env, FEATURE_MAINTENANCE: 'on' });
  assert.equal(closed.status, 200);
  assert.equal((await closed.json()).announcement.message, 'ปิดปรับปรุง');
});
