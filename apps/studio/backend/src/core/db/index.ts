/**
 * Studio database — PostgreSQL (schema `studio` of the shared database; docs/adr/0004).
 *
 *   DATABASE_URL=postgres://studio_app:…@postgres:5432/naka   production (postgres.js pool)
 *   DATABASE_URL=pglite://memory                               tests: in-process PostgreSQL, gone on exit
 *   DATABASE_URL=pglite:///abs/dir  (or unset → data/pglite)   local dev without Docker, kept on disk
 *
 * On import: connect, apply migrations/pg/NNNN_*.sql that have not run yet (advisory lock), and seed
 * the style presets. Queries use Drizzle (`db`, `schema`); `rawQuery` is for the few raw statements.
 */
import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { drizzle as drizzlePostgres, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'
import { migrate } from './migrate.js'
import { seedStylePresets } from './seed.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// src/core/db → up four levels is the repo root (apps/studio); migrations live in backend/migrations/pg
const repoRoot = path.resolve(__dirname, '../../../..')
const migrationsDir = path.resolve(__dirname, '../../../migrations/pg')

export const DB_SCHEMA = process.env.DB_SCHEMA || 'studio'
export const databaseUrl = process.env.DATABASE_URL || `pglite://${path.join(repoRoot, 'data', 'pglite')}`

type Row = Record<string, unknown>
/** Run one statement with $1… parameters; rows as objects. */
export let rawQuery: (text: string, params?: unknown[]) => Promise<Row[]>
/** Run a script of statements (no parameters). */
export let rawExec: (script: string) => Promise<void>
/** Run fn inside one transaction (raw statements). */
export let rawTransaction: <T>(fn: (q: typeof rawQuery) => Promise<T>) => Promise<T>
export let closeDb: () => Promise<void>

let client: unknown
if (databaseUrl.startsWith('pglite://')) {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite')
  // pglite://memory | pglite:///abs/dir | pglite://C:/dir | pglite://C:\dir
  const location = databaseUrl.slice('pglite://'.length).replace(/^\/([A-Za-z]:)/, '$1')
  if (location !== 'memory' && location !== '') fs.mkdirSync(path.dirname(location), { recursive: true })
  const pg = location === 'memory' || location === '' ? new PGlite() : new PGlite(location)
  // one connection: the search path set here holds for every query
  await pg.exec(`CREATE SCHEMA IF NOT EXISTS "${DB_SCHEMA}"; SET search_path TO "${DB_SCHEMA}";`)
  rawQuery = async (text, params = []) => (await pg.query<Row>(text, params)).rows
  rawExec = async script => { await pg.exec(script) }
  rawTransaction = fn => pg.transaction(tx => fn(async (text, params = []) => (await tx.query<Row>(text, params)).rows))
  closeDb = () => pg.close()
  client = drizzlePglite(pg, { schema })
} else {
  const { default: postgres } = await import('postgres')
  const sql = postgres(databaseUrl, {
    max: Number(process.env.DB_POOL_MAX || 10),
    // the role's search_path says the same in production; explicit for dev/admin logins
    connection: { search_path: DB_SCHEMA, application_name: 'naka-studio' },
    onnotice: () => {},
  })
  rawQuery = async (text, params = []) => [...await sql.unsafe<Row[]>(text, params as never[])]
  rawExec = async script => { await sql.unsafe(script) }
  rawTransaction = fn => sql.begin(tx => fn(async (text, params = []) => [...await tx.unsafe<Row[]>(text, params as never[])])) as never
  closeDb = () => sql.end({ timeout: 5 })
  client = drizzlePostgres(sql, { schema })
}

/** Drizzle on either driver (same query-builder API; postgres-js typing). */
export const db = client as PostgresJsDatabase<typeof schema>
export { schema }
export type DB = typeof db

if (process.env.DB_MIGRATE !== '0') {
  const applied = await migrate(rawTransaction, migrationsDir)
  for (const name of applied) console.log(`🧩 migration ${name} applied`)
  await seedStylePresets(db)
}

/** Id of the row an insert returned: `const [row] = await db.insert(t).values(v).returning({ id: t.id })`. */
export function insertedId(rows: Array<{ id: number }>): number {
  const id = rows[0]?.id
  if (id === undefined || id === null) throw new Error('insert returned no id')
  return Number(id)
}

/** SQLSTATE of a failed query ('23505' = unique_violation). Drizzle wraps the driver's error in `cause`. */
export function pgErrorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined
  const code = typeof e?.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code) ? e.code : e?.cause?.code
  return typeof code === 'string' ? code : undefined
}
