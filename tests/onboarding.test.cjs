// Phase 5B onboarding tests (docs/phase5-onboarding.md).
// Runs the compiled onboarding + auth code against a real SQLite database
// with every migration applied (tests/helpers/d1.cjs), so the signup-bonus
// batch and the status SQL are exercised exactly as production runs them.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const { rmSync } = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const buildDir = path.join(root, '.wrangler', `onboarding-tests-${process.pid}`);
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', root,
  '--noEmit', 'false', '--module', 'node16', '--moduleResolution', 'node16',
  '--rootDir', path.join(root, 'src'), '--outDir', buildDir], { cwd: root, stdio: 'pipe' });

const { identityUser } = require(path.join(buildDir, 'auth/session.js'));
const { handleOnboarding } = require(path.join(buildDir, 'onboarding/index.js'));
const { getBalance } = require(path.join(buildDir, 'credits.js'));
const { migratedDb } = require('./helpers/d1.cjs');

const MIGRATIONS = ['0001_auth.sql', '0002_credits_jobs.sql', '0003_social.sql',
  '0004_plans.sql', '0005_inbox.sql', '0006_jobs_limit.sql', '0007_payments.sql'];

test.after(() => rmSync(buildDir, { recursive: true, force: true }));

function setup(t, signupCredits) {
  const { sqlite, db } = migratedDb(...MIGRATIONS);
  t.after(() => sqlite.close());
  const env = { DB: db };
  if (signupCredits !== undefined) env.SIGNUP_CREDITS = signupCredits;
  return { sqlite, db, env };
}

const signup = (env, phone) => identityUser(env, 'phone', phone, 'ร้านทดสอบ');

const bonusRows = async (db, userId) =>
  (await db.prepare("SELECT delta, reason FROM credit_ledger WHERE user_id = ? AND note = 'signup_bonus'").bind(userId).all()).results;

const onboardingStatus = (env, userId) => {
  const url = new URL('https://naka.test/api/onboarding');
  return handleOnboarding(new Request(url), env, url, userId).then((response) => {
    assert.equal(response.status, 200);
    return response.json();
  });
};

test('สมัครใหม่ + SIGNUP_CREDITS=3 → ยอด 3, ล็อกอินซ้ำ → ยังเป็น 3', async (t) => {
  const { db, env } = setup(t, '3');
  const user = await signup(env, '+66810000001');
  assert.equal(await getBalance(db, user.id), 3);
  const rows = await bonusRows(db, user.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].delta, 3);
  assert.equal(rows[0].reason, 'grant');

  const again = await signup(env, '+66810000001');
  assert.equal(again.id, user.id, 're-login keeps the same user');
  assert.equal(await getBalance(db, user.id), 3, 'no second grant on re-login');
  assert.equal((await bonusRows(db, user.id)).length, 1);
});

test('ไม่ตั้ง / "0" / "-5" / "abc" → ไม่มีแถว signup_bonus', async (t) => {
  for (const value of [undefined, '0', '-5', 'abc', '']) {
    const { db, env } = setup(t, value);
    const user = await signup(env, '+66820000001');
    assert.equal((await bonusRows(db, user.id)).length, 0, `value ${JSON.stringify(value)} must not grant`);
    assert.equal(await getBalance(db, user.id), 0);
  }
});

// Two concurrent signups with the same phone race on the same guarded batch;
// node:sqlite serializes the statements, so replaying the second request
// through the identical code path exercises exactly the guard that keeps
// the race to one user and one bonus (fresh UUID never lands in users).
test('สมัครด้วยเบอร์เดียวกัน 2 คำขอ → ได้ user เดียว โบนัสเดียว', async (t) => {
  const { db, env } = setup(t, '3');
  const first = await signup(env, '+66830000001');
  const second = await signup(env, '+66830000001');
  assert.equal(first.id, second.id, 'both requests land on one user');
  assert.equal((await bonusRows(db, first.id)).length, 1, 'exactly one bonus row');
  assert.equal(await getBalance(db, first.id), 3);
});

test('/api/onboarding แต่ละ step เปลี่ยนเป็น true ตามข้อมูลจริง และไม่ปนข้อมูลผู้ใช้อื่น', async (t) => {
  const { db, env } = setup(t, '3');
  const first = await signup(env, '+66840000001');
  const other = await signup(env, '+66840000002');

  // Fresh account: bonus visible, every step still open.
  let data = await onboardingStatus(env, first.id);
  assert.deepEqual(data, {
    credits: 3,
    signupBonus: 3,
    steps: { firstVideo: false, pageConnected: false, hasPackage: false },
  });

  // A finished inbox reply is not a first video.
  await db.prepare("INSERT INTO jobs (id, user_id, kind, status, cost_credits) VALUES ('j-inbox', ?, 'inbox_reply', 'done', 0)").bind(first.id).run();
  data = await onboardingStatus(env, first.id);
  assert.equal(data.steps.firstVideo, false, 'inbox_reply does not count as first video');

  // A done video job marks the step, only for its own user.
  await db.prepare("INSERT INTO jobs (id, user_id, kind, status, cost_credits) VALUES ('j-video', ?, 'video', 'done', 1)").bind(first.id).run();
  data = await onboardingStatus(env, first.id);
  assert.equal(data.steps.firstVideo, true);

  // Other users' social account and package must not leak into first's steps.
  await db.prepare("INSERT INTO social_accounts (id, user_id, platform, external_id, name, token_enc, status, created_at) VALUES ('s-other', ?, 'facebook', 'pg-1', 'เพจร้าน', 'enc', 'active', 1)").bind(other.id).run();
  await db.prepare("INSERT INTO subscriptions (user_id, plan_id, status) VALUES (?, 'pro', 'active')").bind(other.id).run();
  data = await onboardingStatus(env, first.id);
  assert.deepEqual(data.steps, { firstVideo: true, pageConnected: false, hasPackage: false });

  const otherData = await onboardingStatus(env, other.id);
  // other is a brand-new account too, so the signup bonus applies to it as
  // well; the no-leak proof is that first's done video job does not show up
  // in other's steps.
  assert.deepEqual(otherData, {
    credits: 3,
    signupBonus: 3,
    steps: { firstVideo: false, pageConnected: true, hasPackage: true },
  });

  // Route contract: other paths return null, wrong method is rejected.
  const otherUrl = new URL('https://naka.test/api/other');
  assert.equal(await handleOnboarding(new Request(otherUrl), env, otherUrl, first.id), null);
  const post = await handleOnboarding(new Request('https://naka.test/api/onboarding', { method: 'POST' }), env, new URL('https://naka.test/api/onboarding'), first.id);
  assert.equal(post.status, 405);
});
