// Test database: PostgreSQL (PGlite, in-process — no Docker) with the production schema
// (every migrations/pg/*.sql, in order), reached through the same D1 adapter the app uses (src/db/pg-d1.ts).
//
//   const { sqlite, db } = migratedDb();
//   db      → D1Database (async), what the app code gets as env.DB
//   sqlite  → synchronous helper for test setup/assertions: prepare(sql).get/all/run(...params), exec(sql)
//
// PGlite runs in a worker thread; the main thread blocks on each call (Atomics.wait), which is what lets
// `sqlite` stay synchronous. One database per test file, emptied and re-seeded by every migratedDb().
const { execFileSync } = require("node:child_process");
const { rmSync } = require("node:fs");
const path = require("node:path");
const { MessageChannel, Worker, receiveMessageOnPort } = require("node:worker_threads");

const root = path.resolve(__dirname, "../..");

// The adapter is TypeScript; compile just that file once per test process.
const adapterDir = path.join(root, ".wrangler", `pg-d1-helper-${process.pid}`);
execFileSync(process.execPath, [
  path.join(root, "node_modules/typescript/bin/tsc"), path.join(root, "src/db/pg-d1.ts"), "--ignoreConfig",
  "--outDir", adapterDir, "--module", "node16", "--moduleResolution", "node16", "--target", "es2022",
  "--types", "@cloudflare/workers-types", "--skipLibCheck",
], { cwd: root, stdio: "inherit" });
const { translate, d1OnPostgres } = require(path.join(adapterDir, "pg-d1.js"));
process.on("exit", () => rmSync(adapterDir, { recursive: true, force: true }));

let worker;
let port;
let shared;

function call(msg) {
  if (!worker) {
    shared = new Int32Array(new SharedArrayBuffer(4));
    const channel = new MessageChannel();
    port = channel.port1;
    worker = new Worker(path.join(__dirname, "pglite-worker.cjs"), {
      workerData: { shared, port: channel.port2 },
      transferList: [channel.port2],
    });
    worker.unref();
    port.unref();
    callNow({ op: "init" });
  }
  return callNow(msg);
}

function callNow(msg) {
  Atomics.store(shared, 0, 0);
  worker.postMessage(msg);
  // a crashed worker would never answer: fail loudly instead of hanging the test run
  if (Atomics.wait(shared, 0, 0, 60_000) === "timed-out") throw new Error(`PGlite worker did not answer ${msg.op} within 60 s`);
  const reply = receiveMessageOnPort(port).message;
  if (reply.error) {
    const err = new Error(reply.error.message);
    err.code = reply.error.code;
    err.detail = reply.error.detail;
    throw err;
  }
  return reply.result;
}

/** What the D1 adapter needs, backed by the worker. */
const executor = {
  async query(q) { return call({ op: "query", q }); },
  async batch(qs) { return call({ op: "batch", qs }); },
  async exec(sql) { call({ op: "exec", sql }); },
};

/** node:sqlite-style synchronous access for tests (same SQL dialect as the app: SQLite-flavoured, translated). */
const sqlite = {
  prepare(sql) {
    const run = params => call({ op: "query", q: translate(sql, params) });
    return {
      get: (...params) => run(params).rows[0],
      all: (...params) => run(params).rows,
      run: (...params) => {
        const t = translate(sql, params);
        const r = call({ op: "query", q: t });
        const ids = t.returningId ? r.rows.map(row => Number(row.id)) : [];
        return { changes: r.rowCount, lastInsertRowid: ids.length ? Math.max(...ids) : 0 };
      },
    };
  },
  /** no-op: the database lives for the whole test file and migratedDb() empties it */
  close() {},
  /** A trigger that aborts the statement with `message` (tests that check rollbacks). `when` is a
   * PostgreSQL condition on NEW/OLD, e.g. "NEW.payment_id = 'bad'". */
  failTrigger(name, table, event, message, when = "") {
    call({ op: "exec", sql: `CREATE FUNCTION ${name}_fn() RETURNS trigger LANGUAGE plpgsql AS $fn$
      BEGIN RAISE EXCEPTION '${message.replace(/'/g, "''")}'; END $fn$;
      CREATE TRIGGER ${name} BEFORE ${event} ON ${table} FOR EACH ROW ${when ? `WHEN (${when})` : ""} EXECUTE FUNCTION ${name}_fn();` });
  },
  exec(sql) {
    // PRAGMAs were SQLite settings; PostgreSQL always enforces foreign keys
    const script = sql.replace(/^\s*PRAGMA[^;]*;?/gim, "");
    if (script.trim()) call({ op: "exec", sql: script });
  },
};

/**
 * A fresh database with the full production schema and seed rows. The arguments (old SQLite
 * migration file names) are accepted for compatibility and ignored: the baseline has every table.
 */
function migratedDb() {
  call({ op: "reset" });
  // a new D1 object per test, like before: module-level caches keyed by env.DB start empty
  return { sqlite, db: d1OnPostgres(executor) };
}

module.exports = { migratedDb, sqlite, translate };
