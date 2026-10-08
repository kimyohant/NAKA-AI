// Checks infra/postgres/init/01-schemas-roles.sql in PGlite (Postgres in-process, no Docker needed):
// each app role owns only its own schema; sharing works only through granted views/functions.
// Run: npm run test:db (repo root)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const initSql = readFileSync(new URL('../init/01-schemas-roles.sql', import.meta.url), 'utf8')
  .replace(/^\\set .*$/m, '')               // psql meta-command
  .replaceAll('DATABASE naka', 'DATABASE postgres')  // PGlite's database name

const db = new PGlite()
await db.exec(initSql)

async function as(role, sql) {
  await db.exec(`RESET ROLE`)
  await db.exec(`SET ROLE ${role}`)
  // ALTER ROLE ... SET search_path applies at login; emulate it for SET ROLE
  const { rows } = await db.query(`SELECT unnest(setconfig) AS c FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = $1`, [role])
  for (const { c } of rows) { const [k, v] = c.split('='); if (k === 'search_path') await db.exec(`SET search_path = ${v}`) }
  try { return await db.exec(sql) } finally { await db.exec('RESET ROLE; RESET search_path') }
}
const denied = async (role, sql) => assert.rejects(() => as(role, sql), /permission denied|must be owner/, `${role} should not run: ${sql}`)

test('schemas exist with the right owners', async () => {
  const { rows } = await db.query(`SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname IN ('account','studio','reporting') ORDER BY 1`)
  assert.deepEqual(rows.map(r => `${r.nspname}:${r.owner}`), ['account:account_app', 'reporting:postgres', 'studio:studio_app'])
})

test('each app creates and uses tables in its own schema with unqualified names', async () => {
  await as('account_app', `CREATE TABLE users (id text PRIMARY KEY, display_name text); INSERT INTO users VALUES ('u1', 'Somchai')`)
  await as('studio_app', `CREATE TABLE dramas (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, owner_user_id text, title text); INSERT INTO dramas (owner_user_id, title) VALUES ('u1', 'test')`)
  const { rows } = await db.query(`SELECT (SELECT count(*) FROM account.users) AS u, (SELECT count(*) FROM studio.dramas) AS d`)
  assert.deepEqual(rows[0], { u: 1, d: 1 })
})

test('apps cannot read, write or create in the other app\'s schema, or in public', async () => {
  await denied('studio_app', `SELECT * FROM account.users`)
  await denied('studio_app', `INSERT INTO account.users VALUES ('x', 'x')`)
  await denied('studio_app', `CREATE TABLE account.evil (id int)`)
  await denied('account_app', `SELECT * FROM studio.dramas`)
  await denied('account_app', `CREATE TABLE studio.evil (id int)`)
  await denied('studio_app', `CREATE TABLE public.evil (id int)`)
  await denied('reporting_ro', `SELECT * FROM account.users`)
})

test('sharing is explicit: a granted view and a SECURITY DEFINER function work for studio_app', async () => {
  await as('account_app', `
    CREATE TABLE credit_ledger (user_id text, delta int);
    INSERT INTO credit_ledger VALUES ('u1', 100);
    CREATE VIEW users_public AS SELECT id, display_name FROM users;
    GRANT USAGE ON SCHEMA account TO studio_app;
    GRANT SELECT ON users_public TO studio_app;
    CREATE FUNCTION hold_credits(p_user text, p_amount int) RETURNS boolean
      LANGUAGE sql SECURITY DEFINER SET search_path = account AS $$
        INSERT INTO credit_ledger SELECT p_user, -p_amount
        WHERE (SELECT coalesce(sum(delta), 0) FROM credit_ledger WHERE user_id = p_user) >= p_amount
        RETURNING true $$;
    REVOKE ALL ON FUNCTION hold_credits(text, int) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION hold_credits(text, int) TO studio_app;`)
  await as('studio_app', `SELECT * FROM account.users_public`)
  await as('studio_app', `SELECT account.hold_credits('u1', 30)`)
  await denied('studio_app', `SELECT * FROM account.users`)          // base table still closed
  await denied('studio_app', `SELECT * FROM account.credit_ledger`)
  const { rows } = await db.query(`SELECT sum(delta)::int AS balance FROM account.credit_ledger WHERE user_id = 'u1'`)
  assert.equal(rows[0].balance, 70)
})

test('reporting_ro is read-only', async () => {
  await db.exec(`CREATE VIEW reporting.dramas_per_user AS SELECT owner_user_id, count(*) FROM studio.dramas GROUP BY 1`)
  await as('reporting_ro', `SELECT * FROM reporting.dramas_per_user`)
  await denied('reporting_ro', `CREATE TABLE reporting.x (id int)`)
})
