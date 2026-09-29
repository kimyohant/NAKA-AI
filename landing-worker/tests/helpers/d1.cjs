const { readFileSync } = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

/** Minimal D1Database over node:sqlite: prepare/bind/first/all/run and a transactional batch. */
function d1(sqlite) {
  const statement = (sql, params = []) => ({
    bind: (...next) => statement(sql, next),
    first: async () => sqlite.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: sqlite.prepare(sql).all(...params) }),
    run: async () => {
      const r = sqlite.prepare(sql).run(...params);
      return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const s of statements) results.push(await s.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/** A fresh in-memory database with the given migrations applied. */
function migratedDb(...migrations) {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of migrations) sqlite.exec(readFileSync(path.join(__dirname, "../../migrations", file), "utf8"));
  return { sqlite, db: d1(sqlite) };
}

module.exports = { d1, migratedDb };
