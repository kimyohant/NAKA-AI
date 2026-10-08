const assert = require('node:assert/strict');
const { test, after, mock } = require('node:test');
const { migratedDb } = require('../../../tests/helpers/d1.cjs');
const { readFileSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');

// Bundle the inbox with the real jobs/credits/social modules; every HTTP call is mocked.
const root = path.resolve(__dirname, '../../..');
const output = path.join(root, '.wrangler', `inbox-tests-${process.pid}`);
mkdirSync(output, { recursive: true });
const compiled = buildSync({ stdin: { contents: `export * from './src/inbox/index'; export { runQueue } from './src/jobs';
  export { encryptToken, tokenContext } from './src/social/crypto';`, resolveDir: root, loader: 'ts' },
  bundle: true, write: false, platform: 'node', format: 'cjs' });
writeFileSync(path.join(output, 'inbox.cjs'), compiled.outputFiles[0].text);
const inbox = require(path.join(output, 'inbox.cjs'));

const migrations = ['0001_auth.sql', '0002_credits_jobs.sql', '0006_jobs_limit.sql', '0003_social.sql', '0005_inbox.sql']
  .map(file => readFileSync(path.join(root, 'migrations', file), 'utf8'));

// The production SQL on PostgreSQL (PGlite) through the app's D1 adapter — tests/helpers/d1.cjs.
// `sql` is the synchronous test handle (prepare(…).get/all/run, exec); HTTP alone is mocked.
class D1 {
  constructor() { const { sqlite, db } = migratedDb(); this.sql = sqlite; this.db = db; }
  prepare(query) { return this.db.prepare(query); }
  batch(statements) { return this.db.batch(statements); }
}

let time = 1800000000000;
mock.method(Date, 'now', () => time);
const http = mock.method(globalThis, 'fetch', async () => { throw new Error('Unexpected live HTTP'); });
after(() => {
  mock.restoreAll();
  assert.equal(path.dirname(output), path.join(root, '.wrangler'));
  rmSync(output, { recursive: true, force: true });
});

const T = 1800000000 - 10;
const SECRET = 'test-app-secret';
async function sign(body) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)));
  return 'sha256=' + Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
}
const fbComment = (commentId, message, from = { id: '900', name: 'ลูกค้า' }) => JSON.stringify({ object: 'page', entry: [{ id: '100', time: T,
  changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: commentId, post_id: '555', from, message, created_time: T } }] }] });

function anthropicReply(draft) {
  return new Response(JSON.stringify({ id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text: JSON.stringify(draft) }], stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

async function setup(t) {
  time = 1800000000000;
  const DB = new D1();
  t.after(() => DB.sql.close());
  DB.sql.exec(`INSERT INTO plans (id, name, monthly_credits, max_parallel_jobs, price_thb) VALUES ('business', 'ธุรกิจ', 160, 4, 1290) ON CONFLICT (id) DO NOTHING;
    INSERT INTO users (id, created_at) VALUES ('user-a', 0), ('user-b', 0);
    INSERT INTO subscriptions (user_id, plan_id) VALUES ('user-a', 'business');`);
  const env = { DB, APP_ORIGIN: 'https://naka.test', META_APP_ID: '12345', META_APP_SECRET: SECRET,
    SOCIAL_TOKEN_KEY: Buffer.alloc(32, 9).toString('base64'), META_WEBHOOK_VERIFY_TOKEN: 'verify-me', ANTHROPIC_API_KEY: 'test-key' };
  const token = await inbox.encryptToken(env, 'page-token', inbox.tokenContext('user-a', 'facebook', '100'));
  DB.sql.prepare(`INSERT INTO social_accounts (id, user_id, platform, external_id, name, token_enc, status, created_at)
    VALUES ('acct-a', 'user-a', 'facebook', '100', 'ร้านมะลิ', ?, 'active', ?)`).run(token, T);
  http.mock.resetCalls();
  http.mock.mockImplementation(async () => { throw new Error('Unexpected HTTP'); });

  const pending = [];
  const ctx = { waitUntil: p => pending.push(p) };
  const webhook = async (body, signature) => {
    const response = await inbox.handleMetaWebhook(new Request('https://naka.test/webhook/meta', { method: 'POST', body,
      headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': signature ?? await sign(body) } }), env, ctx);
    await Promise.all(pending.splice(0));
    return response;
  };
  const api = (route, { method = 'GET', body, user = 'user-a' } = {}) => {
    const url = new URL(`https://naka.test/api/inbox/${route}`);
    return inbox.handleInbox(new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      headers: { Origin: 'https://naka.test', 'Content-Type': 'application/json' } }), env, url, user);
  };
  const enableAuto = async () => {
    assert.equal((await api('settings', { method: 'PUT', body: { mode: 'auto', tone: 'เป็นกันเอง', escalate_keywords: [] } })).status, 200);
    assert.equal((await api('kb', { method: 'POST', body: { title: 'ราคา', content: 'สบู่มะลิ ราคา 129 บาท ส่งทั่วประเทศ' } })).status, 201);
  };
  const run = () => inbox.runQueue(DB, { [inbox.INBOX_JOB_KIND]: inbox.makeInboxHandler(env) }, { maxJobs: 5 });
  const inbound = () => DB.sql.prepare("SELECT * FROM inbox_messages WHERE direction='in' ORDER BY created_at, id").all();
  return { env, db: DB.sql, webhook, api, enableAuto, run, inbound };
}

test('webhook verification answers the challenge only for the right token', async (t) => {
  const { env } = await setup(t);
  const verify = (token) => inbox.handleMetaWebhook(new Request(
    `https://naka.test/webhook/meta?hub.mode=subscribe&hub.verify_token=${token}&hub.challenge=4242`), env, { waitUntil() {} });
  const ok = await verify('verify-me');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '4242');
  assert.equal((await verify('wrong')).status, 403);
});

test('a comment is stored once, only from signed deliveries, and waits while the bot is off', async (t) => {
  const { webhook, inbound, db } = await setup(t);
  const body = fbComment('555_1', 'สบู่มะลิราคาเท่าไหร่คะ');
  assert.equal((await webhook(body, 'sha256=' + '0'.repeat(64))).status, 403);
  assert.equal(inbound().length, 0);

  assert.equal((await webhook(body)).status, 200);
  assert.equal((await webhook(body)).status, 200, 'Meta retries the same delivery');
  const messages = inbound();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].status, 'pending');
  assert.equal(messages[0].job_id, null, 'mode is off until the seller turns the bot on');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM inbox_threads').get().n, 1);
});

test('the chat bot can only be switched on in the Business and Max packages', async (t) => {
  const { api } = await setup(t);
  const settings = { mode: 'draft', tone: 'สุภาพ', escalate_keywords: ['ส่วนลด'] };
  assert.equal((await api('settings', { method: 'PUT', body: settings, user: 'user-b' })).status, 402);
  assert.equal((await api('settings', { method: 'PUT', body: { ...settings, mode: 'off' }, user: 'user-b' })).status, 200);
  const ok = await api('settings', { method: 'PUT', body: settings });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).escalate_keywords, ['ส่วนลด']);
});

test('auto mode drafts from the shop facts and replies to the comment once', async (t) => {
  const { webhook, enableAuto, run, inbound, db } = await setup(t);
  await enableAuto();
  const calls = [];
  http.mock.mockImplementation(async (url, init) => {
    const href = String(url);
    calls.push(href);
    if (href.startsWith('https://api.anthropic.com/')) {
      return anthropicReply({ reply: 'สบู่มะลิราคา 129 บาทค่ะ ส่งทั่วประเทศนะคะ', confidence: 'high', handoff: false, reason: 'price in kb' });
    }
    if (href.includes('graph.facebook.com') && href.endsWith('/555_2/comments')) {
      assert.equal(new URLSearchParams(String(init.body)).get('message'), 'สบู่มะลิราคา 129 บาทค่ะ ส่งทั่วประเทศนะคะ');
      return new Response(JSON.stringify({ id: '555_2_99' }), { status: 200 });
    }
    throw new Error(`unexpected ${href}`);
  });
  await webhook(fbComment('555_2', 'สบู่มะลิราคาเท่าไหร่คะ'));

  const job = db.prepare("SELECT counts_toward_limit, cost_credits FROM jobs WHERE kind = 'inbox_reply'").get();
  assert.deepEqual({ ...job }, { counts_toward_limit: 0, cost_credits: 0 }, 'inbox replies never use video slots or credits');
  await run();

  const [message] = inbound();
  assert.equal(message.status, 'sent');
  assert.equal(message.confidence, 'high');
  assert.equal(calls.filter(u => u.includes('graph.facebook.com')).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM inbox_messages WHERE direction='out'").get().n, 1);

  // Meta echoes our own reply back; it must not become a new customer message.
  await webhook(fbComment('555_2_99', 'สบู่มะลิราคา 129 บาทค่ะ ส่งทั่วประเทศนะคะ', { id: '100', name: 'ร้านมะลิ' }));
  assert.equal(inbound().length, 1);
});

test('refund requests go to a person without asking the model', async (t) => {
  const { webhook, enableAuto, run, inbound, db } = await setup(t);
  await enableAuto();
  await webhook(fbComment('555_3', 'ของมาถึงแตก ขอคืนเงินได้ไหมคะ'));
  await run();
  assert.equal(http.mock.callCount(), 0, 'no Claude call and nothing sent');
  const [message] = inbound();
  assert.equal(message.status, 'drafted');
  assert.equal(message.handoff_reason, 'escalation_keyword');
  assert.equal(db.prepare('SELECT status FROM inbox_threads').get().status, 'needs_human');
});

test('a number the shop never gave is not sent', async (t) => {
  const { webhook, enableAuto, run, inbound } = await setup(t);
  await enableAuto();
  http.mock.mockImplementation(async (url) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      return anthropicReply({ reply: 'ลดเหลือ 99 บาทค่ะ', confidence: 'high', handoff: false, reason: 'guess' });
    }
    throw new Error(`unexpected ${url}`);
  });
  await webhook(fbComment('555_4', 'มีโปรไหมคะ'));
  await run();
  const [message] = inbound();
  assert.equal(message.status, 'drafted');
  assert.equal(message.handoff_reason, 'ungrounded_number');
  assert.notEqual(message.draft, 'ลดเหลือ 99 บาทค่ะ');
});

test('a public reply that mentions private details is replaced before anyone sees it', async (t) => {
  const { webhook, enableAuto, run, inbound } = await setup(t);
  await enableAuto();
  http.mock.mockImplementation(async (url) => {
    if (String(url).startsWith('https://api.anthropic.com/')) {
      return anthropicReply({ reply: 'รบกวนแจ้งที่อยู่จัดส่งใต้คอมเมนต์นี้ได้เลยค่ะ', confidence: 'high', handoff: false, reason: 'shipping' });
    }
    throw new Error(`unexpected ${url}`);
  });
  await webhook(fbComment('555_5', 'สั่งยังไงคะ'));
  await run();
  const [message] = inbound();
  assert.equal(message.handoff_reason, 'public_reply_redacted');
  assert.doesNotMatch(message.draft, /ที่อยู่/);
});

test('sellers only see their own threads', async (t) => {
  const { webhook, api } = await setup(t);
  await webhook(fbComment('555_6', 'สวัสดีค่ะ'));
  const mine = await (await api('threads')).json();
  assert.equal(mine.threads.length, 1);
  const theirs = await (await api('threads', { user: 'user-b' })).json();
  assert.equal(theirs.threads.length, 0);
  assert.equal((await api(`threads/${mine.threads[0].id}`, { user: 'user-b' })).status, 404);
});
