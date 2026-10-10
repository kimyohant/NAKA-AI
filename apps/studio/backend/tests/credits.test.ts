/**
 * Naka Studio charges naka-ai credits for image and video tasks (core/auth/credits.ts, docs/credit-pricing.md):
 * priced from account.credit_prices, held with the task insert, committed on success, refunded on failure/cancel/delete.
 * The account schema is the real one (apps/landing/migrations/pg/*.sql in schema "account"), like entitlements.test.ts.
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeEach, mock, test } from 'node:test'

process.env.DATABASE_URL = 'pglite://memory'
process.env.NAKA_SSO_URL = 'http://localhost:8788'
process.env.NAKA_SSO_SECRET = 'x'.repeat(40)

const { db, schema, rawExec, rawQuery } = await import('../src/core/db/index.js')
const credits = await import('../src/core/auth/credits.js')
const { generateImage, generateVideo, cancelGenerationTask } = await import('../src/core/generation/generation.js')
const { runAsOwner } = await import('../src/core/auth/owner-context.js')
const { now } = await import('../src/core/http/response.js')
const { eq } = await import('drizzle-orm')

// provider calls never leave the process: a submit just hangs
mock.method(globalThis, 'fetch', () => new Promise<Response>(() => {}))

const migrations = path.resolve(import.meta.dirname, '../../../landing/migrations/pg')
await rawExec('CREATE SCHEMA account; SET search_path TO account;')
for (const file of readdirSync(migrations).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort()) {
  await rawExec(readFileSync(path.join(migrations, file), 'utf8'))
}
await rawExec(`SET search_path TO studio;
  INSERT INTO account.users (id, display_name, created_at) VALUES ('rich', 'มีเครดิต', 1), ('poor', 'เครดิตน้อย', 1), ('boss', 'แอดมิน', 1);
  INSERT INTO account.subscriptions (user_id, plan_id, status, expires_at) VALUES
    ('rich', 'max', 'active', 4102444800), ('poor', 'max', 'active', 4102444800);
  INSERT INTO account.credit_ledger (user_id, delta, reason, note) VALUES ('rich', 100, 'grant', 't'), ('poor', 2, 'grant', 't');`)

const ts = now()
await db.insert(schema.aiServiceConfigs).values([
  { serviceType: 'video', provider: 'volcengine', name: 'v', baseUrl: 'http://127.0.0.1:9', apiKey: 'k', model: JSON.stringify(['doubao-seedance-2-0-pro']),
    isActive: true, isDefault: true, priority: 1, createdAt: ts, updatedAt: ts },
  { serviceType: 'image', provider: 'openai', name: 'i', baseUrl: 'http://127.0.0.1:9', apiKey: 'k', model: JSON.stringify(['m']),
    isActive: true, isDefault: true, priority: 1, createdAt: ts, updatedAt: ts },
])
const drama = async (owner: string) => (await db.insert(schema.dramas).values({ title: 'งาน', status: 'draft', ownerUserId: owner, createdAt: ts, updatedAt: ts })
  .returning({ id: schema.dramas.id }))[0].id

const balance = async (user: string) => Number((await rawQuery('SELECT coalesce(sum(delta), 0) AS b FROM account.credit_ledger WHERE user_id = $1', [user]))[0].b)
const task = async (id: number) => (await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id)))[0]
const holdStatus = async (holdId: number) => (await rawQuery('SELECT status FROM account.credit_holds WHERE ledger_id = $1', [holdId]))[0]?.status
async function price(key: string, value: number, perSecond = false) {
  await rawQuery('UPDATE account.credit_prices SET credits = $1, per_second = $2 WHERE key = $3', [value, perSecond, key])
  credits.clearPriceCache()
}

beforeEach(async () => { await price('studio.video', 5); await price('studio.image', 0) })

test('creditsFor: whole credits, rounded up; per second needs at least 1 s', () => {
  assert.equal(credits.creditsFor({ credits: 5, perSecond: false }, 12), 5)
  assert.equal(credits.creditsFor({ credits: 0.5, perSecond: true }, 5), 3)
  assert.equal(credits.creditsFor({ credits: 0.1, perSecond: true }, 30), 3)
  assert.equal(credits.creditsFor({ credits: 2, perSecond: true }, undefined), 2)
})

test('a video holds its price from the project owner inside the task insert; images are free by default', async () => {
  const before = await balance('rich')
  const id = await generateVideo({ dramaId: await drama('rich'), prompt: 'shot', duration: 5 })
  const t = await task(id)
  assert.equal(t.creditsCharged, 5)
  assert.ok(t.creditHoldId)
  assert.equal(await holdStatus(t.creditHoldId!), 'held')
  assert.equal(await balance('rich'), before - 5)
  const [row] = await rawQuery('SELECT reason, job_id FROM account.credit_ledger WHERE id = $1', [t.creditHoldId])
  assert.deepEqual({ reason: row.reason, ref: row.job_id }, { reason: 'studio_hold', ref: `studio:video:${id}` })

  const image = await runAsOwner({ ownerId: 'rich', admin: false }, () => generateImage({ prompt: 'ภาพ', dramaId: undefined }))
  assert.equal((await task(image)).creditHoldId, null, 'images cost 0 credits until the owner sets a price')
  assert.equal(await balance('rich'), before - 5)
})

test('the owner\'s price applies to the next task: per second, and images when priced', async () => {
  await price('studio.video', 0.5, true)
  const id = await generateVideo({ dramaId: await drama('rich'), prompt: 'shot', duration: 10 })
  assert.equal((await task(id)).creditsCharged, 5, '0.5 × 10 s')
  await price('studio.image', 2)
  const image = await runAsOwner({ ownerId: 'rich', admin: false }, () => generateImage({ prompt: 'ภาพ' }))
  assert.equal((await task(image)).creditsCharged, 2)
})

test('not enough credits: refused in Thai, no task, the monthly video quota given back', async () => {
  const used = async () => Number((await rawQuery(
    "SELECT coalesce(sum(used), 0) AS n FROM account.feature_usage WHERE user_id = 'poor' AND feature_key = 'studio.video'"))[0].n)
  const tasksBefore = (await db.select().from(schema.sysTask)).length
  const usedBefore = await used()
  await assert.rejects(generateVideo({ dramaId: await drama('poor'), prompt: 'shot', duration: 5 }), (e: any) => {
    assert.equal(e.errorCode, 'E_CREDITS_INSUFFICIENT')
    assert.match(e.message, /เครดิตไม่พอ งานนี้ใช้ 5 เครดิต แต่เหลือ 2 เครดิต/)
    return true
  })
  assert.equal((await db.select().from(schema.sysTask)).length, tasksBefore, 'the insert rolled back')
  assert.equal(await used(), usedBefore, 'quota released')
  assert.equal(await balance('poor'), 2)
})

test('settle: commit is final; refund gives the credits back once; a task without a hold is a no-op', async () => {
  const done = await generateVideo({ dramaId: await drama('rich'), prompt: 'a', duration: 5 })
  const failed = await generateVideo({ dramaId: await drama('rich'), prompt: 'b', duration: 5 })
  const before = await balance('rich')
  await credits.settleTaskCredits(done, 'commit')
  await credits.settleTaskCredits(done, 'refund')
  assert.equal(await holdStatus((await task(done)).creditHoldId!), 'committed')
  await credits.settleTaskCredits(failed, 'refund')
  await credits.settleTaskCredits(failed, 'refund')
  assert.equal(await holdStatus((await task(failed)).creditHoldId!), 'refunded')
  assert.equal(await balance('rich'), before + 5, 'one refund, not two')
  const [refund] = await rawQuery("SELECT count(*) AS n FROM account.credit_ledger WHERE reason = 'studio_refund' AND job_id = $1", [`studio:video:${failed}`])
  assert.equal(Number(refund.n), 1)
  await credits.settleTaskCredits(999_999, 'refund')
})

test('a task the provider rejects fails and gives its credits back', async () => {
  // this model is refused by the Seedance adapter before anything is sent
  const [bad] = await db.insert(schema.aiServiceConfigs).values({ serviceType: 'video', provider: 'volcengine', name: 'bad', baseUrl: 'http://127.0.0.1:9',
    apiKey: 'k', model: JSON.stringify(['not-seedance']), isActive: true, isDefault: false, priority: 0, createdAt: ts, updatedAt: ts })
    .returning({ id: schema.aiServiceConfigs.id })
  const before = await balance('rich')
  const id = await generateVideo({ dramaId: await drama('rich'), prompt: 'x', duration: 5, configId: bad.id })
  for (let i = 0; i < 50 && (await task(id)).status !== 'failed'; i++) await new Promise(r => setTimeout(r, 20))
  const t = await task(id)
  assert.equal(t.status, 'failed')
  assert.equal(await holdStatus(t.creditHoldId!), 'refunded')
  assert.equal(await balance('rich'), before)
})

test('cancelling a queued task refunds its hold', async () => {
  const [hold] = await rawQuery("SELECT ok, hold_id FROM account.hold_credits('rich', 5, 'studio:video:cancel-test')")
  const [row] = await db.insert(schema.sysTask).values({ type: 'video', prompt: 'q', provider: 'volcengine', status: 'queued',
    ownerUserId: 'rich', creditHoldId: Number(hold.hold_id), creditsCharged: 5, createdAt: ts, updatedAt: ts }).returning({ id: schema.sysTask.id })
  const before = await balance('rich')
  assert.equal(await cancelGenerationTask(row.id), 'cancelled')
  assert.equal(await holdStatus(Number(hold.hold_id)), 'refunded')
  assert.equal(await balance('rich'), before + 5)
})

test('admins, single-user rows and NAKA_CREDITS=off are never charged', async () => {
  await db.insert(schema.users).values({ id: 'boss', displayName: 'แอดมิน', isAdmin: true, createdAt: ts, updatedAt: ts }).onConflictDoNothing()
  assert.equal(await credits.taskCredits('boss', 'video', 5), 0, 'a studio admin owner')
  assert.equal(await runAsOwner({ ownerId: 'rich', admin: true }, () => credits.taskCredits('rich', 'video', 5)), 0, 'an admin at work')
  assert.equal(await credits.taskCredits('local', 'video', 5), 0)
  process.env.NAKA_CREDITS = 'off'
  try { assert.equal(await credits.taskCredits('rich', 'video', 5), 0) } finally { delete process.env.NAKA_CREDITS }
  assert.equal(await credits.taskCredits('rich', 'video', 5), 5)
})

test('every way a task ends settles its hold', () => {
  const gen = readFileSync(path.resolve(import.meta.dirname, '../src/core/generation/generation.ts'), 'utf8')
  assert.equal(gen.match(/settleTaskCredits\(record\.id, 'commit'\)/g)?.length, 3, 'the three completion handlers')
  assert.match(gen, /async function failTask[\s\S]{0,400}settleTaskCredits\(id, 'refund'\)/)
  assert.match(gen, /if \(result === 'cancelled'\) \{\s+await settleTaskCredits\(id, 'refund'\)/)
  assert.doesNotMatch(gen.match(/async function markUnknown[\s\S]*?\n\}/)![0], /settleTaskCredits/, 'unknown keeps the hold')
  const routes = readFileSync(path.resolve(import.meta.dirname, '../src/core/routes/tasks.ts'), 'utf8')
  assert.match(routes, /if \(task && task\.status !== 'completed'\) await settleTaskCredits\(id, 'refund'\)/)
})
