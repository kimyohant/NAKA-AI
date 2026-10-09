/**
 * scripts/import-sqlite.mjs (docs/adr/0004 step 9): the old SQLite → PostgreSQL copy, on PGlite with the real
 * migrations and startup seeds. The old file is a small old-format SQLite made with node:sqlite.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'

process.env.DATABASE_URL = 'pglite://memory'
const { rawQuery, rawExec } = await import('../src/core/db/index.js')
const { importSqlite, openSqlite } = await import('../scripts/import-sqlite.mjs')

const dir = mkdtempSync(path.join(tmpdir(), 'naka-import-'))
test.after(() => { try { rmSync(dir, { recursive: true, force: true }) } catch { /* Windows keeps the file open */ } })
const t = '2026-10-01T10:00:00.000Z'
const query = (text: string, params: any[] = []) => rawQuery(text, params)
const count = async (table: string) => Number((await rawQuery(`SELECT COUNT(*) AS n FROM ${table}`))[0].n)

function oldDb(name: string, build: (db: DatabaseSync) => void): string {
  const file = path.join(dir, name)
  const db = new DatabaseSync(file)
  db.exec(`
    CREATE TABLE style_presets (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, value TEXT NOT NULL UNIQUE, prompt TEXT NOT NULL,
      description TEXT, sort_order INTEGER DEFAULT 0, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, old_flag TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', email TEXT, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE dramas (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, style TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE sys_task (id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT, status TEXT DEFAULT 'processing', error_msg TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE legacy_notes (id INTEGER PRIMARY KEY, body TEXT);
  `)
  build(db)
  db.close()
  return file
}

const file = oldDb('old.sqlite3', (db) => {
  const style = db.prepare(`INSERT INTO style_presets (name, value, prompt, sort_order, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
  for (let i = 1; i <= 24; i++) style.run(`style ${i}`, `handraw-${i}`, `prompt ${i}`, i, i % 6 ? 1 : 0, t, t)
  style.run('3D', '3d', 'my edited 3d prompt', 0, 1, t, t)
  db.prepare(`INSERT INTO users (id, display_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('u-old', 'Old', 1, t, t)
  db.prepare(`INSERT INTO users (id, display_name, is_admin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run('u-both', 'Old name', 0, t, t)
  db.prepare(`INSERT INTO dramas (id, title, style, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(41, 'ละครเก่า', 'handraw-3', t, t)
  db.prepare(`INSERT INTO sys_task (type, status, created_at, updated_at) VALUES ('video', 'processing', ?, ?)`).run(t, t)
  db.prepare(`INSERT INTO sys_task (type, status, created_at, updated_at) VALUES ('image', 'completed', ?, ?)`).run(t, t)
  db.prepare(`INSERT INTO legacy_notes (body) VALUES ('x')`).run()
})

test('dry run reports the plan and writes nothing', async () => {
  const lines: string[] = []
  const sqlite = await openSqlite(file)
  await importSqlite({ sqlite, query, apply: false, log: (l: string) => lines.push(l) })
  sqlite.close()
  assert.equal(await count('dramas'), 0)
  assert.equal(await count('style_presets'), 8) // the startup seeds only
  const out = lines.join('\n')
  assert.match(out, /style_presets\s+25 rows \(replaces the 8 seed rows\)\s+· old columns not copied: old_flag/)
  assert.match(out, /not copied\): legacy_notes/)
  assert.doesNotMatch(out, /schema_migrations/)
  assert.match(out, /dry run: nothing written/)
})

test('apply copies with ids, booleans and sequences; seeds replaced; existing accounts win; running jobs stopped', async () => {
  await rawExec(`INSERT INTO users (id, display_name, is_admin, created_at, updated_at) VALUES ('u-both', 'New name', true, '2026-10-08', '2026-10-08')`)
  const sqlite = await openSqlite(file)
  await importSqlite({ sqlite, query, apply: true, log: () => {} })
  sqlite.close()

  assert.equal(await count('style_presets'), 25)
  const [styles] = await rawQuery(`SELECT SUM(CASE WHEN is_active THEN 1 ELSE 0 END) AS active FROM style_presets`)
  assert.equal(Number(styles.active), 21)
  assert.equal((await rawQuery(`SELECT prompt FROM style_presets WHERE value = '3d'`))[0].prompt, 'my edited 3d prompt')

  const users = await rawQuery(`SELECT id, display_name, is_admin FROM users ORDER BY id`)
  assert.deepEqual(users.map(u => [u.id, u.display_name, u.is_admin]), [['u-both', 'New name', true], ['u-old', 'Old', true]])

  assert.deepEqual((await rawQuery(`SELECT id, title, style FROM dramas`)).map(d => [Number(d.id), d.title, d.style]), [[41, 'ละครเก่า', 'handraw-3']])
  const [next] = await rawQuery(`INSERT INTO dramas (title, created_at, updated_at) VALUES ('new', 'x', 'x') RETURNING id`)
  assert.equal(Number(next.id), 42) // the identity sequence moved past the copied ids

  const tasks = await rawQuery(`SELECT status, error_msg FROM sys_task ORDER BY id`)
  assert.equal(tasks[0].status, 'failed')
  assert.match(tasks[0].error_msg, /^E_TASK_INTERRUPTED/)
  assert.equal(tasks[1].status, 'completed')
})

test('a table that already has rows in PostgreSQL stops the import before anything is written', async () => {
  // dramas now has rows (the previous test), so a second import must refuse
  const before = await count('style_presets')
  const sqlite = await openSqlite(file)
  const lines: string[] = []
  await assert.rejects(() => importSqlite({ sqlite, query, apply: true, log: (l: string) => lines.push(l) }), /import stopped/)
  sqlite.close()
  assert.match(lines.join('\n'), /STOP dramas: PostgreSQL already has 2 rows/)
  assert.equal(await count('style_presets'), before)
})
