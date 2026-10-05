import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import {
  INFLUENCER_NICHES, INFLUENCER_REVIEW_SCENES,
  composeInfluencerPortraitPrompt, composeInfluencerReviewPrompt,
} from '../src/services/studio-influencer.js'

test('influencer constants: 5 review scenes, 10 niches, all unique', () => {
  assert.deepEqual([...INFLUENCER_REVIEW_SCENES], ['unboxing', 'holding', 'using', 'closeup', 'lifestyle'])
  assert.equal(INFLUENCER_NICHES.length, 10)
  assert.equal(new Set(INFLUENCER_NICHES).size, 10)
  assert.equal(new Set(INFLUENCER_REVIEW_SCENES).size, 5)
})

test('portrait prompt: includes appearance, persona and instruction, never empty subject', () => {
  const prompt = composeInfluencerPortraitPrompt(
    { appearance: 'Thai woman, 25, brown bob hair', persona: 'funny, fast talker', niche: 'beauty' },
    'white t-shirt',
  )
  assert.match(prompt, /Thai woman, 25, brown bob hair/)
  assert.match(prompt, /funny, fast talker/)
  assert.match(prompt, /white t-shirt/)
  assert.match(prompt, /No added text, logos or watermarks/)
  // ไม่มี appearance ก็ต้องมี default subject ไม่หลุดโครงสร้าง
  const fallback = composeInfluencerPortraitPrompt({ appearance: '', persona: '', niche: null }, null)
  assert.match(fallback, /social media creator/)
})

test('review prompt: pins presenter identity to first reference and product design to second', () => {
  const prompt = composeInfluencerReviewPrompt('unboxing', 'Cushion SPF50', 'bright bedroom')
  assert.match(prompt, /unboxing|Unboxing/)
  assert.match(prompt, /presenter reference image \(the first reference image\)/)
  assert.match(prompt, /product reference image \(the second reference image\)/)
  assert.match(prompt, /Cushion SPF50/)
  assert.match(prompt, /bright bedroom/)
  // ครอบ whitespace ของชื่อสินค้า
  const collapsed = composeInfluencerReviewPrompt('holding', '   Lip   tint\nnumber one  ', null)
  assert.match(collapsed, /Lip tint number one/)
})

test('migration v14 adds influencer tables + influencer_id and stays idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-influencer-test-'))
  const dbFile = path.join(directory, 'test.sqlite3')
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(dbFile)
    sqlite.pragma('journal_mode = WAL')
    initSqliteSchema(sqlite)
    initSqliteSchema(sqlite) // replay — idempotent
    const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    assert.deepEqual(versions.map(row => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])
    const projectCols = (sqlite.pragma('table_info(studio_projects)') as Array<{ name: string }>).map(r => r.name)
    assert.ok(projectCols.includes('influencer_id'), 'studio_projects missing influencer_id')
    for (const table of ['studio_influencers', 'studio_influencer_contents']) {
      const cols = (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(r => r.name)
      assert.ok(cols.includes('id'), `${table} missing id`)
    }
    const contentCols = (sqlite.pragma('table_info(studio_influencer_contents)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['influencer_id', 'kind', 'task_id', 'script', 'status']) {
      assert.ok(contentCols.includes(col), `studio_influencer_contents missing column ${col}`)
    }
  } finally {
    sqlite?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
