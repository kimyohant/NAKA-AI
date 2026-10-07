import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import {
  loadBuiltinStyles, categoryCode, composeStylePrompt, builtinDisplayName,
  BUILTIN_VALUE_PREFIX, composePreviewPrompt,
} from '../src/services/style-gallery.js'

test('handraw style catalog: 305 items, unique numbers, 8 groups, fields present', () => {
  const styles = loadBuiltinStyles()
  assert.equal(styles.length, 305)
  const numbers = styles.map(s => s.number)
  assert.equal(new Set(numbers).size, 305)
  const groups = new Set(styles.map(s => categoryCode(s.group)))
  assert.deepEqual([...groups].sort(), ['FA', 'FB', 'FC', 'FD', 'FE', 'FF', 'FG', 'FH'])
  for (const s of styles) {
    assert.ok(s.number, 'missing number')
    assert.ok(s.generation_name?.trim(), `${s.number} missing generation_name`)
    assert.ok(s.group, `${s.number} missing group`)
  }
})

test('categoryCode extracts the letter code from the group heading', () => {
  assert.equal(categoryCode('FA 国际社论幽默 / Editorial & Humor Doodle'), 'FA')
  assert.equal(categoryCode('FH 先锋实验与综合媒介 / Mixed Media & Impasto Arts'), 'FH')
})

test('composeStylePrompt: no style numbers leak into the prompt (upstream rule)', () => {
  const withTraits = composeStylePrompt('Playful Deadpan Doodle', '松散黑线、怪萌人物、白底')
  assert.match(withTraits, /^Playful Deadpan Doodle hand-drawn illustration style\. Core style traits: 松散黑线、怪萌人物、白底$/)
  const withoutTraits = composeStylePrompt('Tite Kubo Bleach Manga Style', '')
  assert.equal(withoutTraits, 'Tite Kubo Bleach Manga Style hand-drawn illustration style')
  // กติกา upstream: ห้ามมีเลขกำกับใน prompt — โมเดลจะวาดเลขลงในภาพ
  for (const prompt of [withTraits, withoutTraits, composePreviewPrompt(withTraits)]) {
    assert.doesNotMatch(prompt, /\b[A-Z]{2}-\d{3}\b/, 'style number leaked into prompt')
    assert.doesNotMatch(prompt, /\b\d{3}\b/, 'numeric style id leaked into prompt')
  }
  assert.throws(() => composeStylePrompt('  ', 'x'))
})

test('builtin display name keeps the number for humans (name only — never the prompt)', () => {
  const styles = loadBuiltinStyles()
  const name = builtinDisplayName(styles[0])
  assert.match(name, /^(FA|FB|FC|FD|FE|FF|FG|FH)-\d{3} · /)
  assert.equal(BUILTIN_VALUE_PREFIX, 'handraw-')
})

test('migration v13 adds style gallery columns and stays idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-stylegal-test-'))
  const dbFile = path.join(directory, 'test.sqlite3')
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(dbFile)
    sqlite.pragma('journal_mode = WAL')
    initSqliteSchema(sqlite)
    initSqliteSchema(sqlite) // replay — idempotent
    const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    assert.deepEqual(versions.map(row => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
    const cols = (sqlite.pragma('table_info(style_presets)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['preview_path', 'category', 'source']) {
      assert.ok(cols.includes(col), `style_presets missing column ${col}`)
    }
    // fresh-install DDL เองก็ต้องมีคอลัมน์ใหม่ (ตารางสร้างครั้งแรก)
    const createSql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = 'style_presets'").get() as { sql: string }
    assert.match(createSql.sql, /preview_path TEXT/)
    assert.match(createSql.sql, /source TEXT NOT NULL DEFAULT 'custom'/)
  } finally {
    sqlite?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
