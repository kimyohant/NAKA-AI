/**
 * PostgreSQL executor for the D1 adapter (src/db/pg-d1.ts), on postgres.js.
 * Values come back the way D1 returned them: bigint/numeric → number, boolean → 1/0.
 */
import postgres from 'postgres';
import type { PgExecutor, PgQuery, PgResult } from '../src/db/pg-d1';

const toNumber = { from: [20, 1700], to: 20, serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) };
const toFlag = { from: [16], to: 16, serialize: (x: unknown) => (x ? 't' : 'f'), parse: (x: string) => (x === 't' ? 1 : 0) };

export interface Database {
  executor: PgExecutor;
  sql: postgres.Sql;
  close(): Promise<void>;
}

export function connect(url: string, options: { schema?: string; max?: number } = {}): Database {
  const sql = postgres(url, {
    max: options.max ?? Number(process.env.DB_POOL_MAX ?? 10),
    // the app's own schema first; the role's search_path says the same in production
    connection: { search_path: options.schema ?? 'account', application_name: 'naka-landing' },
    types: { numberish: toNumber, flag: toFlag } as never,
    onnotice: () => {},
  });
  const toResult = (rows: postgres.RowList<postgres.Row[]>): PgResult => ({ rows: [...rows], rowCount: rows.count ?? rows.length });
  const executor: PgExecutor = {
    async query(q: PgQuery) {
      return toResult(await sql.unsafe(q.text, q.values as never[]));
    },
    async batch(qs: PgQuery[]) {
      return sql.begin(async tx => {
        const out: PgResult[] = [];
        for (const q of qs) out.push(toResult(await tx.unsafe(q.text, q.values as never[])));
        return out;
      }) as Promise<PgResult[]>;
    },
    async exec(script: string) {
      await sql.unsafe(script);
    },
  };
  return { executor, sql, close: () => sql.end({ timeout: 5 }) };
}
