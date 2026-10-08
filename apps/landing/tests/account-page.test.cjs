// Phase 8B — /app/account/ page tests (docs/phase8-account.md §8B).
// Runs the shipped account.js in a node:vm sandbox with a minimal DOM harness
// (same pattern as tests/admin-customers.test.cjs) — fetch is always mocked,
// no live HTTP. Also asserts the account-menu link added for this phase.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { readFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const accountSource = readFileSync(path.join(root, 'public/app/account/account.js'), 'utf8');
const menuSource = readFileSync(path.join(root, 'public/account-menu.js'), 'utf8');
const pageSource = readFileSync(path.join(root, 'public/app/account/index.html'), 'utf8');

after(() => { /* no build dir — plain-file tests only */ });

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.children = []; this.listeners = {};
    this.value = ''; this.hidden = false; this.disabled = false;
    this.className = ''; this.textContent = ''; this.attributes = {};
  }
  appendChild(node) { this.children.push(node); return node; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  focus() {}
  async fire(name) { await this.listeners[name]?.({ preventDefault() {} }); }
}

// Minimal DOM harness: auto-creates elements by id, records fetch calls and
// location.replace targets, flushes the microtask queue with settle().
function ui({ mock = null, meStatus = 200, meBody = null, changeStatus = 200, changeBody = { ok: true } } = {}) {
  class FakeResponse {
    constructor(body, status) { this.body = JSON.stringify(body); this.status = status; this.ok = status >= 200 && status < 300; }
    async json() { return JSON.parse(this.body); }
  }
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const requests = [];
  const redirects = [];
  const fetch = async (url, options) => {
    const parsed = new URL(url, 'https://naka.test');
    requests.push({ path: parsed.pathname, options: options || {}, body: (options && options.body) || null });
    if (parsed.pathname === '/api/auth/me') return new FakeResponse(meBody ?? { error: 'กรุณาเข้าสู่ระบบ' }, meStatus);
    if (parsed.pathname === '/api/auth/password/change') return new FakeResponse(changeBody, changeStatus);
    return new FakeResponse({ error: 'ไม่พบเส้นทาง' }, 404);
  };
  const document = { getElementById: $, createElement: (tag) => new Element(tag), activeElement: null };
  // Mirror the initial hidden attributes from public/app/account/index.html.
  ['page', 'page-error', 'password-section', 'no-password'].forEach((id) => { $(id).hidden = true; });
  const sandbox = {
    document, fetch,
    location: { search: mock ? '?mock=' + mock : '', replace: (target) => redirects.push(target) },
    URLSearchParams, Response, Number, Error, encodeURIComponent, console,
  };
  vm.runInNewContext(accountSource, sandbox);
  const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };
  return {
    $, settle, requests, redirects,
    card: (id) => $(id),
    fill: (id, value) => { $(id).value = value; },
    async submit() { await $('password-form').fire('submit'); await settle(); },
  };
}

const changeCalls = (requests) => requests.filter((r) => r.path === '/api/auth/password/change');

test('mock=plain (ไม่มีรหัสผ่าน): ซ่อนฟอร์ม แสดงข้อความ Google และข้อมูลบัญชี', async () => {
  const page = ui({ mock: 'plain', meBody: null });
  await page.settle();
  assert.equal(page.$('page').hidden, false);
  assert.equal(page.$('password-section').hidden, true, 'form hidden without hasPassword');
  assert.equal(page.$('no-password').hidden, false);
  assert.equal(page.$('account-name').textContent, 'ผู้ใช้ทดลอง');
  assert.equal(page.$('account-contact').textContent, 'trial@naka-ai.com');
  assert.equal(page.$('account-credits').textContent, '0');
  assert.equal(page.redirects.length, 0);
});

test('mock=1 (มีรหัสผ่าน): แสดงฟอร์มเปลี่ยนรหัสผ่าน', async () => {
  const page = ui({ mock: '1' });
  await page.settle();
  assert.equal(page.$('password-section').hidden, false);
  assert.equal(page.$('no-password').hidden, true);
});

test('ยืนยันรหัสไม่ตรงกัน / สั้นกว่า 8 → แสดงข้อผิดพลาดในหน้า และไม่เรียก API', async () => {
  const page = ui({ mock: '1' });
  await page.settle();
  page.fill('current-password', 'OldPass1');
  page.fill('new-password', 'NewPass123');
  page.fill('confirm-password', 'NewPass999');
  await page.submit();
  assert.match(page.$('password-status').textContent, /ไม่ตรงกัน/);
  assert.equal(changeCalls(page.requests).length, 0, 'no API call on mismatch');

  page.fill('confirm-password', 'NewPass123');
  page.fill('new-password', 'short');
  page.fill('confirm-password', 'short');
  await page.submit();
  assert.match(page.$('password-status').textContent, /8 ตัวอักษร/);
  assert.equal(changeCalls(page.requests).length, 0, 'still no API call on short password');
});

test('เปลี่ยนสำเร็จ → ข้อความยืนยัน ล้างทุกช่อง และ body ตรงสัญญา', async () => {
  // Non-mock: /api/auth/me answers with hasPassword (what 8A adds), so the
  // password POST reaches the harness fetch and is recorded.
  const page = ui({ meBody: { user: { displayName: 'ผู้ใช้ทดลอง', email: 'trial@naka-ai.com', phone: null }, credits: 3, hasPassword: true } });
  await page.settle();
  assert.equal(page.$('password-section').hidden, false);
  page.fill('current-password', 'OldPass1');
  page.fill('new-password', 'NewPass123');
  page.fill('confirm-password', 'NewPass123');
  await page.submit();
  assert.equal(page.$('password-status').textContent, 'เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นออกจากระบบแล้ว');
  assert.equal(page.$('current-password').value, '');
  assert.equal(page.$('new-password').value, '');
  assert.equal(page.$('confirm-password').value, '');
  const calls = changeCalls(page.requests);
  assert.equal(calls.length, 1);
  assert.deepEqual(JSON.parse(calls[0].body), { currentPassword: 'OldPass1', newPassword: 'NewPass123' });
});

test('error จาก API แสดงผลเป็นภาษาไทยที่ server ส่งมา', async () => {
  const page = ui({ meBody: { user: { displayName: 'ผู้ใช้ทดลอง', email: 'trial@naka-ai.com', phone: null }, credits: 3, hasPassword: true }, changeStatus: 400, changeBody: { error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' } });
  await page.settle();
  page.fill('current-password', 'WrongPass1');
  page.fill('new-password', 'NewPass123');
  page.fill('confirm-password', 'NewPass123');
  await page.submit();
  assert.equal(page.$('password-status').textContent, 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
});

test('ไม่ล็อกอิน → เด้งไป /login/ พร้อม next กลับหน้าบัญชี', async () => {
  const page = ui({ meStatus: 401 });
  await page.settle();
  assert.match(page.redirects[0], /\/login\/\?next=/);
  assert.ok(decodeURIComponent(page.redirects[0]).includes('/app/account/'));
});

test('ลิงก์ "บัญชีของฉัน" ถูกเพิ่มในเมนูบัญชี และหน้าไม่ใช้ innerHTML', () => {
  assert.match(menuSource, /textContent = "บัญชีของฉัน"/);
  assert.match(menuSource, /href = "\/app\/account\/"/);
  assert.match(pageSource, /บัญชีนี้เข้าสู่ระบบด้วย Google/, 'no-password message lives in the page markup');
  assert.ok(!accountSource.includes('innerHTML'), 'textContent only — no innerHTML');
  assert.ok(pageSource.includes('robots" content="noindex'), 'account page is noindex');
});
