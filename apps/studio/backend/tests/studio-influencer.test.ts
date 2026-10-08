import './_memory-db.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sqlite } from './_sql.js'
import {
  INFLUENCER_NICHES, INFLUENCER_REVIEW_SCENES,
  composeInfluencerPortraitPrompt, composeInfluencerReviewPrompt,
} from '../src/modules/product-studio/services/studio-influencer.js'

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

test('influencer tables + studio_projects.influencer_id exist in the PostgreSQL schema', async () => {
  assert.ok((await sqlite.columns('studio_projects')).includes('influencer_id'), 'studio_projects missing influencer_id')
  for (const table of ['studio_influencers', 'studio_influencer_contents']) {
    assert.ok((await sqlite.columns(table)).includes('id'), `${table} missing id`)
  }
  const contentCols = await sqlite.columns('studio_influencer_contents')
  for (const col of ['influencer_id', 'kind', 'task_id', 'script', 'status']) {
    assert.ok(contentCols.includes(col), `studio_influencer_contents missing column ${col}`)
  }
})
