// GET /api/me/works (src/me/works.ts): the member's latest Naka Studio works, asked server to server.
const assert = require('node:assert/strict');
const { after, afterEach, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `member-works-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const { handleMemberWorks, statusLabel } = require(path.join(buildDir, 'me', 'works.js'));
after(() => rmSync(buildDir, { recursive: true, force: true }));

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ENV = { STUDIO_URL: 'https://studio.naka.test', STUDIO_INTERNAL_URL: 'http://studio:5679', STUDIO_ADMIN_TOKEN: 'studio-admin-token' };
async function call(env = ENV, { method = 'GET', userId = 'user-1', pathname = '/api/me/works' } = {}) {
  const url = new URL(pathname, 'https://naka.test');
  const res = await handleMemberWorks(new Request(url, { method }), env, url, userId);
  return res && { status: res.status, body: await res.json() };
}
function studioAnswers(works, status = 200) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify({ code: status, data: { works } }), { status });
  };
  return calls;
}

test('asks the studio for the signed-in member only, with the admin token, never following redirects', async () => {
  const calls = studioAnswers([
    { kind: 'drama', id: 7, title: 'รักในออฟฟิศ', status: 'draft', updatedAt: '2026-10-09T08:10:00.000Z', path: '/drama/7' },
    { kind: 'product_video', id: 3, title: 'รีวิวสบู่', status: 'completed', updatedAt: '2026-10-08T03:00:00.000Z', path: '/studio/3' },
    { kind: 'seller', id: 2, title: '', status: 'generating', updatedAt: null, path: '/seller/2' },
  ]);
  const res = await call(ENV, { userId: 'u/1 & x' });
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://studio:5679/api/v1/system/member-works?owner=u%2F1%20%26%20x&limit=5');
  assert.equal(calls[0].init.headers['X-Admin-Token'], 'studio-admin-token');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(res.body, { available: true, works: [
    { kind: 'drama', kindLabel: 'ละครสั้น', title: 'รักในออฟฟิศ', status: 'ร่าง', updatedAt: '2026-10-09T08:10:00.000Z', href: 'https://studio.naka.test/drama/7' },
    { kind: 'product_video', kindLabel: 'วิดีโอรีวิวสินค้า', title: 'รีวิวสบู่', status: 'เสร็จแล้ว', updatedAt: '2026-10-08T03:00:00.000Z', href: 'https://studio.naka.test/studio/3' },
    { kind: 'seller', kindLabel: 'โพสต์ขาย', title: 'โพสต์ขาย', status: 'กำลังทำ', updatedAt: null, href: 'https://studio.naka.test/seller/2' },
  ] });
  assert.ok(!JSON.stringify(res.body).includes('studio-admin-token'));
});

test('only links into the studio\'s own work pages', async () => {
  studioAnswers([
    { kind: 'drama', title: 'x', path: '//evil.example/drama/1' },
    { kind: 'drama', title: 'x', path: '/drama/1?next=https://evil.example' },
    { kind: 'unknown', title: 'x', path: '/drama/1' },
    { kind: 'campaign', title: 'แคมเปญ', status: 'active', path: '/marketer/9' },
  ]);
  const { body } = await call();
  assert.deepEqual(body.works.map(w => w.href), ['https://studio.naka.test/marketer/9']);
});

test('no studio, no token, a studio error or no answer: the dashboard still loads ({ available: false })', async () => {
  const unavailable = { available: false, works: [] };
  globalThis.fetch = async () => { throw new Error('should not be called'); };
  assert.deepEqual((await call({ ...ENV, STUDIO_ADMIN_TOKEN: '' })).body, unavailable);
  assert.deepEqual((await call({ ...ENV, STUDIO_ACCESS: 'off' })).body, unavailable);
  assert.deepEqual((await call({ ...ENV, STUDIO_INTERNAL_URL: 'studio:5679' })).body, unavailable);
  studioAnswers([], 401);
  assert.deepEqual((await call()).body, unavailable);
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  assert.deepEqual((await call()).body, unavailable);
  studioAnswers([]);
  assert.deepEqual((await call()).body, { available: true, works: [] });
  assert.equal((await call(ENV, { method: 'POST' })).status, 405);
  assert.equal(await call(ENV, { pathname: '/api/me/credits' }), null);
});

test('statusLabel: the studio\'s statuses in member words', () => {
  assert.equal(statusLabel('draft'), 'ร่าง');
  assert.equal(statusLabel('COMPLETED'), 'เสร็จแล้ว');
  assert.equal(statusLabel('failed'), 'ไม่สำเร็จ');
  assert.equal(statusLabel('rendering'), 'กำลังทำ');
});
