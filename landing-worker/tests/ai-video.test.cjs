const assert = require('node:assert/strict');
const { test, beforeEach, afterEach, after, mock } = require('node:test');
const { execFileSync } = require('node:child_process');
const { readdirSync, rmSync } = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');
const { migratedDb } = require('./helpers/d1.cjs');
const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `ai-video-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16', '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { stdio: 'inherit' });
const worker = require(path.join(buildDir, 'index.js')).default;
const { registerVideoProvider, VideoProviderRejected } = require(path.join(buildDir, 'video/provider.js'));
const { deferJob } = require(path.join(buildDir, 'jobs.js'));
const migrations = readdirSync(path.join(root, 'migrations')).filter(name => /^\d{4}_.*\.sql$/.test(name)).sort();
const ORIGIN = 'https://naka.test';
const now = () => Math.floor(Date.now() / 1000);
const sha = value => createHash('sha256').update(value).digest('base64url');
const MP4 = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);

/** In-memory R2 with the calls the video module makes. */
function fakeBucket() {
  const objects = new Map();
  return {
    objects,
    async put(key, data, opts) { objects.set(key, { data: new Uint8Array(data), opts }); },
    async delete(key) { objects.delete(key); },
    async get(key, opts) {
      const o = objects.get(key);
      if (!o) return null;
      const offset = opts?.range?.offset ?? 0;
      const length = opts?.range?.length ?? o.data.length - offset;
      return { size: o.data.length, range: opts?.range ? { offset, length } : undefined, body: o.data.slice(offset, offset + length) };
    },
  };
}

let sqlite, db, env, http, pending, provider;
beforeEach(() => {
  ({ sqlite, db } = migratedDb(...migrations));
  env = { DB: db, APP_ORIGIN: ORIGIN, SESSION_SECRET: 's'.repeat(40), MEDIA: fakeBucket(), VIDEO_PROVIDER: 'seedance', VIDEO_API_KEY: 'video-key',
    ASSETS: { fetch: async () => new Response('asset') } };
  http = mock.method(globalThis, 'fetch', async () => { throw new Error('unexpected external request'); });
  pending = [];
  provider = { submitted: [], polls: 0, submit: async (config, request) => { provider.submitted.push({ config, request }); return { taskId: 'task-1' }; },
    poll: async () => { provider.polls++; return { status: 'running' }; } };
  registerVideoProvider({ id: 'seedance', label: 'Fake Seedance', defaultBaseUrl: 'https://video.example', defaultModel: 'fake-model',
    limits: { minSec: 4, maxSec: 15, images: 9, videos: 3 },
    submit: (c, r) => provider.submit(c, r), poll: (c, id) => provider.poll(c, id) });
});
afterEach(() => { sqlite.close(); http.mock.restore(); });
after(() => { assert.equal(path.dirname(buildDir), path.join(root, '.wrangler')); rmSync(buildDir, { recursive: true, force: true }); });

const ctx = { waitUntil: p => pending.push(p) };
const site = (pathname, init = {}) => worker.fetch(new Request(ORIGIN + pathname, init), env, ctx);
let counter = 0;
function customer(credits = 10) {
  const id = 'u' + ++counter, token = String(counter).padStart(43, 'v');
  sqlite.prepare('INSERT INTO users (id, display_name, created_at) VALUES (?, ?, ?)').run(id, 'ร้าน', now());
  sqlite.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(sha(token), id, now() + 86400, now());
  if (credits) sqlite.prepare("INSERT INTO credit_ledger (user_id, delta, reason) VALUES (?, ?, 'grant')").run(id, credits);
  return { id, cookie: 'naka_session=' + token };
}
const balance = id => sqlite.prepare('SELECT COALESCE(SUM(delta), 0) AS n FROM credit_ledger WHERE user_id = ?').get(id).n;
const upload = (shop, bytes, type, query = '') => site('/api/marketer/media' + query, { method: 'POST',
  headers: { 'Content-Type': type, Origin: ORIGIN, Cookie: shop.cookie }, body: bytes });
const key = async res => (await res.json()).key;
const create = (shop, body) => site('/api/marketer/videos', { method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: ORIGIN, Cookie: shop.cookie }, body: JSON.stringify(body) });
const videoRow = () => sqlite.prepare('SELECT * FROM ai_videos').get();
const jobRow = () => sqlite.prepare("SELECT * FROM jobs WHERE kind = 'ai_video'").get();
/** Run the queue again as the next cron minute would, with the deferred job due now. */
async function nextMinute() {
  sqlite.prepare("UPDATE jobs SET run_after = datetime('now', '-1 seconds') WHERE status = 'queued'").run();
  await worker.scheduled({ scheduledTime: Date.now() }, env, ctx);
  await Promise.all(pending.splice(0));
}

test('uploads need a session, R2, a real file of the declared type, and consent for a person', async () => {
  const shop = customer();
  assert.equal((await upload({ cookie: '' }, MP4, 'video/mp4')).status, 401);
  assert.equal((await upload(shop, JPEG, 'video/mp4')).status, 400); // a JPEG renamed to MP4
  assert.equal((await upload(shop, MP4, 'application/pdf')).status, 400);
  assert.equal((await upload(shop, JPEG, 'image/jpeg', '?person=consented')).status, 400); // no consent tick
  assert.equal((await upload(shop, MP4, 'video/mp4', '?person=consented&consent=1')).status, 400); // a person must be a photo
  const clip = await upload(shop, MP4, 'video/mp4');
  assert.equal(clip.status, 201);
  const person = await (await upload(shop, JPEG, 'image/jpeg', '?person=ai_generated&consent=1')).json();
  assert.equal(person.person, 'ai_generated');
  const row = sqlite.prepare('SELECT * FROM marketer_media WHERE key = ?').get(person.key);
  assert.equal(row.user_id, shop.id); assert.ok(row.consent_at > 0);
  assert.ok(env.MEDIA.objects.has(person.key)); assert.match(person.key, new RegExp(`^marketer/${shop.id}/`));
  const noR2 = { ...env, MEDIA: undefined };
  const res = await worker.fetch(new Request(ORIGIN + '/api/marketer/media', { method: 'POST', headers: { 'Content-Type': 'video/mp4', Origin: ORIGIN, Cookie: shop.cookie }, body: MP4 }), noR2, ctx);
  assert.equal(res.status, 503);
});

test('a video is checked before credits are held: provider set up, own files, consent, the mode\'s required inputs', async () => {
  const shop = customer(10), other = customer(10);
  const clip = await key(await upload(shop, MP4, 'video/mp4'));
  const product = await key(await upload(shop, JPEG, 'image/jpeg'));
  const plainPhoto = await key(await upload(shop, JPEG, 'image/jpeg'));
  const othersClip = await key(await upload(other, MP4, 'video/mp4'));
  const base = { kind: 'recreate', script: 'ฮุก: หน้าหมอง?\n[0–3 วิ] ใกล้หน้า', productName: 'สบู่', sourceVideo: clip, productImages: [product] };
  for (const [overrides, status] of [
    [{ sourceVideo: othersClip }, 400], [{ sourceVideo: undefined }, 400], [{ script: '' }, 400], [{ kind: 'nope' }, 400],
    [{ kind: 'replace', productImages: [] }, 400], [{ personImage: plainPhoto }, 400], [{ productImages: [clip] }, 400],
  ]) assert.equal((await create(shop, { ...base, ...overrides })).status, status, JSON.stringify(overrides));
  env.VIDEO_PROVIDER = 'off';
  assert.match((await (await create(shop, base)).json()).error, /ผู้ให้บริการวิดีโอ/);
  env.VIDEO_PROVIDER = 'wan'; // allowed in settings, but no module installed
  assert.match((await (await create(shop, base)).json()).error, /ตัวเชื่อม/);
  env.VIDEO_PROVIDER = 'seedance';
  assert.equal(balance(shop.id), 10);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM jobs').get().n, 0);
  // The marketer page learns whether video is ready and what it costs.
  const config = await (await site('/api/marketer/config', { headers: { Cookie: shop.cookie } })).json();
  assert.deepEqual(config.video, { enabled: true, credits: 5, provider: 'Fake Seedance', limits: { minSec: 4, maxSec: 15, images: 9, videos: 3 } });
});

test('submit once with signed links, wait without spending retries, then keep the result in R2', async () => {
  const shop = customer(10);
  env.AI_VIDEO_CREDITS = '3';
  const clip = await key(await upload(shop, MP4, 'video/mp4'));
  const product = await key(await upload(shop, JPEG, 'image/jpeg'));
  const face = await key(await upload(shop, JPEG, 'image/jpeg', '?person=consented&consent=1'));
  const created = await create(shop, { kind: 'replace', script: '[0–3 วิ] แม่ค้าถือสบู่', productName: 'สบู่มะลิ', sourceVideo: clip,
    productImages: [product], personImage: face, durationSec: 40, aspectRatio: '9:16', title: 'สบู่ใหม่' });
  assert.equal(created.status, 202);
  assert.equal(balance(shop.id), 7);
  await Promise.all(pending.splice(0));
  assert.equal(provider.submitted.length, 1);
  const sent = provider.submitted[0];
  assert.deepEqual(sent.config, { apiKey: 'video-key', baseUrl: 'https://video.example', model: 'fake-model' });
  assert.equal(sent.request.durationSec, 15); // clamped to the provider's maximum
  assert.equal(sent.request.referenceVideos.length, 1); assert.equal(sent.request.referenceImages.length, 2);
  assert.ok([...sent.request.referenceVideos, ...sent.request.referenceImages].every(u => u.startsWith(ORIGIN + '/api/marketer/media/marketer/')));
  assert.match(sent.request.prompt, /Replace only the elements/); assert.match(sent.request.prompt, /person reference image/); assert.match(sent.request.prompt, /สบู่มะลิ/);
  // The person's photo comes first, so prompts can call it image 1.
  assert.ok(sent.request.referenceImages[0].includes(face.split('/').pop()));
  // The provider can fetch the signed clip; a changed link cannot.
  const clipLink = sent.request.referenceVideos[0].slice(ORIGIN.length);
  assert.equal((await site(clipLink)).status, 200);
  const partial = await site(clipLink, { headers: { Range: 'bytes=4-7' } });
  assert.equal(partial.status, 206); assert.equal(partial.headers.get('content-range'), `bytes 4-7/${MP4.length}`);
  assert.equal((await site(clipLink.replace(/s=[^&]+/, 's=' + 'x'.repeat(43)))).status, 403);
  let job = jobRow();
  assert.equal(job.status, 'queued'); assert.equal(videoRow().status, 'submitted'); assert.equal(videoRow().provider_task_id, 'task-1');
  await nextMinute();
  job = jobRow();
  assert.equal(provider.polls, 1); assert.equal(job.status, 'queued'); assert.ok(job.max_attempts > job.attempts); // waiting costs no retries
  provider.poll = async () => ({ status: 'done', videoUrl: 'https://cdn.video.example/out.mp4', durationSec: 15 });
  http.mock.mockImplementation(async (url) => {
    assert.equal(String(url), 'https://cdn.video.example/out.mp4');
    return new Response(MP4, { headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(MP4.length) } });
  });
  await nextMinute();
  assert.equal(jobRow().status, 'done'); assert.equal(videoRow().status, 'done');
  assert.equal(provider.submitted.length, 1); // never submitted twice
  const list = await (await site('/api/marketer/videos', { headers: { Cookie: shop.cookie } })).json();
  assert.equal(list.videos[0].status, 'done'); assert.equal(list.videos[0].title, 'สบู่ใหม่');
  const played = await site(list.videos[0].url.slice(ORIGIN.length));
  assert.equal(played.status, 200); assert.equal(played.headers.get('content-type'), 'video/mp4');
  assert.equal(balance(shop.id), 7); // kept: the video was made
  assert.ok(env.MEDIA.objects.has(`marketer/${shop.id}/out/${videoRow().id}.mp4`));
});

test('failures refund the credits: provider failure, rejected submit, unknown submit (no resubmit), and timeout', async () => {
  const runCase = async (setup) => {
    const shop = customer(5);
    const product = await key(await upload(shop, JPEG, 'image/jpeg'));
    provider.submitted = [];
    setup();
    const res = await create(shop, { kind: 'plan', script: 'แผน', productImages: [product] });
    assert.equal(res.status, 202);
    await Promise.all(pending.splice(0));
    return shop;
  };
  // 1. the provider reports failure
  let shop = await runCase(() => { provider.submit = async () => ({ taskId: 't' }); provider.poll = async () => ({ status: 'failed', error: 'OutputVideoSensitiveContentDetected' }); });
  await nextMinute();
  let list = await (await site('/api/marketer/videos', { headers: { Cookie: shop.cookie } })).json();
  assert.equal(list.videos[0].status, 'failed'); assert.match(list.videos[0].error, /ปฏิเสธเนื้อหา/); assert.equal(balance(shop.id), 5);
  // 2. rejected before starting
  shop = await runCase(() => { provider.submit = async () => { throw new VideoProviderRejected('bad key'); }; });
  assert.equal(balance(shop.id), 5);
  // 3. the request may have reached the provider: fail without trying again
  shop = await runCase(() => { provider.submit = async () => { provider.submitted.push(1); throw new Error('socket hang up'); }; });
  await nextMinute();
  assert.equal(provider.submitted.length, 1); assert.equal(balance(shop.id), 5);
  list = await (await site('/api/marketer/videos', { headers: { Cookie: shop.cookie } })).json();
  assert.match(list.videos[0].error, /ส่งงานไม่สำเร็จ/);
  // 4. still running after 45 minutes
  shop = await runCase(() => { provider.submit = async () => ({ taskId: 'slow' }); provider.poll = async () => ({ status: 'running' }); });
  sqlite.prepare('UPDATE ai_videos SET submitted_at = ? WHERE user_id = ?').run(now() - 46 * 60, shop.id);
  await nextMinute();
  assert.equal(balance(shop.id), 5);
  // Out of credits: nothing is queued.
  const poor = customer(2);
  const img = await key(await upload(poor, JPEG, 'image/jpeg'));
  assert.equal((await create(poor, { kind: 'plan', script: 'แผน', productImages: [img] })).status, 402);
});

test('a deferral from a worker that lost its lease is ignored (fencing token)', async () => {
  sqlite.prepare(`INSERT INTO jobs (id, user_id, kind, status, input, cost_credits, attempts) VALUES ('j1', 'u', 'ai_video', 'running', '{}', 1, 2)`).run();
  assert.equal(await deferJob(db, 'j1', 1, 30), false);
  assert.equal(await deferJob(db, 'j1', 2, 30), true);
  const job = sqlite.prepare("SELECT * FROM jobs WHERE id = 'j1'").get();
  assert.equal(job.status, 'queued'); assert.equal(job.attempts, 2); assert.equal(job.max_attempts, 4);
});
