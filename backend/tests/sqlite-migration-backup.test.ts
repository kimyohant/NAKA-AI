import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import { backupSqlite } from '../src/db/backup.js'

test('migrates an older task table once and restores a consistent WAL snapshot', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-sqlite-test-'))
  const source = path.join(directory, 'source.sqlite3')
  const snapshot = path.join(directory, 'snapshot.sqlite3')
  const restored = path.join(directory, 'restored.sqlite3')
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(source)
    sqlite.pragma('journal_mode = WAL')
    initSqliteSchema(sqlite)
    sqlite.exec('ALTER TABLE sys_task DROP COLUMN config_id')
    sqlite.exec('ALTER TABLE sys_task DROP COLUMN error_code')
    sqlite.exec('DELETE FROM schema_migrations WHERE version = 2')
    initSqliteSchema(sqlite)
    initSqliteSchema(sqlite)
    const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    assert.deepEqual(versions.map(row => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    const columns = sqlite.pragma('table_info(sys_task)') as Array<{ name: string }>
    assert.ok(columns.some(row => row.name === 'config_id'))
    assert.ok(columns.some(row => row.name === 'error_code'))
    assert.ok(columns.some(row => row.name === 'estimated_cost_thb'))
    assert.ok(columns.some(row => row.name === 'source_snapshot'))
    sqlite.exec("INSERT INTO sys_task (type, status, created_at, updated_at, task_id, config_id, error_code) VALUES ('video', 'unknown', 'now', 'now', 'provider-123', 7, '9006')")
    await backupSqlite(source, snapshot)
    await backupSqlite(snapshot, restored)
    const copy = new Database(restored, { readonly: true })
    try {
      const row = copy.prepare('SELECT task_id, config_id, error_code FROM sys_task').get() as { task_id: string; config_id: number; error_code: string }
      assert.deepEqual(row, { task_id: 'provider-123', config_id: 7, error_code: '9006' })
    } finally { copy.close() }
    await assert.rejects(backupSqlite(source, snapshot), /already exists/)
  } finally {
    sqlite?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
