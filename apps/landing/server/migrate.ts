/**
 * Apply migrations/pg/NNNN_*.sql in order, once each, inside one transaction per file.
 * An advisory lock keeps two starting containers from migrating at the same time.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type postgres from 'postgres';

const LOCK = 7_204_0001; // any constant; one per app

export async function migrate(sql: postgres.Sql, dir: string): Promise<string[]> {
  const files = readdirSync(dir).filter(f => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  await sql.begin(async tx => {
    await tx`SELECT pg_advisory_xact_lock(${LOCK})`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Set((await tx`SELECT name FROM schema_migrations`).map(r => r.name as string));
    for (const file of files) {
      if (done.has(file)) continue;
      await tx.unsafe(readFileSync(path.join(dir, file), 'utf8'));
      await tx`INSERT INTO schema_migrations (name) VALUES (${file})`;
      applied.push(file);
    }
  });
  return applied;
}
