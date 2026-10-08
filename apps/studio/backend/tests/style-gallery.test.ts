import './_memory-db.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rawQuery } from '../src/core/db/index.js'
import {
  loadBuiltinStyles, categoryCode, composeStylePrompt, builtinDisplayName,
  BUILTIN_VALUE_PREFIX, composePreviewPrompt,
} from '../src/core/generation/style-gallery.js'

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

test('style_presets has the style gallery columns in the PostgreSQL schema', async () => {
  const cols = await rawQuery(
    `SELECT column_name AS name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'style_presets'`)
  const byName = new Map(cols.map(c => [String(c.name), c]))
  for (const col of ['preview_path', 'category', 'source']) {
    assert.ok(byName.has(col), `style_presets missing column ${col}`)
  }
  // source TEXT NOT NULL DEFAULT 'custom'
  assert.equal(byName.get('source')!.is_nullable, 'NO')
  assert.match(String(byName.get('source')!.column_default), /^'custom'/)
})
