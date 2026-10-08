// Member features across the schema boundary (apps/landing/migrations/pg/0003_entitlements.sql, docs/entitlements.md):
// the landing migrations run as account_app; studio_app may read a member's features and count/give back a use
// through the three functions, and nothing else — not the tables, not someone's plan matrix.
// Run: npm run test:db (repo root)
import { PGlite } from '@electric-sql/pglite'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/^\\set .*$/m, '') // psql meta-command
const initSql = read('../init/01-schemas-roles.sql').replaceAll('DATABASE naka', 'DATABASE postgres') // PGlite's database name
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

test('the landing migrations (with 0003) run as account_app', async () => {
  for (const file of migrations) await as('account_app', () => db.exec(readFileSync(new URL(file, migrationsDir), 'utf8')))
  assert.ok(migrations.includes('0003_entitlements.sql'))
  await query('account_app', `INSERT INTO users (id, display_name, created_at) VALUES ('m1', 'Malee', 1), ('m2', 'Niran', 1)`)
  await query('account_app', `INSERT INTO subscriptions (user_id, plan_id, status, expires_at) VALUES ('m1', 'starter', 'active', 4102444800)`)
})

test('studio_app reads a member\'s features and counts a use through the functions', async () => {
  const features = await query('studio_app', `SELECT feature_key, enabled, monthly_limit FROM account.member_features('m1') WHERE app = 'studio' AND enabled`)
  assert.deepEqual(features.map(f => f.feature_key), ['studio.drama', 'studio.seller', 'studio.product_studio', 'studio.video'])
  const [use] = await query('studio_app', `SELECT * FROM account.use_feature('m1', 'studio.video', 1)`)
  assert.deepEqual({ ok: use.ok, used: Number(use.used), limit: Number(use.monthly_limit) }, { ok: true, used: 1, limit: 10 })
  const [{ used }] = await query('studio_app', `SELECT account.release_feature('m1', 'studio.video', 1, $1) AS used`, [use.period])
  assert.equal(Number(used), 0)
  const [refused] = await query('studio_app', `SELECT ok, reason FROM account.use_feature('m2', 'studio.video', 1)`)
  assert.deepEqual(refused, { ok: false, reason: 'disabled' }, 'the free plan has no studio video')
})

test('studio_app cannot read or change plans, overrides or usage directly', async () => {
  for (const table of ['features', 'plan_features', 'user_features', 'feature_usage', 'subscriptions']) {
    await denied('studio_app', `SELECT * FROM account.${table}`)
  }
  await denied('studio_app', `INSERT INTO account.user_features (user_id, feature_key, enabled, note, updated_at) VALUES ('m2', 'studio.video', true, 'x', 1)`)
  await denied('studio_app', `UPDATE account.feature_usage SET used = 0`)
  await denied('studio_app', `SELECT account.feature_period()`)
  await denied('reporting_ro', `SELECT * FROM account.member_features('m1')`)
  await denied('reporting_ro', `SELECT * FROM account.use_feature('m1', 'studio.video', 1)`)
})

test('functions run with a fixed search_path: a caller\'s own objects cannot shadow the account tables', async () => {
  const { rows } = await db.query(`SELECT p.proname, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'account' AND p.proname IN ('member_features', 'use_feature', 'release_feature', 'feature_period') ORDER BY 1`)
  assert.equal(rows.length, 4)
  for (const r of rows) assert.deepEqual(r.proconfig, ['search_path=account, pg_temp'], r.proname)
})
