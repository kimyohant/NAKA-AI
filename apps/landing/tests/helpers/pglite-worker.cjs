// Holds one in-process PostgreSQL (PGlite) for a test file. tests/helpers/d1.cjs talks to it with
// blocking calls (Atomics.wait), so tests can keep reading the database synchronously.
const { parentPort, workerData } = require("node:worker_threads");
const { readFileSync, writeSync } = require("node:fs");
const path = require("node:path");

const { shared, port } = workerData;
const baseline = readFileSync(path.join(__dirname, "../../migrations/pg/0001_baseline.sql"), "utf8");

let pg;

async function init() {
  const { PGlite } = await import("@electric-sql/pglite");
  // value types as D1/SQLite returns them: bigint / numeric → number, boolean → 1 / 0
  pg = new PGlite({ parsers: { 20: Number, 1700: Number, 16: v => (v === 't' || v === true ? 1 : 0) } });
  // same layout as production: the app's schema first on the search path
  await pg.exec("CREATE SCHEMA account; SET search_path TO account;");
  await pg.exec(baseline);
}

const toResult = r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });

async function handle(msg) {
  if (msg.op === "init") return init();
  if (msg.op === "reset") {
    // a fresh database for the next test — also drops triggers/functions a test created
    await pg.exec("DROP SCHEMA account CASCADE; CREATE SCHEMA account; SET search_path TO account;");
    await pg.exec(baseline);
    return null;
  }
  if (msg.op === "query") return toResult(await pg.query(msg.q.text, msg.q.values));
  if (msg.op === "batch") {
    return pg.transaction(async tx => {
      const out = [];
      for (const q of msg.qs) out.push(toResult(await tx.query(q.text, q.values)));
      return out;
    });
  }
  if (msg.op === "exec") { await pg.exec(msg.sql); return null; }
  throw new Error(`unknown op ${msg.op}`);
}

parentPort.on("message", async msg => {
  let reply;
  try {
    reply = { result: await handle(msg) };
  } catch (err) {
    // PG_DEBUG=1 node --test … prints every failing statement (writeSync: the main thread is blocked, console would deadlock)
    if (process.env.PG_DEBUG) {
      const sql = msg.q?.text ?? msg.qs?.map(q => q.text).join("\n---\n") ?? msg.sql ?? "";
      writeSync(2, `[pglite] ${err.message}\n${sql}\n${JSON.stringify(msg.q?.values ?? "")}\n`);
    }
    reply = { error: { message: err.message, code: err.code, detail: err.detail } };
  }
  port.postMessage(reply);
  Atomics.store(shared, 0, 1);
  Atomics.notify(shared, 0);
});
