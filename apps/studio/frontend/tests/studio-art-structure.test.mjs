/**
 * Studio art (public/studio-art) — every Creative Gallery template and every library skill has its
 * preview images, the path builders match the files, and the UI falls back when an image is missing.
 */
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { COVER_KINDS, TEMPLATE_ART_IDS, TEMPLATE_ART_VARIANTS, coverArt, skillArt, templateArt } from '../app/utils/studioArt.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const publicFile = (url) => new URL(`app/public${url}`, root)

const templatesSrc = read('../backend/src/modules/product-studio/services/studio-templates.ts')
const skillsSrc = read('../backend/src/core/agents/skill-library.ts')
const templateIds = [...templatesSrc.matchAll(/^\s+id: '([a-z_]+)', category:/gm)].map(m => m[1])
const skillIds = [...skillsSrc.matchAll(/^\s+skill\('[a-z_]+', '[a-z]+', '([a-z/-]+)', '([a-z0-9-]+)'/gm)].map(m => `${m[1]}/${m[2]}`)

test('every studio template has art for all six product categories', () => {
  assert.equal(templateIds.length, 12)
  assert.deepEqual([...templateIds].sort(), [...TEMPLATE_ART_IDS].sort())
  for (const id of templateIds) {
    const files = templateArt(id)
    assert.equal(files.length, TEMPLATE_ART_VARIANTS.length)
    for (const f of files) assert.ok(existsSync(publicFile(f)), `missing ${f}`)
  }
  assert.deepEqual(templateArt('not_a_template'), [])
})

test('every library skill has a film still and a clay icon', () => {
  assert.equal(skillIds.length, 32)
  for (const id of skillIds) {
    const art = skillArt(id)
    assert.ok(existsSync(publicFile(art.still)), `missing ${art.still}`)
    assert.ok(existsSync(publicFile(art.clay)), `missing ${art.clay}`)
  }
  assert.equal(skillArt('../etc/passwd'), null)
})

test('covers exist for template categories, skill categories and agents', () => {
  const ids = {
    'template-category': [...new Set([...templatesSrc.matchAll(/category: '([a-z_]+)'/g)].map(m => m[1]))],
    'skill-category': ['story', 'continuity', 'cinematography', 'visual', 'quality'],
    agent: ['script_rewriter', 'extractor', 'storyboard_breaker', 'prompt_generator'],
  }
  assert.deepEqual(Object.keys(ids), COVER_KINDS)
  for (const [kind, list] of Object.entries(ids)) {
    for (const id of list) assert.ok(existsSync(publicFile(coverArt(kind, id))), `missing ${kind}/${id}`)
  }
  assert.equal(coverArt('agent', 'a/b'), '')
})

test('cards use the art and fall back to the icon when an image fails', () => {
  const card = read('menus/product-studio/components/StudioTemplateCard.vue')
  assert.match(card, /templateArt\(props\.template\.id\)/)
  assert.match(card, /@error="artFailed = true"/)
  assert.match(card, /<component :is="icon" v-else/)
  assert.match(card, /prefers-reduced-motion/)
  const gallery = read('menus/product-studio/components/StudioTemplateGallery.vue')
  assert.match(gallery, /:art-index=/)
  assert.match(gallery, /coverArt\('template-category'/)
})

test('every seeded visual style has an example image, and the picker falls back to its gradient', async () => {
  const { styleExample } = await import('../app/utils/studioArt.js')
  const schema = read('../backend/src/core/db/sqlite-schema.ts')
  const seeded = [...schema.matchAll(/value: '([a-z0-9-]+)', sortOrder/g)].map(m => m[1])
  assert.ok(seeded.length >= 8)
  for (const v of seeded) assert.ok(existsSync(publicFile(styleExample(v))), `missing style example ${v}`)
  assert.equal(styleExample('a/b'), '')
  const index = read('menus/drama/pages/index.vue')
  assert.match(index, /styleImg\[p\.value\] = 'error'/)
  assert.match(index, /v-if="styleImg\[p\.value\] !== 'ok'" class="style-glyph"/)
  assert.doesNotMatch(index, /overflow-x: auto; scroll-snap-type: x mandatory/)
})
