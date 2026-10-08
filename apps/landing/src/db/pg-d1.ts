/**
 * D1Database on PostgreSQL (docs/adr/0004-shared-postgres-and-queues.md).
 *
 * The Worker code talks to `env.DB` through the D1 API (prepare/bind/first/all/run/batch). This file
 * keeps that API and runs the SQL on PostgreSQL, so the ~280 call sites stay as they are. It has no
 * dependencies: the caller hands it an executor (postgres.js in production, PGlite in tests).
 *
 * What `translate` does to each statement, outside string literals and comments:
 *  - `?` / `?NNN` placeholders → `$n` (SQLite numbering: a bare `?` takes the largest number used so
 *    far + 1), with a cast taken from the bound JS value: integers `::bigint`, other numbers
 *    `::float8`, booleans `::bigint` (bound as 1/0, as D1 does). PostgreSQL would otherwise type an
 *    untyped parameter in `INSERT … SELECT ?` as text and refuse to store it in a bigint column.
 *  - camelCase identifiers (`AS displayName`, `ORDER BY createdAt`) are double-quoted: PostgreSQL
 *    folds unquoted names to lower case, SQLite keeps them, and the code reads `row.displayName`.
 *  - an INSERT into a table with an identity id gets `RETURNING id`, reported as meta.last_row_id.
 *  - `INSERT OR IGNORE` becomes `INSERT … ON CONFLICT DO NOTHING`.
 * SQLite-only functions the SQL still uses (datetime, json_extract, json_valid, instr, unixepoch) are
 * defined in the schema itself (migrations/pg/0001_baseline.sql).
 */

export type Row = Record<string, unknown>;

export interface PgQuery {
  text: string;
  values: unknown[];
}

export interface PgResult {
  rows: Row[];
  rowCount: number;
}

/** What the adapter needs from a driver. */
export interface PgExecutor {
  query(q: PgQuery): Promise<PgResult>;
  /** Run the statements in order inside one transaction (D1 batch semantics). */
  batch(qs: PgQuery[]): Promise<PgResult[]>;
  /** Run a script of statements without parameters. */
  exec(sql: string): Promise<void>;
}

/** Tables whose `id` is an identity column (AUTOINCREMENT in the SQLite schema). */
const IDENTITY_TABLES = new Set(['products', 'orders', 'auth_password_attempts', 'auth_password_resets', 'credit_ledger']);

export interface Translated extends PgQuery {
  /** `RETURNING id` was appended by the adapter: rows are ids, not results the caller asked for. */
  returningId: boolean;
}

function castFor(value: unknown): string {
  if (typeof value === 'boolean' || typeof value === 'bigint') return '::bigint';
  if (typeof value === 'number') return Number.isInteger(value) ? '::bigint' : '::float8';
  return '';
}

function toParam(value: unknown, index: number): unknown {
  if (value === undefined) throw new TypeError(`D1_TYPE_ERROR: Type 'undefined' not supported for value at index ${index}`);
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

const IDENT_START = /[A-Za-z_]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/** SQLite-flavoured SQL + D1 bindings → PostgreSQL text + values. */
export function translate(sql: string, params: unknown[] = []): Translated {
  let out = '';
  let maxIndex = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    // string literal '…' ('' escapes a quote)
    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") { j += 2; continue; }
        if (sql[j] === "'") break;
        j++;
      }
      out += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    // quoted identifier "…"
    if (c === '"') {
      const j = sql.indexOf('"', i + 1);
      const end = j === -1 ? n : j + 1;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    // -- line comment
    if (c === '-' && sql[i + 1] === '-') {
      const j = sql.indexOf('\n', i);
      const end = j === -1 ? n : j;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    // /* block comment */
    if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      const end = j === -1 ? n : j + 2;
      out += sql.slice(i, end);
      i = end;
      continue;
    }
    // ? / ?NNN placeholder
    if (c === '?') {
      let j = i + 1;
      while (j < n && sql[j] >= '0' && sql[j] <= '9') j++;
      const index = j > i + 1 ? Number(sql.slice(i + 1, j)) : maxIndex + 1;
      maxIndex = Math.max(maxIndex, index);
      out += `$${index}${castFor(params[index - 1])}`;
      i = j;
      continue;
    }
    // identifiers: quote camelCase ones so PostgreSQL keeps the case
    if (IDENT_START.test(c) && !(i > 0 && IDENT_PART.test(sql[i - 1]))) {
      let j = i + 1;
      while (j < n && IDENT_PART.test(sql[j])) j++;
      const word = sql.slice(i, j);
      out += /[a-z]/.test(word) && /[A-Z]/.test(word) ? `"${word}"` : word;
      i = j;
      continue;
    }
    out += c;
    i++;
  }

  if (maxIndex > params.length) {
    throw new RangeError(`D1_ERROR: Wrong number of parameter bindings for SQL query (${params.length} given, ${maxIndex} used)`);
  }
  const values = params.slice(0, maxIndex).map(toParam);

  // INSERT OR IGNORE INTO … → INSERT INTO … ON CONFLICT DO NOTHING (same meaning: skip rows that hit a unique key)
  if (/^\s*INSERT\s+OR\s+IGNORE\s+INTO\s/i.test(out)) {
    out = out.replace(/^(\s*INSERT)\s+OR\s+IGNORE(\s+INTO\s)/i, '$1$2').replace(/[\s;]+$/, '');
    const returning = /\sRETURNING\s[\s\S]*$/i.exec(out);
    out = returning
      ? `${out.slice(0, returning.index)} ON CONFLICT DO NOTHING${returning[0]}`
      : `${out} ON CONFLICT DO NOTHING`;
  }

  let returningId = false;
  const insert = /^\s*INSERT\s+INTO\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/i.exec(out);
  if (insert && IDENTITY_TABLES.has(insert[1].toLowerCase()) && !/\bRETURNING\b/i.test(out)) {
    out = `${out.replace(/[\s;]+$/, '')} RETURNING id`;
    returningId = true;
  }
  return { text: out, values, returningId };
}

interface D1Meta {
  duration: number;
  changes: number;
  last_row_id: number;
  rows_read: number;
  rows_written: number;
  changed_db: boolean;
  size_after: number;
}

interface D1Result<T = Row> {
  results: T[];
  success: true;
  meta: D1Meta;
}

function toD1Result(t: Translated, r: PgResult, started: number): D1Result {
  const ids = t.returningId ? r.rows.map(row => Number(row.id)).filter(Number.isFinite) : [];
  const isRead = /^\s*(SELECT|WITH)\b/i.test(t.text) && !/\b(INSERT|UPDATE|DELETE)\b/i.test(t.text);
  return {
    results: t.returningId ? [] : r.rows,
    success: true,
    meta: {
      duration: Date.now() - started,
      changes: isRead ? 0 : r.rowCount,
      last_row_id: ids.length ? Math.max(...ids) : 0,
      rows_read: r.rows.length,
      rows_written: isRead ? 0 : r.rowCount,
      changed_db: !isRead && r.rowCount > 0,
      size_after: 0,
    },
  };
}

// (no constructor parameter properties: tests load this file with Node's type stripping)
export class PgD1PreparedStatement {
  readonly exec: PgExecutor;
  readonly sql: string;
  readonly params: unknown[];

  constructor(exec: PgExecutor, sql: string, params: unknown[] = []) {
    this.exec = exec;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): PgD1PreparedStatement {
    return new PgD1PreparedStatement(this.exec, this.sql, values);
  }

  /** for batch() */
  translated(): Translated {
    return translate(this.sql, this.params);
  }

  async run<T = Row>(): Promise<D1Result<T>> {
    const t = this.translated();
    const started = Date.now();
    return toD1Result(t, await this.exec.query(t), started) as D1Result<T>;
  }

  async all<T = Row>(): Promise<D1Result<T>> {
    return this.run<T>();
  }

  async first<T = Row>(column?: string): Promise<T | null> {
    const { results } = await this.run<Row>();
    const row = results[0];
    if (!row) return null;
    if (column === undefined) return row as T;
    if (!(column in row)) throw new Error(`D1_COLUMN_NOTFOUND: Column not found (${column})`);
    return row[column] as T;
  }

  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]> {
    const { results } = await this.run<Row>();
    const rows = results.map(r => Object.values(r)) as T[];
    if (options?.columnNames) return [Object.keys(results[0] ?? {}) as T, ...rows];
    return rows;
  }
}

export class PgD1Database {
  readonly executor: PgExecutor;

  constructor(executor: PgExecutor) {
    this.executor = executor;
  }

  prepare(sql: string): PgD1PreparedStatement {
    return new PgD1PreparedStatement(this.executor, sql);
  }

  async batch<T = Row>(statements: PgD1PreparedStatement[]): Promise<D1Result<T>[]> {
    const translated = statements.map(s => s.translated());
    const started = Date.now();
    const results = await this.executor.batch(translated);
    return results.map((r, i) => toD1Result(translated[i], r, started)) as D1Result<T>[];
  }

  async exec(sql: string): Promise<{ count: number; duration: number }> {
    const started = Date.now();
    await this.executor.exec(sql);
    return { count: sql.split(';').filter(s => s.trim()).length, duration: Date.now() - started };
  }

  dump(): Promise<ArrayBuffer> {
    throw new Error('dump() is not supported on PostgreSQL — use pg_dump');
  }

  withSession(): this {
    return this;
  }
}

/** The adapter typed as Cloudflare's D1Database, for `env.DB`. */
export function d1OnPostgres(executor: PgExecutor): D1Database {
  return new PgD1Database(executor) as unknown as D1Database;
}
