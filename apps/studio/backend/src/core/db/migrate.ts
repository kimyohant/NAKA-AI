/**
 * Apply migrations/pg/NNNN_*.sql in order, once each, all in one transaction under an advisory lock
 * (two containers starting together cannot both migrate).
 */
import { readdirSync, readFileSync } from 'fs'
import path from 'path'

const LOCK = 7_204_0003 // any constant; one per app

type Query = (text: string, params?: unknown[]) => Promise<Array<Record<string, unknown>>>

export async function migrate(transaction: <T>(fn: (q: Query) => Promise<T>) => Promise<T>, dir: string): Promise<string[]> {
  const files = readdirSync(dir).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort()
  return transaction(async q => {
    await q('SELECT pg_advisory_xact_lock($1)', [LOCK])
    await q('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())')
    const done = new Set((await q('SELECT name FROM schema_migrations')).map(r => String(r.name)))
    const applied: string[] = []
    for (const file of files) {
      if (done.has(file)) continue
      // split on statement ends: the files hold plain DDL (no functions with ; inside)
      for (const statement of readFileSync(path.join(dir, file), 'utf8').split(/;\s*$/m).map(s => s.trim()).filter(s => s && !/^(--[^\n]*\n?)+$/.test(s))) {
        await q(statement)
      }
      await q('INSERT INTO schema_migrations (name) VALUES ($1)', [file])
      applied.push(file)
    }
    return applied
  })
}
