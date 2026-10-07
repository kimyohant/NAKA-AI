const assert = require('node:assert/strict');
const { after, beforeEach, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { migratedDb } = require('./helpers/d1.cjs');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `works-tests-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir,
], { cwd: root, stdio: 'inherit' });
const { handleWorks } = require(path.join(buildDir, 'works', 'index.js'));
const { AFFILIATE_JOB_KIND } = require(path.join(buildDir, 'affiliate.js'));
after(() => rmSync(buildDir, { recursive: true, force: true }));

let sqlite;
let db;
beforeEach(() => ({ sqlite, db } = migratedDb('0002_credits_jobs.sql', '0006_jobs_limit.sql')));

function insert(id, { userId = 'u1', kind = AFFILIATE_JOB_KIND, status = 'queued', input = '{}', createdAt = '2026-09-30 10:00:00', finishedAt = null } = {}) {
  sqlite.prepare(`INSERT INTO jobs (id,user_id,kind,status,input,output,cost_credits,provider_cost_usd,error,created_at,finished_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(id, userId, kind, status, input, '{"audio":"secret-base64"}', 1, 9.99, 'provider secret', createdAt, finishedAt);
}

async function call(pathname = '/api/works', method = 'GET', userId = 'u1') {
  const url = new URL(pathname, 'https://naka.test');
  return handleWorks(new Request(url, { method }), { DB: db }, url, userId);
}

test('route only lists the signed-in user’s affiliate review jobs', async () => {
  insert('own', { input: JSON.stringify({ productName: 'สบู่มะลิ' }), status: 'done' });
  insert('other-user', { userId: 'u2' });
  insert('inbox', { kind: 'inbox_reply' });
  assert.equal(await call('/api/health'), null);
  const response = await call();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    works: [{ id: 'own', kind: AFFILIATE_JOB_KIND, title: 'สบู่มะลิ', status: 'done', costCredits: 1,
      createdAt: '2026-09-30 10:00:00', finishedAt: null, href: '/review/?job=own' }], next: null,
  });
  assert.deepEqual((await (await call('/api/works', 'GET', 'u2')).json()).works.map(w => w.id), ['other-user']);
  const badMethod = await call('/api/works', 'POST');
  assert.equal(badMethod.status, 405);
  assert.equal(badMethod.headers.get('Cache-Control'), 'no-store');
  assert.match((await badMethod.json()).error, /[ก-๙]/);
});

test('done and failed rows expose only safe fields; malformed titles fall back', async () => {
  insert('done', { status: 'done', input: JSON.stringify({ productName: 'ก'.repeat(90) }), finishedAt: '2026-09-30 10:01:00' });
  insert('failed', { status: 'failed', input: '{broken' });
  insert('missing', { input: JSON.stringify({ details: 'no name' }) });
  const response = await call();
  const { works } = await response.json();
  assert.equal(works.find(w => w.id === 'done').title.length, 80);
  assert.equal(works.find(w => w.id === 'done').finishedAt, '2026-09-30 10:01:00');
  assert.equal(works.find(w => w.id === 'failed').status, 'failed');
  assert.equal(works.find(w => w.id === 'failed').title, 'คลิปรีวิว');
  assert.equal(works.find(w => w.id === 'missing').title, 'คลิปรีวิว');
  for (const work of works) {
    assert.deepEqual(Object.keys(work).sort(), ['costCredits', 'createdAt', 'finishedAt', 'href', 'id', 'kind', 'status', 'title'].sort());
    assert.doesNotMatch(JSON.stringify(work), /secret|provider_cost_usd|output|input|error/);
  }
  const invalid = await call('/api/works?before=bad!');
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('Cache-Control'), 'no-store');
  assert.match((await invalid.json()).error, /[ก-๙]/);
});

test('database failure returns a non-cacheable Thai error without exposing details', async () => {
  const url = new URL('https://naka.test/api/works');
  const broken = { DB: { prepare() { throw new Error('private database details'); } } };
  const response = await handleWorks(new Request(url), broken, url, 'u1');
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.text();
  assert.match(body, /[ก-๙]/);
  assert.doesNotMatch(body, /private database details/);
});

test('45 jobs with matching timestamps paginate in descending order without gaps or duplicates', async () => {
  for (let i = 0; i < 45; i++) {
    insert(`job-${String(i).padStart(2, '0')}`, { createdAt: i < 35 ? '2026-09-30 10:00:00' : '2026-09-29 10:00:00' });
  }
  const ids = [];
  let cursor = null;
  const sizes = [];
  do {
    const response = await call(cursor ? `/api/works?before=${encodeURIComponent(cursor)}` : '/api/works');
    const page = await response.json();
    sizes.push(page.works.length);
    ids.push(...page.works.map(w => w.id));
    cursor = page.next;
  } while (cursor);
  assert.deepEqual(sizes, [20, 20, 5]);
  assert.equal(new Set(ids).size, 45);
  const descendingIds = (start, end) => Array.from({ length: start - end + 1 }, (_, i) => `job-${String(start - i).padStart(2, '0')}`);
  assert.deepEqual(ids, [...descendingIds(34, 0), ...descendingIds(44, 35)]);
});

test('review page immediately fetches ?job= on load and shows the existing job status', async () => {
  class Element {
    constructor() { this.hidden = false; this.textContent = ''; this.listeners = {}; this.style = {}; this.value = ''; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren() {}
    append() {}
  }
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement: () => new Element() };
  const requests = [];
  const timers = [];
  vm.runInNewContext(readFileSync(path.join(root, 'public/review/review.js'), 'utf8'), {
    document, location: { search: '?job=saved-123', href: 'https://naka.test/review/?job=saved-123' },
    URLSearchParams, URL, Date, Array, FormData, encodeURIComponent,
    setTimeout: (fn, delay) => { timers.push({ fn, delay }); return timers.length; }, clearTimeout: () => {},
    fetch: async (url) => { requests.push(url); return new Response(JSON.stringify({ status: 'running' })); },
  });
  assert.deepEqual(requests, ['/api/affiliate/reviews/saved-123']);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('review-form').hidden, true);
  assert.equal(document.getElementById('review-panel').hidden, false);
  assert.match(document.getElementById('panel-status').textContent, /กำลังเขียนบท/);
  assert.deepEqual(timers.map(t => t.delay), [3000]);
});

test('review page puts a successfully submitted job into the refreshable URL', async () => {
  class Element {
    constructor() { this.hidden = false; this.textContent = ''; this.listeners = {}; this.style = {}; this.value = ''; this.files = []; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    replaceChildren() {}
    append() {}
  }
  const nodes = new Map();
  const document = { getElementById(id) { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); }, createElement: () => new Element() };
  const replaced = [];
  let nextBlob = 0;
  class FakeURL extends URL {}
  FakeURL.createObjectURL = () => `blob:${++nextBlob}`;
  FakeURL.revokeObjectURL = () => {};
  vm.runInNewContext(readFileSync(path.join(root, 'public/review/review.js'), 'utf8'), {
    document, location: { search: '?name=สบู่', href: 'https://naka.test/review/?name=%E0%B8%AA%E0%B8%9A%E0%B8%B9%E0%B9%88' },
    history: { replaceState: (...args) => replaced.push(args) },
    URLSearchParams, URL: FakeURL, Date, Array, encodeURIComponent,
    FormData: class { constructor() {} *[Symbol.iterator]() { yield ['productName', 'สบู่']; yield ['details', 'กลิ่นมะลิ']; yield ['channel', 'tiktok']; yield ['tone', 'friendly']; } },
    setTimeout: () => 1, clearTimeout: () => {},
    fetch: async () => new Response(JSON.stringify({ jobId: 'new-123' }), { status: 202 }),
  });
  const file = { type: 'image/png', size: 100 };
  document.getElementById('review-images').files = [file];
  document.getElementById('review-images').listeners.change();
  await document.getElementById('review-form').listeners.submit({ preventDefault() {} });
  assert.equal(replaced.length, 1);
  assert.equal(replaced[0][2], '/review/?name=%E0%B8%AA%E0%B8%9A%E0%B8%B9%E0%B9%88&job=new-123');
});
