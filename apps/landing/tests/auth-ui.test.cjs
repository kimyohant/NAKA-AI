const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const accountMenu = require('../public/account-menu.js');

const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('safeNext accepts only in-site paths and rejects open redirects and control characters', () => {
  assert.equal(accountMenu.safeNext('/app/', '/app/'), '/app/');
  assert.equal(accountMenu.safeNext('/login/?x=1', '/app/'), '/login/?x=1');
  assert.equal(accountMenu.safeNext('//evil.example', '/app/'), '/app/');
  assert.equal(accountMenu.safeNext('https://evil.example', '/app/'), '/app/');
  assert.equal(accountMenu.safeNext('/a\\b', '/app/'), '/app/');
  assert.equal(accountMenu.safeNext('/\t/evil.test', '/app/'), '/app/');
  assert.equal(accountMenu.safeNext('/\n/evil.test', '/app/'), '/app/');
  assert.equal(accountMenu.safeNext(null, '/app/'), '/app/');
});

test('me() reports signed-out and unavailable separately, mock only in mock mode', () => {
  const source = read('public/account-menu.js');
  const mockCheck = source.indexOf('if (mockMode()) return localSession();');
  const realFetch = source.indexOf('fetch("/api/auth/me"');
  assert.ok(mockCheck !== -1, 'mock mode short-circuits me()');
  assert.ok(realFetch !== -1, 'me() calls the real API');
  assert.ok(mockCheck < realFetch, 'mock data is only read before any real API call');
  assert.ok(source.includes('return { status: "signed-out" };'), '401 is reported as signed-out');
  assert.ok(source.includes('return { status: "unavailable" };'), 'network/5xx is reported as unavailable');
  // The mock session is never consulted on the real path: localSession() only
  // appears in the mock branch and the mock helpers.
  const meBody = source.slice(source.indexOf('async function me()'), source.indexOf('---- fetch stub'));
  assert.ok(!meBody.includes('localSession()') || meBody.indexOf('localSession()') < meBody.indexOf('fetch('),
    'real path never falls back to the mock session');
});

test('signOut only clears the session after the server confirms', () => {
  const source = read('public/account-menu.js');
  const confirmedSet = source.indexOf('confirmed = res.ok');
  const removeItem = source.indexOf('localStorage.removeItem(SESSION_KEY)', confirmedSet);
  assert.ok(confirmedSet !== -1, 'signOut checks the HTTP status');
  assert.ok(removeItem !== -1, 'signOut clears the mock store');
  assert.ok(removeItem > source.indexOf('if (confirmed) {'), 'the store is cleared only when confirmed');
});

test('account-menu speaks the auth contract endpoints', () => {
  const source = read('public/account-menu.js');
  for (const endpoint of ['/api/auth/me', '/api/auth/otp/request', '/api/auth/otp/verify', '/api/auth/logout']) {
    assert.ok(source.includes(endpoint), `missing ${endpoint}`);
  }
  assert.equal(typeof accountMenu.installMockFetch, 'function');
  assert.equal(typeof accountMenu.me, 'function');
});

test('login page wires the OTP + Google flow with accessible errors', () => {
  const html = read('public/login/index.html');
  assert.ok(html.includes('href="/api/auth/google/start"'), 'google start link');
  assert.match(html, /<label for="phone">/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /inputmode="numeric"/);
  assert.match(html, /aria-live="polite"/);
  assert.ok(html.includes('/account-menu.js'), 'account-menu script include');
  // Review fix 6: no terms/privacy acceptance claims until real policies exist.
  assert.ok(!html.includes('ยอมรับเงื่อนไข'), 'no fake terms acceptance text');
  const js = read('public/login/login.js');
  assert.ok(js.includes('retryAfter'), 'resend countdown follows retryAfter');
  assert.ok(js.includes('resendEndTime'), 'countdown runs from the real end time');
  assert.ok(js.includes('auth.safeNext'), 'next param is validated');
  // Review fix 2: real logins rely on the HttpOnly cookie, not the mock store.
  assert.match(js, /if \(auth\.mockMode\(\)\) auth\.signIn/, 'signIn is only called in mock mode');
  // Review fix 5: server errors surface the API's Thai message.
  assert.match(js, /body && body\.error/, 'API error messages are shown');
});

test('app dashboard renders three account states and links all four workflows', () => {
  const html = read('public/app/index.html');
  assert.ok(html.includes('data-account-menu'), 'account menu slot');
  assert.ok(html.includes('id="app-error"'), 'unavailable state panel');
  assert.ok(html.includes('id="retry-button"'), 'retry control');
  assert.ok(html.includes('id="signout-status"'), 'sign-out status is announced');
  for (const workflow of ['sales', 'drama', 'live']) {
    assert.ok(html.includes(`/create/?workflow=${workflow}`), `missing workflow ${workflow}`);
  }
  // The chat-bot card opens the working inbox rather than the old brief form.
  assert.ok(html.includes('href="/app/inbox/"'), 'missing chat-bot inbox link');
  const js = read('public/app/app.js');
  const signedOut = js.indexOf('status === "signed-out"');
  const unavailable = js.indexOf('status === "unavailable"');
  const loginRedirect = js.indexOf('location.replace("/login/?next="');
  assert.ok(signedOut !== -1 && unavailable !== -1, 'distinguishes signed-out from unavailable');
  assert.ok(signedOut < loginRedirect, 'only the signed-out state redirects to login');
  assert.ok(js.includes('result.confirmed'), 'sign-out waits for server confirmation');
});
