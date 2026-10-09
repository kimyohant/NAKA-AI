#!/usr/bin/env node
/**
 * Copy the studio's old SQLite database (data/huobao.sqlite3, used before docs/adr/0004) into PostgreSQL.
 * ADR-0004 step 9: the move to PostgreSQL started from an empty database, so style presets, AI configs,
 * dramas, campaigns, … made on the old system are still only in the SQLite file.
 *
 *   node scripts/import-sqlite.mjs <file.sqlite3>           dry run: what would be copied, nothing written
 *   node scripts/import-sqlite.mjs <file.sqlite3> --apply   copy, in one transaction (all or nothing)
 *
 * DATABASE_URL is the target (the studio's own, role studio_app). Rules:
 * - every table both databases have is copied with its ids (no foreign keys in the schema; rows refer to each
 *   other by id), then each identity sequence moves past the largest id
 * - a table that already has rows in PostgreSQL stops the import, except:
 *   style_presets  the startup seeds: replaced by the old rows (the seeds come back on the next start if missing)
 *   users          accounts that signed in since the move are kept; old accounts are added
 *   app_settings   settings saved since the move are kept; old keys are added
 * - columns or tables PostgreSQL no longer has are listed and skipped; booleans 0/1 become false/true
 * - jobs left running in the old system are copied as stopped, so startup recovery does not pick them up again
 *
 * The SQLite file is opened read-only. Driver: node:sqlite (Node ≥ 22.13), else better-sqlite3
 * (SQLITE_DRIVER=<path to the package> when it is installed elsewhere, e.g. in the Node 20 production image).
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const IDENT = /^[a-z_][a-z0-9_]*$/
const q = (name) => {
  if (!IDENT.test(name)) throw new Error(`unexpected identifier: ${name}`)
  return `"${name}"`
}

/** tables PostgreSQL may already have rows in, and how old rows are merged into them */
const MERGE = {
  style_presets: 'replace',
  users: { conflict: 'id' },
  app_settings: { conflict: 'key' },
}
const SKIP_TABLES = new Set(['schema_migrations'])

/** old jobs that were running when the old system stopped: copied as stopped */
const STOP_LIVE = {
  sys_task: { live: ['queued', 'submitting', 'processing', 'unknown'], status: 'failed', error: 'E_TASK_INTERRUPTED: stopped when the studio moved to PostgreSQL' },
  pipeline_tasks: { live: ['running'], status: 'error', error: 'stopped when the studio moved to PostgreSQL' },
}

export async function openSqlite(file) {
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(file, { readOnly: true })
    return { all: (sql) => db.prepare(sql).all(), close: () => db.close() }
  } catch (err) {
    if (err?.code === 'ERR_SQLITE_ERROR') throw err // node:sqlite is there; the file is the problem
  }
  const require = createRequire(import.meta.url)
  const Database = require(process.env.SQLITE_DRIVER || 'better-sqlite3')
  const db = new Database(file, { readonly: true, fileMustExist: true })
  return { all: (sql) => db.prepare(sql).all(), close: () => db.close() }
}

function convert(value, type, where) {
  if (value === null || value === undefined) return null
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value
    if (value === 1 || value === '1' || value === 'true') return true
    if (value === 0 || value === '0' || value === 'false') return false
    throw new Error(`${where}: not a boolean: ${JSON.stringify(value)}`)
  }
  if (type === 'bigint' || type === 'integer' || type === 'smallint') {
    const n = typeof value === 'bigint' ? Number(value) : Number(value)
    if (!Number.isInteger(n)) throw new Error(`${where}: not an integer: ${JSON.stringify(value)}`)
    return n
  }
  if (type === 'double precision' || type === 'real' || type === 'numeric') {
    const n = Number(value)
    if (!Number.isFinite(n)) throw new Error(`${where}: not a number: ${JSON.stringify(value)}`)
    return n
  }
  if (value instanceof Uint8Array) return Buffer.from(value).toString('utf8')
  return typeof value === 'string' ? value : String(value)
}

/**
 * @param {{ sqlite: { all(sql: string): any[] }, query: (text: string, params?: any[]) => Promise<any[]>, apply: boolean, log?: (line: string) => void }} opts
 * `query` must run every statement on one connection (a transaction when apply is true).
 */
export async function importSqlite({ sqlite, query, apply, log = console.log }) {
  const pgTables = (await query(
    `SELECT table_name AS name FROM information_schema.tables
     WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name`,
  )).map(r => r.name).filter(n => !SKIP_TABLES.has(n))
  const pgColumns = new Map()
  for (const row of await query(
    `SELECT table_name, column_name, data_type, is_nullable, column_default, is_identity
     FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position`,
  )) {
    if (!pgColumns.has(row.table_name)) pgColumns.set(row.table_name, [])
    pgColumns.get(row.table_name).push(row)
  }
  const sqliteTables = sqlite.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .map(r => r.name).filter(n => !SKIP_TABLES.has(n))

  const report = { tables: [], skippedTables: sqliteTables.filter(t => !pgTables.includes(t)), blockers: [] }
  for (const table of pgTables) {
    if (!sqliteTables.includes(table)) continue
    const oldCount = Number(sqlite.all(`SELECT COUNT(*) AS n FROM ${q(table)}`)[0].n)
    const pgCount = Number((await query(`SELECT COUNT(*) AS n FROM ${q(table)}`))[0].n)
    const oldCols = sqlite.all(`PRAGMA table_info(${q(table)})`).map(c => c.name)
    const cols = pgColumns.get(table)
    const shared = cols.filter(c => oldCols.includes(c.column_name))
    const dropped = oldCols.filter(c => !cols.some(p => p.column_name === c))
    const missingRequired = cols.filter(c => !oldCols.includes(c.column_name) && c.is_nullable === 'NO' && c.column_default === null && c.is_identity !== 'YES')
    const merge = MERGE[table]
    const entry = { table, oldCount, pgCount, shared, dropped, merge: pgCount > 0 && oldCount > 0 ? (merge === 'replace' ? 'replace' : merge ? 'add-missing' : null) : null }
    if (missingRequired.length && oldCount) report.blockers.push(`${table}: PostgreSQL needs ${missingRequired.map(c => c.column_name).join(', ')}, which the old table does not have`)
    if (pgCount > 0 && oldCount > 0 && !merge) report.blockers.push(`${table}: PostgreSQL already has ${pgCount} rows`)
    report.tables.push(entry)
  }

  for (const t of report.tables) {
    if (!t.oldCount) continue
    const how = t.merge === 'replace' ? ` (replaces the ${t.pgCount} seed rows)` : t.merge === 'add-missing' ? ` (adds to ${t.pgCount} existing rows, existing ones win)` : ''
    log(`${t.table.padEnd(30)} ${String(t.oldCount).padStart(6)} rows${how}${t.dropped.length ? `  · old columns not copied: ${t.dropped.join(', ')}` : ''}`)
  }
  if (report.skippedTables.length) log(`old tables PostgreSQL does not have (not copied): ${report.skippedTables.join(', ')}`)
  if (report.blockers.length) {
    for (const b of report.blockers) log(`STOP ${b}`)
    throw new Error(`import stopped: ${report.blockers.length} problem(s) above`)
  }
  if (!apply) {
    log('dry run: nothing written (add --apply to copy)')
    return report
  }

  for (const t of report.tables) {
    if (!t.oldCount) continue
    if (t.merge === 'replace') await query(`DELETE FROM ${q(t.table)}`)
    const conflict = t.merge === 'add-missing' ? ` ON CONFLICT (${q(MERGE[t.table].conflict)}) DO NOTHING` : ''
    const stop = STOP_LIVE[t.table]
    const names = t.shared.map(c => c.column_name)
    const rows = sqlite.all(`SELECT ${names.map(q).join(', ')} FROM ${q(t.table)}`)
    const perChunk = Math.max(1, Math.floor(20000 / names.length))
    let written = 0
    for (let i = 0; i < rows.length; i += perChunk) {
      const params = []
      const tuples = rows.slice(i, i + perChunk).map((row, r) => {
        if (stop && stop.live.includes(row.status)) {
          row.status = stop.status
          if (!row.error_msg) row.error_msg = stop.error
        }
        return `(${t.shared.map(c => {
          const v = convert(row[c.column_name], c.data_type, `${t.table} row ${i + r + 1} ${c.column_name}`)
          // NOT NULL column the old row left empty: let PostgreSQL fill its default
          if (v === null && c.is_nullable === 'NO' && (c.column_default !== null || c.is_identity === 'YES')) return 'DEFAULT'
          params.push(v)
          return `$${params.length}`
        }).join(', ')})`
      })
      const res = await query(`INSERT INTO ${q(t.table)} (${names.map(q).join(', ')}) VALUES ${tuples.join(', ')}${conflict} RETURNING 1 AS ok`, params)
      written += res.length
    }
    t.written = written
    const idCol = t.shared.find(c => c.column_name === 'id' && c.is_identity === 'YES')
    if (idCol) {
      await query(`SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT COALESCE(MAX(id), 0) + 1 FROM ${q(t.table)}), false)`, [t.table])
    }
  }
  for (const t of report.tables) {
    if (!t.oldCount) continue
    const now = Number((await query(`SELECT COUNT(*) AS n FROM ${q(t.table)}`))[0].n)
    const expected = t.merge === 'replace' ? t.oldCount : t.merge === 'add-missing' ? null : t.oldCount
    const ok = expected === null ? now >= t.pgCount : now === expected
    log(`${ok ? 'ok  ' : 'DIFF'} ${t.table.padEnd(30)} old ${t.oldCount} · copied ${t.written} · now ${now}`)
    if (!ok) throw new Error(`${t.table}: expected ${expected} rows after the copy, found ${now}`)
  }
  log('copied; restart the studio so startup recovery and the style seeds run on the imported data')
  return report
}

async function main() {
  const args = process.argv.slice(2)
  const file = args.find(a => !a.startsWith('--'))
  if (!file) {
    console.error('usage: node scripts/import-sqlite.mjs <file.sqlite3> [--apply]')
    process.exit(2)
  }
  const url = process.env.DATABASE_URL
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    console.error('DATABASE_URL must point at the studio PostgreSQL (postgres://…)')
    process.exit(2)
  }
  const apply = args.includes('--apply')
  const sqlite = await openSqlite(file)
  const { default: postgres } = await import('postgres')
  const sql = postgres(url, { max: 1, onnotice: () => {} })
  try {
    // one transaction either way: a dry run reads the same snapshot and writes nothing
    await sql.begin(async (tx) => {
      await importSqlite({ sqlite, apply, query: (text, params = []) => tx.unsafe(text, params) })
    })
  } catch (err) {
    console.error(`\n${err.message}`)
    process.exitCode = 1
  } finally {
    sqlite.close()
    await sql.end()
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await main()
