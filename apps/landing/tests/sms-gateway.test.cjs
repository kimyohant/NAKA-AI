// Phase 7B: OTP by SMS through the shop's Android phone (SMS Gateway for Android, cloud server).
// fetch is mocked; no SMS is sent.
const assert = require('node:assert/strict');
const { after, beforeEach, mock, test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `sms-gateway-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--esModuleInterop',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'pipe' });
const { smsProvider } = require(path.join(buildDir, 'auth/sms.js'));

const http = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected live HTTP'); });
after(() => { mock.restoreAll(); rmSync(buildDir, { recursive: true, force: true }); });
beforeEach(() => { http.mock.resetCalls(); http.mock.mockImplementation(async () => Response.json({ id: 'msg_1', state: 'Pending' }, { status: 202 })); });

const env = (extra = {}) => ({ SMS_PROVIDER: 'android_gateway', APP_ORIGIN: 'https://naka.test',
  SMS_GATEWAY_USERNAME: 'shop', SMS_GATEWAY_PASSWORD: 'p@ss:word', ...extra });
const rejects = (promise, status) => assert.rejects(promise, (error) => error.status === status);

test('sends the OTP to the cloud server with Basic auth, E.164 number, and a TTL shorter than the code', async () => {
  await smsProvider(env()).send('+66812345678', 'รหัสเข้าสู่ระบบ NAKA-AI: 123456');
  assert.equal(http.mock.callCount(), 1);
  const [url, init] = http.mock.calls[0].arguments;
  assert.equal(String(url), 'https://api.sms-gate.app/3rdparty/v1/messages?deviceActiveWithin=1');
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'manual');
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from('shop:p@ss:word').toString('base64')}`);
  assert.deepEqual(JSON.parse(init.body), { textMessage: { text: 'รหัสเข้าสู่ระบบ NAKA-AI: 123456' }, phoneNumbers: ['+66812345678'], ttl: 300, priority: 100 });
});

test('a private server URL is used as given (trailing slash trimmed)', async () => {
  await smsProvider(env({ SMS_GATEWAY_URL: 'https://sms.example.com/api/3rdparty/v1/' })).send('+66812345678', 'x');
  assert.equal(String(http.mock.calls[0].arguments[0]), 'https://sms.example.com/api/3rdparty/v1/messages?deviceActiveWithin=1');
});

test('missing credentials or a non-https URL is 503 and never calls fetch', () => {
  for (const extra of [{ SMS_GATEWAY_USERNAME: '' }, { SMS_GATEWAY_PASSWORD: undefined }, { SMS_GATEWAY_URL: 'http://sms.example.com' },
    { SMS_GATEWAY_URL: 'https://user:pw@sms.example.com' }, { SMS_GATEWAY_URL: 'not a url' }]) {
    assert.throws(() => smsProvider(env(extra)), (error) => error.status === 503, JSON.stringify(extra));
  }
  assert.equal(http.mock.callCount(), 0);
});

test('HTTP errors, network errors, a failed state and malformed replies are 502', async () => {
  const replies = [
    async () => new Response('no device', { status: 400 }),
    async () => new Response('', { status: 500 }),
    async () => { throw new TypeError('network down'); },
    async () => Response.json({ state: 'Pending' }, { status: 202 }),
    async () => Response.json({ id: 'msg_2', state: 'Failed' }, { status: 202 }),
    async () => new Response('<html>', { status: 200 }),
  ];
  for (const reply of replies) {
    http.mock.mockImplementationOnce(reply);
    await rejects(smsProvider(env()).send('+66812345678', 'x'), 502);
  }
});

test('thaibulksms and mock keep working as before', async () => {
  http.mock.mockImplementationOnce(async () => Response.json({ phone_number_list: [{ number: '66812345678', message_id: 'm1' }], bad_phone_number_list: [] }));
  await smsProvider({ SMS_PROVIDER: 'thaibulksms', APP_ORIGIN: 'https://naka.test', SMS_API_KEY: 'k', SMS_API_SECRET: 's', SMS_SENDER: 'NAKA' }).send('+66812345678', 'x');
  assert.equal(String(http.mock.calls[0].arguments[0]), 'https://api-v2.thaibulksms.com/sms');
  assert.throws(() => smsProvider({ SMS_PROVIDER: 'mock', APP_ORIGIN: 'https://naka.test' }), (error) => error.status === 503);
  assert.throws(() => smsProvider({ SMS_PROVIDER: 'thaibulksms', APP_ORIGIN: 'https://naka.test' }), (error) => error.status === 503);
});
