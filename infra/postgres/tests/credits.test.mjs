// The account side of the shared database in PGlite (Postgres in-process, no Docker): the layout
// (init/01-schemas-roles.sql), the landing migrations run as account_app, then the reporting views
// (init/03-reporting.sql). studio_app may only hold/commit/refund credits and read users_public;
// reporting_ro may only read the views.
// Run: npm run test:db (repo root)
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/^\\set .*$/m, '') // psql meta-command
const initSql = read('../init/01-schemas-roles.sql').replaceAll('DATABASE naka', 'DATABASE postgres') // PGlite's database name
const reportingSql = read('../init/03-reporting.sql')
const migrationsDir = new URL('../../../apps/landing/migrations/pg/', import.meta.url)
const migrations = readdirSync(migrationsDir).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort()

const db = new PGlite()
await db.exec(initSql)

/** Run as `role` with the role's search_path (ALTER ROLE … SET applies at login; emulate it for SET ROLE). */
async function as(role, run) {
  await db.exec(`RESET ROLE`)
  const { rows } = await db.query(`SELECT unnest(setconfig) AS c FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1`, [role])
  await db.exec(`SET ROLE ${role}`)
  for (const { c } of rows) { const [k, v] = c.split('='); if (k === 'search_path') await db.exec(`SET search_path = ${v}`) }
  try { return await run() } finally { await db.exec('RESET ROLE; RESET search_path') }
}
const query = (role, sql, params = []) => as(role, async () => (await db.query(sql, params)).rows)
const denied = (role, sql) => assert.rejects(() => query(role, sql), /permission denied/, `${role} should not run: ${sql}`)

const studio = {
  hold: async (user, amount, ref) => {
    const [r] = await query('studio_app', `SELECT * FROM account.hold_credits($1, $2, $3)`, [user, amount, ref])
    return { ok: r.ok, holdId: r.hold_id === null ? null : Number(r.hold_id), balance: Number(r.balance) }
  },
  commit: async id => (await query('studio_app', `SELECT account.commit_hold($1) AS s`, [id]))[0].s,
  refund: async id => (await query('studio_app', `SELECT account.refund_hold($1) AS s`, [id]))[0].s,
}
// apps/landing/src/credits.ts getBalance
const balance = async user => Number((await query('account_app', `SELECT coalesce(sum(delta), 0) AS b FROM credit_ledger WHERE user_id = $1`, [user]))[0].b)
const grant = (user, amount) => query('account_app', `INSERT INTO credit_ledger (user_id, delta, reason) VALUES ($1, $2, 'grant')`, [user, amount])

test('the reporting file is a no-op before the apps have migrated', async () => {
  await db.exec(reportingSql)
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_views WHERE schemaname = 'reporting'`)
  assert.equal(rows[0].n, 0)
})

test('the landing migrations run as account_app with unqualified names', async () => {
  for (const file of migrations) await as('account_app', () => db.exec(readFileSync(new URL(file, migrationsDir), 'utf8')))
  assert.ok(migrations.includes('0002_shared.sql'))
  await query('account_app', `INSERT INTO users (id, display_name, created_at) VALUES ('u1', 'Somchai', 1), ('u2', 'Malee', 2), ('u3', 'Niran', 3)`)
  await query('account_app', `INSERT INTO auth_identities (id, user_id, provider, provider_uid, email, verified_at)
    VALUES ('i1', 'u1', 'password', 'somchai@example.test', 'somchai@example.test', 1)`)
})

test('studio_app holds credits but cannot touch the account tables', async () => {
  await grant('u1', 100)
  const hold = await studio.hold('u1', 30, 'studio:task-1')
  assert.deepEqual({ ok: hold.ok, balance: hold.balance }, { ok: true, balance: 70 })
  assert.equal(await balance('u1'), 70)
  assert.equal(await studio.commit(hold.holdId), 'committed')
  for (const table of ['credit_ledger', 'credit_holds', 'users', 'auth_identities', 'auth_passwords', 'sessions', 'payments', 'jobs']) {
    await denied('studio_app', `SELECT * FROM account.${table}`)
  }
  await denied('studio_app', `INSERT INTO account.credit_ledger (user_id, delta, reason) VALUES ('u1', 1000, 'grant')`)
  await denied('studio_app', `UPDATE account.credit_holds SET status = 'held'`)
  await denied('studio_app', `CREATE TABLE account.evil (id int)`)
  await denied('studio_app', `SELECT account.json_extract('{}', '$.a')`) // the SQLite helpers are closed too
  await denied('reporting_ro', `SELECT * FROM account.hold_credits('u1', 1, 'reporting')`)
  await denied('reporting_ro', `SELECT account.refund_hold(1)`)
})

test('a hold that the balance does not cover is refused and writes nothing', async () => {
  await grant('u2', 50)
  assert.equal((await studio.hold('u2', 40, 'studio:a')).ok, true)
  assert.deepEqual(await studio.hold('u2', 11, 'studio:b'), { ok: false, holdId: null, balance: 10 })
  assert.equal((await studio.hold('u2', 10, 'studio:c')).balance, 0)
  assert.deepEqual(await studio.hold('u2', 1, 'studio:d'), { ok: false, holdId: null, balance: 0 })
  assert.deepEqual(await studio.hold('nobody', 1, 'studio:e'), { ok: false, holdId: null, balance: 0 })
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM account.credit_ledger WHERE job_id IN ('studio:b', 'studio:d', 'studio:e')`)
  assert.equal(rows[0].n, 0)
  await assert.rejects(() => studio.hold('u2', 0, 'studio:zero'), /amount must be positive/)
  await assert.rejects(() => studio.hold('', 1, 'studio:nouser'), /user and ref are required/)
})

test('a hold is idempotent per ref', async () => {
  await grant('u3', 20)
  const first = await studio.hold('u3', 5, 'studio:same')
  assert.deepEqual(await studio.hold('u3', 5, 'studio:same'), first)
  assert.equal(await balance('u3'), 15)
  await assert.rejects(() => studio.hold('u1', 5, 'studio:same'), /already holds/)  // another user
  await assert.rejects(() => studio.hold('u3', 6, 'studio:same'), /already holds/)  // another amount
  assert.equal(await studio.refund(first.holdId), 'refunded')
  assert.deepEqual(await studio.hold('u3', 5, 'studio:same'), { ok: false, holdId: first.holdId, balance: 20 }, 'a refunded ref is not held again')
})

test('a refund gives the credits back once; a committed hold is never refunded', async () => {
  const hold = await studio.hold('u3', 7, 'studio:refund-twice')
  assert.equal(await balance('u3'), 13)
  assert.equal(await studio.refund(hold.holdId), 'refunded')
  assert.equal(await studio.refund(hold.holdId), 'refunded')
  assert.equal(await balance('u3'), 20)
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM account.credit_ledger WHERE job_id = 'studio:refund-twice' AND reason = 'studio_refund'`)
  assert.equal(rows[0].n, 1)
  assert.equal(await studio.commit(hold.holdId), 'refunded', 'too late to commit')

  const kept = await studio.hold('u3', 4, 'studio:commit')
  assert.equal(await studio.commit(kept.holdId), 'committed')
  assert.equal(await studio.commit(kept.holdId), 'committed')
  assert.equal(await studio.refund(kept.holdId), 'committed')
  assert.equal(await balance('u3'), 16)
})

test('only holds made by hold_credits can be committed or refunded', async () => {
  const [{ id }] = await query('account_app', `INSERT INTO credit_ledger (user_id, delta, reason, job_id) VALUES ('u3', -1, 'job_hold', 'landing-job') RETURNING id`)
  await assert.rejects(() => studio.refund(Number(id)), /no studio hold/)
  await assert.rejects(() => studio.commit(999999), /no studio hold/)
})

test('hold_credits refuses snapshot isolation (it could not see a concurrent hold)', async () => {
  await assert.rejects(() => as('studio_app', () => db.transaction(async tx => {
    await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ')
    await tx.query(`SELECT * FROM account.hold_credits('u3', 1, 'studio:rr')`)
  })), /needs READ COMMITTED/)
})

test('users_public shows no secrets', async () => {
  const { rows } = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'account' AND table_name = 'users_public' ORDER BY ordinal_position`)
  assert.deepEqual(rows.map(r => r.column_name), ['id', 'display_name', 'status', 'created_at'])
  for (const role of ['studio_app', 'reporting_ro']) {
    const users = await query(role, `SELECT * FROM account.users_public ORDER BY id`)
    assert.deepEqual(users[0], { id: 'u1', display_name: 'Somchai', status: 'active', created_at: 1 })
    assert.ok(!JSON.stringify(users).includes('@'))
  }
  await denied('studio_app', `INSERT INTO account.users_public VALUES ('x', 'x', 'active', 1)`)
})

test('reporting views: created once the tables exist, readable only by reporting_ro', async () => {
  const now = Math.floor(Date.now() / 1000)
  await query('account_app', `INSERT INTO payments (id, user_id, plan_id, period, amount_satang, method, status, created_at, paid_at) VALUES
    ('p1', 'u1', 'pro', 'monthly', 79000, 'promptpay', 'successful', 1767205000, 1767205000),
    ('p2', 'u2', 'starter', 'monthly', 39900, 'card', 'successful', 1767205100, 1767205100),
    ('p3', 'u3', 'pro', 'monthly', 79000, 'card', 'failed', 1767200200, NULL)`)
  await query('account_app', `INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES
    ('u1', 'pro', 'active', ${now + 86400}), ('u2', 'starter', 'active', ${now - 1}), ('u3', 'max', 'expired', ${now + 86400})`)
  await db.exec(reportingSql)
  await db.exec(reportingSql) // idempotent

  // 1767205000 = 2025-12-31 18:16 UTC = 2026-01-01 01:16 in Bangkok
  assert.deepEqual(await query('reporting_ro', `SELECT day::text, payments::int, revenue_baht::text FROM revenue_by_day`),
    [{ day: '2026-01-01', payments: 2, revenue_baht: '1189.00' }])
  const used = await query('reporting_ro', `SELECT user_id, credits_used::int AS used, credits_used_landing::int AS landing,
    credits_used_studio::int AS studio, balance::int AS balance FROM credits_used_by_user ORDER BY user_id`)
  assert.deepEqual(used, [
    { user_id: 'u1', used: 30, landing: 0, studio: 30, balance: 70 },
    { user_id: 'u2', used: 50, landing: 0, studio: 50, balance: 0 },
    { user_id: 'u3', used: 5, landing: 1, studio: 4, balance: 15 },
  ])
  assert.equal(used[2].balance, await balance('u3'))
  assert.deepEqual(await query('reporting_ro', `SELECT user_id, plan_name FROM active_subscriptions`), [{ user_id: 'u1', plan_name: 'โปร' }])

  await denied('reporting_ro', `SELECT * FROM account.payments`)
  await denied('reporting_ro', `SELECT * FROM account.credit_ledger`)
  await denied('reporting_ro', `CREATE VIEW reporting.mine AS SELECT 1`)
  await denied('studio_app', `SELECT * FROM reporting.revenue_by_day`)
  await denied('account_app', `SELECT * FROM reporting.credits_used_by_user`)
})
