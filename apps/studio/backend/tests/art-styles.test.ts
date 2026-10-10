/**
 * Drama studio art styles like Topview Drama Studio (core/db/style-seeds.ts): Live Action / Animation catalog seeded
 * at startup, and the Custom style (dramas.style = 'custom', text in metadata.customStyle) used as the style prompt.
 * The 305-style hand-drawn library (imported from Settings) has its own tab and a cover image per style.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { test } from 'node:test'

process.env.DATABASE_URL = 'pglite://memory'
const { db, schema, rawQuery } = await import('../src/core/db/index.js')
const { stylePresetSeeds, seedStylePresets } = await import('../src/core/db/seed.js')
const { artStyleSeeds } = await import('../src/core/db/style-seeds.js')
const { getDramaStylePrompt, customStyleOf, CUSTOM_STYLE_MAX } = await import('../src/core/generation/style-preset.js')
const { eq } = await import('drizzle-orm')
const { loadBuiltinStyles, BUILTIN_VALUE_PREFIX } = await import('../src/core/generation/style-gallery.js')

const TOPVIEW_LIVE = ['Theatrical Cinematic', 'Modern Micro-drama', 'French Arthouse', 'Monumental Epic', 'Bollywood', 'Nordic Noir',
  'Golden Western', 'Pop Dystopia', 'Prestige HBO Drama', 'Gritty Desert Crime', 'Wes Anderson Style', 'David Lynch Style',
  'Quentin Tarantino Style', 'Christopher Nolan Style', 'Blade Runner Style', 'Modern K-Drama', 'Crime Drama', 'Game of Thrones Style', 'European Epic']
const exampleImage = (value: string) => new URL(`../../frontend/app/public/studio-art/styles/${value}.webp`, import.meta.url)

test('catalog: Topview\'s 19 live-action cards plus Thai stories, 15 more animation styles, unique values', () => {
  const values = [...stylePresetSeeds, ...artStyleSeeds].map(s => s.value)
  assert.equal(new Set(values).size, values.length, 'style values are unique')
  assert.ok(!values.includes('custom'), '"custom" is the typed-in style, never a preset')
  const live = artStyleSeeds.filter(s => s.category === 'live_action')
  for (const name of TOPVIEW_LIVE) assert.ok(live.some(s => s.name === name), name)
  assert.equal(live.length, 23)
  assert.equal(artStyleSeeds.filter(s => s.category === 'animation').length, 15)
  for (const s of artStyleSeeds) assert.match(s.value, /^[a-z0-9-]+$/)
})

test('prompts describe the look instead of naming people or studios, and keep the cast fictional', () => {
  for (const s of artStyleSeeds) {
    assert.doesNotMatch(s.prompt, /nolan|anderson|lynch|tarantino|pixar|ghibli|hbo|bollywood film by|junji|spider-man|game of thrones|blade runner|dune/i, s.value)
    assert.match(s.prompt, /fictional/, s.value)
    if (s.category === 'live_action') {
      assert.match(s.prompt, /^live-action film still, /, s.value)
      assert.match(s.prompt, /no celebrity likeness/, s.value)
    }
  }
})

test('every catalog style has its example image (the earlier catalog’s 14 reused, the other 24 generated with Qwen-Image)', () => {
  for (const s of artStyleSeeds) {
    assert.ok(existsSync(exampleImage(s.value)), `${s.value} has no public/studio-art/styles/${s.value}.webp`)
  }
})

test('every style of the 305 hand-drawn library has its cover (one scene per group, generated with Qwen-Image)', () => {
  const missing = loadBuiltinStyles().map(s => BUILTIN_VALUE_PREFIX + s.number.toLowerCase()).filter(v => !existsSync(exampleImage(v)))
  assert.deepEqual(missing, [], `no public/studio-art/styles/<value>.webp for ${missing.length} library styles`)
})

test('startup seeds every style with its category; built-in rows move to Animation; an edited preset is left alone', async () => {
  const rows = await rawQuery('SELECT value, category FROM style_presets')
  assert.equal(rows.length, stylePresetSeeds.length + artStyleSeeds.length)
  const cat = Object.fromEntries(rows.map(r => [r.value, r.category]))
  assert.equal(cat['3d'], 'animation')
  assert.equal(cat['live-mind-bending'], 'live_action')
  assert.equal(cat['anim-pixar-3d'], 'animation')

  // a database seeded before categories existed: built-in rows had none
  await db.update(schema.stylePresets).set({ category: null }).where(eq(schema.stylePresets.value, 'anime'))
  // someone edited a catalog preset
  await db.update(schema.stylePresets).set({ prompt: 'my own nolan-ish prompt' }).where(eq(schema.stylePresets.value, 'live-mind-bending'))
  await seedStylePresets(db as any)
  const [anime] = await rawQuery(`SELECT category FROM style_presets WHERE value = 'anime'`)
  assert.equal(anime.category, 'animation')
  const [edited] = await rawQuery(`SELECT prompt FROM style_presets WHERE value = 'live-mind-bending'`)
  assert.equal(edited.prompt, 'my own nolan-ish prompt')
  assert.equal((await rawQuery('SELECT COUNT(*) AS n FROM style_presets'))[0].n * 1, stylePresetSeeds.length + artStyleSeeds.length)
})

test('Custom style: the drama\'s own description is its style prompt (trimmed, capped); presets work as before', async () => {
  const t = new Date().toISOString()
  const add = async (style: string, metadata: unknown) => {
    const [row] = await db.insert(schema.dramas).values({ title: 'x', style, metadata: metadata === undefined ? null : JSON.stringify(metadata), createdAt: t, updatedAt: t })
      .returning({ id: schema.dramas.id })
    return row.id
  }
  const custom = await add('custom', { customStyle: '  warm cyberpunk, East Asian neon  ', genres: ['ดราม่า'] })
  assert.equal(await getDramaStylePrompt(custom), 'warm cyberpunk, East Asian neon')
  assert.equal(await getDramaStylePrompt(await add('custom', {})), '')
  assert.equal((await getDramaStylePrompt(await add('custom', { customStyle: 'x'.repeat(900) }))).length, CUSTOM_STYLE_MAX)
  assert.match(await getDramaStylePrompt(await add('live-kdrama', undefined)), /^live-action film still, modern Korean romance-drama look/)
  assert.equal(customStyleOf('not json'), '')
  assert.equal(customStyleOf({ customStyle: 5 }), '')
})
