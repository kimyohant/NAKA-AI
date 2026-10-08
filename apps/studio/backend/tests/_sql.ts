/**
 * Raw SQL for tests, on the app's own database connection (PostgreSQL via PGlite). Keeps the shape the
 * tests had with the SQLite handle — prepare(sql).run/get/all(...params) — but every call is async.
 * `?` placeholders become $n, typed from the bound value (PostgreSQL cannot infer `'x' || ?`), and
 * SQLite's datetime('now') becomes a UTC 'YYYY-MM-DD HH24:MI:SS' string.
 * Import it AFTER DATABASE_URL is set:  const { sqlite } = await import('./_sql.js')
 */
import { rawQuery, rawExec } from '../src/core/db/index.js'

const castFor = (v: unknown) =>
  typeof v === 'string' ? '::text'
    : typeof v === 'boolean' ? '::boolean'
      : typeof v === 'number' ? (Number.isInteger(v) ? '::bigint' : '::float8')
        : ''

const toPg = (sql: string, params: unknown[]) => {
  let n = 0
  return sql
    .replace(/datetime\('now'\)/g, "to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS')")
    .replace(/\?/g, () => { const i = n++; return `$${i + 1}${castFor(params[i])}` })
}

async function columns(table: string): Promise<string[]> {
  return (await rawQuery(
    'SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1', [table],
  )).map(r => String(r.name))
}

export const sqlite = {
  prepare(sql: string) {
    return {
      /** like better-sqlite3: reports lastInsertRowid for an INSERT into a table with an id column */
      run: async (...params: unknown[]) => {
        const text = toPg(sql, params)
        const table = /^\s*INSERT\s+INTO\s+"?(\w+)"?/i.exec(text)?.[1]
        const wantsId = !!table && !/\bRETURNING\b/i.test(text) && (await columns(table)).includes('id')
        const rows = await rawQuery(wantsId ? `${text} RETURNING id` : text, params)
        return { lastInsertRowid: wantsId ? Number(rows.at(-1)?.id) : 0, changes: rows.length }
      },
      get: async (...params: unknown[]) => (await rawQuery(toPg(sql, params), params))[0] as any,
      all: async (...params: unknown[]) => (await rawQuery(toPg(sql, params), params)) as any[],
    }
  },
  exec: async (sql: string) => { await rawExec(sql) },
  /** column names of a table in the app's schema (was PRAGMA table_info) */
  columns,
  close() {},
}
