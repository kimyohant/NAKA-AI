// /app/ dashboard: package line and credit history from GET /api/me/credits.
// Runs the shipped public/app/app.js in node:vm with a minimal DOM (same pattern as account-page.test.cjs).
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const appSource = readFileSync(path.join(root, 'public/app/app.js'), 'utf8');
const pageSource = readFileSync(path.join(root, 'public/app/index.html'), 'utf8');

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
    this.hidden = false; this.disabled = false; this.className = ''; this.textContent = '';
  }
  appendChild(node) { this.children.push(node); return node; }
  append(...nodes) { nodes.forEach((n) => this.children.push(n)); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  async fire(name) { await this.listeners[name]?.({ preventDefault() {} }); }
}

const DAY = 86400;
const now = () => Math.floor(Date.now() / 1000);

function ui({ pages = [], failFirst = false, mock = false, works = null } = {}) {
  class FakeResponse {
    constructor(body, status) { this.body = JSON.stringify(body); this.status = status; this.ok = status >= 200 && status < 300; }
    async json() { return JSON.parse(this.body); }
  }
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  ['app-content', 'app-error', 'plan-panel', 'plan-warn', 'history-list', 'history-more', 'works-list'].forEach((id) => { $(id).hidden = true; });
  const requests = [];
  let failures = failFirst ? 1 : 0;
  const fetch = async (url) => {
    const parsed = new URL(url, 'https://naka.test');
    requests.push(parsed.pathname + parsed.search);
    if (parsed.pathname === '/api/me/works') return works ? new FakeResponse(works, 200) : new FakeResponse({ error: 'ไม่พบเส้นทาง' }, 404);
    if (parsed.pathname !== '/api/me/credits') return new FakeResponse({ error: 'ไม่พบเส้นทาง' }, 404);
    if (failures > 0) { failures--; return new FakeResponse({ error: 'ล่ม' }, 500); }
    const before = parsed.searchParams.get('before');
    return new FakeResponse(pages[before === null ? 0 : Number(before === String(pages[0].next) ? 1 : 2)], 200);
  };
  const NakaAuth = {
    installMockFetch() {},
    me: async () => ({ status: 'signed-in', user: { displayName: 'สมใจ ใจดี' }, credits: 1, features: [], source: mock ? 'mock' : 'server' }),
    signOut: async () => ({ confirmed: true }),
  };
  const sandbox = {
    window: { NakaAuth }, document: { getElementById: $, createElement: (tag) => new Element(tag) }, fetch,
    location: { search: mock ? '?mock=1' : '', replace() {}, assign() {}, reload() {} },
    URLSearchParams, encodeURIComponent, console,
  };
  vm.runInNewContext(appSource, sandbox);
  const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r)); };
  const rows = () => $('history-list').children.map((li) => [li.children[0].children[0].textContent, li.children[1].textContent, li.className]);
  return { $, settle, requests, rows };
}

const entry = (id, delta, title, createdAt = '2026-10-09 07:15:00') => ({ id, delta, kind: 'job', title, createdAt });

test('balance, package with the next monthly credits, and history rows (+ in green class, − with U+2212)', async () => {
  const expiresAt = now() + 40 * DAY;
  const page = ui({ pages: [{ balance: 72, plan: { name: 'โปร', period: 'monthly', expiresAt, nextCreditAt: now() + 9 * DAY },
    entries: [entry(3, -8, 'ใช้งานใน Naka Studio'), entry(2, 1200, 'เติมเครดิตจากการซื้อแพ็กเกจ')], next: null }] });
  await page.settle();
  assert.equal(page.$('credits-value').textContent, '72', 'balance from /api/me/credits wins over /api/auth/me');
  assert.equal(page.$('plan-panel').hidden, false);
  assert.equal(page.$('plan-name').textContent, 'แพ็กเกจโปร');
  assert.equal(page.$('plan-period').textContent, 'รายเดือน');
  assert.match(page.$('plan-dates').textContent, /^ใช้ได้ถึง .+ · เครดิตรอบถัดไป /);
  assert.equal(page.$('plan-warn').hidden, true, 'no warning 40 days ahead');
  assert.deepEqual(page.rows(), [
    ['ใช้งานใน Naka Studio', '−8', 'history-item is-out'],
    ['เติมเครดิตจากการซื้อแพ็กเกจ', '+1,200', 'history-item is-in'],
  ]);
  assert.match(page.$('history-list').children[0].children[0].children[1].textContent, /2569/, 'Thai Buddhist-era date');
  assert.equal(page.$('history-list').hidden, false);
  assert.equal(page.$('history-status').hidden, true);
  assert.equal(page.$('history-more').hidden, true);
  assert.deepEqual(page.requests.sort(), ['/api/me/credits?limit=10', '/api/me/works']);
});

test('package ending within 7 days warns; no package says so; empty history explains itself', async () => {
  const soon = ui({ pages: [{ balance: 5, plan: { name: 'เริ่มต้น', period: 'yearly', expiresAt: now() + 3 * DAY + 60, nextCreditAt: null }, entries: [], next: null }] });
  await soon.settle();
  assert.equal(soon.$('plan-period').textContent, 'รายปี');
  assert.equal(soon.$('plan-warn').hidden, false);
  assert.match(soon.$('plan-warn').textContent, /หมดอายุในอีก 4 วัน/);
  assert.match(soon.$('history-status').textContent, /ยังไม่มีรายการเครดิต/);
  assert.equal(soon.$('history-list').hidden, true);

  const free = ui({ pages: [{ balance: 3, plan: null, entries: [entry(1, 3, 'เครดิตต้อนรับสมาชิกใหม่')], next: null }] });
  await free.settle();
  assert.equal(free.$('plan-name').textContent, 'ยังไม่มีแพ็กเกจ');
  assert.match(free.$('plan-dates').textContent, /ซื้อแพ็กเกจ/);
});

test('"ดูรายการก่อนหน้า" loads the next page with the cursor and hides when there is no more', async () => {
  const page = ui({ pages: [
    { balance: 0, plan: null, entries: [entry(9, -1, 'ก')], next: 9 },
    { balance: 0, plan: null, entries: [entry(4, -1, 'ข')], next: null },
  ] });
  await page.settle();
  assert.equal(page.$('history-more').hidden, false);
  assert.equal(page.$('history-more').textContent, 'ดูรายการก่อนหน้า');
  await page.$('history-more').fire('click');
  await page.settle();
  assert.deepEqual(page.requests.filter((r) => r.startsWith('/api/me/credits')), ['/api/me/credits?limit=10', '/api/me/credits?limit=10&before=9']);
  assert.deepEqual(page.rows().map((r) => r[0]), ['ก', 'ข']);
  assert.equal(page.$('history-more').hidden, true);
});

test('a failed load keeps the dashboard and offers a retry in this section only', async () => {
  const page = ui({ failFirst: true, pages: [{ balance: 9, plan: null, entries: [entry(1, 9, 'ค')], next: null }] });
  await page.settle();
  assert.equal(page.$('app-content').hidden, false);
  assert.match(page.$('history-status').textContent, /โหลดประวัติเครดิตไม่สำเร็จ/);
  assert.equal(page.$('history-more').textContent, 'ลองอีกครั้ง');
  await page.$('history-more').fire('click');
  await page.settle();
  assert.deepEqual(page.rows().map((r) => r[0]), ['ค']);
  assert.equal(page.$('history-status').hidden, true);
});

test('?mock=1 shows sample rows without calling the API; the page has the new sections', async () => {
  const page = ui({ mock: true });
  await page.settle();
  assert.deepEqual(page.requests, []);
  assert.ok(page.rows().length > 0);
  for (const id of ['plan-panel', 'plan-name', 'plan-dates', 'plan-warn', 'history-title', 'history-status', 'history-list', 'history-more']) {
    assert.match(pageSource, new RegExp(`id="${id}"`), id);
  }
  assert.doesNotMatch(appSource, /innerHTML/);
});

test('latest works: links into the studio with kind, status and date; an empty list says how to start; no studio keeps the button', async () => {
  const page = ui({ pages: [{ balance: 0, plan: null, entries: [], next: null }], works: { available: true, works: [
    { kind: 'drama', kindLabel: 'ละครสั้น', title: 'รักในออฟฟิศ', status: 'กำลังทำ', updatedAt: '2026-10-09T08:10:00.000Z', href: 'https://studio.naka.test/drama/7' },
  ] } });
  await page.settle();
  const list = page.$('works-list');
  assert.equal(list.hidden, false);
  const link = list.children[0].children[0];
  assert.equal(link.href, 'https://studio.naka.test/drama/7');
  assert.deepEqual(link.children.map((n) => n.textContent.split(' · ')[0]), ['ละครสั้น', 'รักในออฟฟิศ', 'กำลังทำ']);
  assert.match(link.children[2].textContent, /แก้ล่าสุด .*2569/, 'an ISO date from the studio');
  assert.match(page.$('works-note').textContent, /1 รายการ/);

  const empty = ui({ pages: [{ balance: 0, plan: null, entries: [], next: null }], works: { available: true, works: [] } });
  await empty.settle();
  assert.match(empty.$('works-note').textContent, /ยังไม่มีผลงาน/);
  assert.equal(empty.$('works-list').hidden, true);

  const off = ui({ pages: [{ balance: 0, plan: null, entries: [], next: null }], works: { available: false, works: [] } });
  await off.settle();
  assert.equal(off.$('works-list').hidden, true);
  assert.equal(off.$('works-note').textContent, '', 'the page text from index.html stays');
  assert.match(pageSource, /id="works-list"/);
});
