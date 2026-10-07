// Phase 9B — password reset UI tests (docs/phase9-password-reset.md).
// Two harnesses run the SHIPPED scripts in node:vm with a minimal DOM and a
// mocked fetch (no live HTTP): (1) the login page forgot flow, (2) the
// /login/reset/ page. Also file-level checks for markup and links.
const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const loginSource = readFileSync(path.join(root, 'public/login/login.js'), 'utf8');
const resetSource = readFileSync(path.join(root, 'public/login/reset/reset.js'), 'utf8');
const loginHtml = readFileSync(path.join(root, 'public/login/index.html'), 'utf8');
const resetHtml = readFileSync(path.join(root, 'public/login/reset/index.html'), 'utf8');
const configBody = { turnstileSiteKey: null, lineLogin: false, googleLogin: true, phoneLogin: true, passwordLogin: true, passwordReset: true };

class Element {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.listeners = {};
    this.value = ''; this.hidden = false; this.disabled = false;
    this.className = ''; this.textContent = ''; this.attributes = {};
  }
  appendChild(node) { return node; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  focus() {}
  async fire(name) { await this.listeners[name]?.({ preventDefault() {} }); }
}

function makeDocument(ids) {
  const nodes = new Map();
  const $ = (id) => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  return { $, document: { getElementById: $, createElement: (tag) => new Element(tag), head: { appendChild() {} } } };
}

const settle = async () => { for (let i = 0; i < 15; i++) await new Promise((r) => setImmediate(r)); };

function fakeJson(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// ---- login page forgot flow ----
function loginUi({ config = configBody, forgotStatus = 200, forgotBody = { ok: true } } = {}) {
  const { $, document } = makeDocument(['form-error', 'mock-note', 'line-button', 'google-button', 'login-divider',
    'password-form', 'pw-tab-login', 'pw-tab-register', 'pw-name-field', 'pw-name', 'pw-email', 'pw-password',
    'pw-help', 'pw-submit', 'step-phone', 'step-code', 'phone', 'phone-echo', 'code', 'request-button',
    'verify-button', 'resend-button', 'resend-note', 'forgot-area', 'forgot-button', 'forgot-status', 'turnstile-box', 'otp-form']);
  // Mirror the initial hidden attributes from public/login/index.html.
  $('forgot-area').hidden = true;
  const requests = [];
  const assigns = [];
  const fetch = async (url, options) => {
    const parsed = new URL(url, 'https://naka.test');
    requests.push({ path: parsed.pathname, options: options || {}, body: (options && options.body) || null });
    if (parsed.pathname === '/api/auth/config') return fakeJson(config);
    if (parsed.pathname === '/api/auth/password/forgot') return fakeJson(forgotBody, forgotStatus);
    return fakeJson({ error: 'unexpected' }, 500);
  };
  const nakaAuth = {
    mockMode: () => false,
    safeNext: (raw, fallback) => (typeof raw === 'string' && raw.charAt(0) === '/' && raw.charAt(1) !== '/' ? raw : fallback),
    me: async () => ({ status: 'signed-out' }),
    signIn() {},
    installMockFetch() {},
    MOCK_GOOGLE_USER: { id: 'mock-user' },
  };
  vm.runInNewContext(loginSource, {
    document, fetch, NakaAuth: nakaAuth,
    location: { search: '?next=%2Fapp%2F', assign: (t) => assigns.push(t) },
    URLSearchParams, Number, Error, encodeURIComponent, Response,
    window: { NakaAuth: nakaAuth },
  });
  return { $, settle, requests, assigns };
}

test('config passwordReset=true → แสดงปุ่มลืมรหัสผ่าน', async () => {
  const page = loginUi();
  await page.settle();
  assert.equal(page.$('forgot-area').hidden, false);
  assert.equal(page.$('forgot-button').hidden, false);
});

test('config passwordReset=false → ซ่อนปุ่มลืมรหัสผ่าน', async () => {
  const page = loginUi({ config: { ...configBody, passwordReset: false } });
  await page.settle();
  assert.equal(page.$('forgot-area').hidden, true);
});

test('กดลืมรหัสผ่านโดยไม่กรอกอีเมล → error ในหน้า และไม่เรียก forgot', async () => {
  const page = loginUi();
  await page.settle();
  await page.$('forgot-button').fire('click');
  await page.settle();
  assert.match(page.$('form-error').textContent, /กรอกอีเมล/);
  assert.equal(page.requests.some((r) => r.path === '/api/auth/password/forgot'), false);
});

test('กรอกอีเมล → POST forgot พร้อม email และแสดงข้อความกลาง (ไม่ยืนยันว่ามีบัญชี)', async () => {
  const page = loginUi();
  await page.settle();
  page.$('pw-email').value = 'Buyer@Example.test';
  await page.$('forgot-button').fire('click');
  await page.settle();
  const forgot = page.requests.find((r) => r.path === '/api/auth/password/forgot');
  assert.equal(forgot.options.method, 'POST');
  // The page sends the email as typed (trimmed); the server normalizes the case.
  assert.deepEqual(JSON.parse(forgot.body), { email: 'Buyer@Example.test' });
  // Neutral phrasing: conditional ("ถ้า…มีบัญชี") and never a confirmation.
  const note = page.$('forgot-status').textContent;
  assert.match(note, /ถ้าอีเมลนี้มีบัญชี/);
  assert.match(note, /ส่งลิงก์ตั้งรหัสผ่านใหม่/);
  assert.match(note, /30 นาที/);
});

test('forgot 429 → แสดงข้อความจาก API', async () => {
  const page = loginUi({ forgotStatus: 429, forgotBody: { error: 'ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' } });
  await page.settle();
  page.$('pw-email').value = 'buyer@example.test';
  await page.$('forgot-button').fire('click');
  await page.settle();
  assert.match(page.$('form-error').textContent, /ขอลิงก์บ่อยเกินไป/);
});

// ---- /login/reset/ page ----
function resetUi({ hash = '#token=tok_abc123', resetStatus = 200, resetBody = { ok: true } } = {}) {
  const { $, document } = makeDocument(['reset-status', 'reset-ok', 'reset-form', 'new-password',
    'confirm-password', 'reset-button', 'no-token', 'turnstile-box']);
  // Mirror the initial hidden attributes from public/login/reset/index.html.
  ['reset-form', 'reset-ok', 'turnstile-box', 'no-token'].forEach((id) => { $(id).hidden = true; });
  const requests = [];
  const replaceStateCalls = [];
  const fetch = async (url, options) => {
    const parsed = new URL(url, 'https://naka.test');
    requests.push({ path: parsed.pathname, options: options || {}, body: (options && options.body) || null });
    if (parsed.pathname === '/api/auth/config') return fakeJson(configBody);
    if (parsed.pathname === '/api/auth/password/reset') return fakeJson(resetBody, resetStatus);
    return fakeJson({ error: 'unexpected' }, 500);
  };
  const sandbox = {
    document, fetch,
    location: { hash, pathname: '/login/reset/', search: '' },
    history: { replaceState: (...args) => replaceStateCalls.push(args) },
    URLSearchParams, Response, Number, Error, encodeURIComponent, console,
    window: { turnstile: undefined },
  };
  vm.runInNewContext(resetSource, sandbox);
  return { $, settle, requests, replaceStateCalls };
}

test('มี #token= → แสดงฟอร์ม ลบ fragment ออกจาก address bar และขอ config', async () => {
  const page = resetUi();
  await page.settle();
  assert.equal(page.$('reset-form').hidden, false);
  assert.equal(page.$('no-token').hidden, true);
  assert.equal(page.replaceStateCalls.length, 1);
  assert.equal(page.replaceStateCalls[0][2], '/login/reset/');
  assert.equal(page.requests.some((r) => r.path === '/api/auth/config'), true);
});

test('ไม่มี token → ไม่แสดงฟอร์ม แสดงข้อความกลับหน้า login', async () => {
  const page = resetUi({ hash: '' });
  await page.settle();
  assert.equal(page.$('reset-form').hidden, true);
  assert.equal(page.$('no-token').hidden, false);
  assert.equal(page.requests.some((r) => r.path === '/api/auth/password/reset'), false);
});

test('รหัสสั้น / ไม่ตรงกัน → error ในหน้า และไม่เรียก reset', async () => {
  const page = resetUi();
  await page.settle();
  page.$('new-password').value = 'short';
  page.$('confirm-password').value = 'short';
  await page.$('reset-form').fire('submit');
  await page.settle();
  assert.match(page.$('reset-status').textContent, /8 ตัวอักษร/);
  assert.equal(page.requests.some((r) => r.path === '/api/auth/password/reset'), false);

  page.$('new-password').value = 'NewPass123';
  page.$('confirm-password').value = 'NewPass999';
  await page.$('reset-form').fire('submit');
  await page.settle();
  assert.match(page.$('reset-status').textContent, /ไม่ตรงกัน/);
  assert.equal(page.requests.some((r) => r.path === '/api/auth/password/reset'), false);
});

test('สำเร็จ → POST { token, newPassword } ซ่อนฟอร์ม แสดงลิงก์เข้าสู่ระบบ (ไม่มี session ใหม่)', async () => {
  const page = resetUi();
  await page.settle();
  page.$('new-password').value = 'NewPass123';
  page.$('confirm-password').value = 'NewPass123';
  await page.$('reset-form').fire('submit');
  await page.settle();
  const calls = page.requests.filter((r) => r.path === '/api/auth/password/reset');
  assert.equal(calls.length, 1);
  const body = JSON.parse(calls[0].body);
  assert.equal(body.token, 'tok_abc123');
  assert.equal(body.newPassword, 'NewPass123');
  assert.equal(page.$('reset-form').hidden, true);
  assert.equal(page.$('reset-ok').hidden, false, 'success box is shown (its text lives in the markup)');
});

test('reset 400 (ลิงก์หมดอายุ/ถูกใช้แล้ว) → แสดงข้อความจาก API', async () => {
  const page = resetUi({ resetStatus: 400, resetBody: { error: 'ลิงก์หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่' } });
  await page.settle();
  page.$('new-password').value = 'NewPass123';
  page.$('confirm-password').value = 'NewPass123';
  await page.$('reset-form').fire('submit');
  await page.settle();
  assert.match(page.$('reset-status').textContent, /ลิงก์หมดอายุหรือถูกใช้ไปแล้ว/);
});

// ---- file-level markup checks ----
test('markup: ทั้งสองหน้ามี lang th / ลิงก์กฎหมาย / ข้อความครบ / reset มี noindex', () => {
  assert.match(resetHtml, /lang="th"/);
  assert.match(resetHtml, /<h1/);
  assert.match(resetHtml, /\/legal\/privacy\//);
  assert.match(resetHtml, /autocomplete="new-password"/);
  assert.match(resetHtml, /เข้าสู่ระบบด้วยรหัสใหม่/);
  assert.match(loginHtml, /id="forgot-button"/);
  assert.match(loginHtml, /รับลิงก์ตั้งรหัสใหม่ทางอีเมล/);
});
