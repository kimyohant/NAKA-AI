/**
 * Ad-style photos of the AI Seller, AI Marketer, AI Live and Skill library menus (public/studio-art/menus, menuArt()):
 * every id has its file, the four pages use them, and the marketer starter cards dropped their isometric clips.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MENU_ART_IDS, menuArt } from '../app/utils/studioArt.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const pub = (p) => fileURLToPath(new URL(`app/public${p}`, root))

test('every menu photo exists, small enough for the web; unknown ids give no path', () => {
  for (const id of MENU_ART_IDS) {
    const file = pub(menuArt(id))
    assert.ok(existsSync(file), `missing ${menuArt(id)}`)
    assert.ok(statSync(file).size < 250_000, `${id} is ${statSync(file).size} bytes`)
  }
  assert.equal(menuArt('../../etc/passwd'), '')
  assert.equal(menuArt('hero-unknown'), '')
})

test('the four menus show their banner photo; the skill library workflow cards use their own photos', () => {
  assert.match(read('menus/seller/pages/seller.vue'), /<MenuHeroArt :src="menuArt\('hero-seller'\)" \/>/)
  assert.match(read('menus/marketer/components/MarketerQuickStart.vue'), /<MenuHeroArt :src="menuArt\('hero-marketer'\)" fade="center" \/>/)
  const live = read('menus/live/pages/live.vue')
  assert.match(live, /<MenuHeroArt :src="menuArt\('hero-live'\)" \/>/)
  assert.match(live, /menuArt\('live-preview'\)/)
  const library = read('menus/product-studio/components/StudioSkillsLibrary.vue')
  assert.match(library, /<MenuHeroArt :src="menuArt\('hero-skills'\)" \/>/)
  for (const id of ['wf-seller', 'wf-drama', 'wf-marketer', 'wf-viral-clone', 'wf-live', 'wf-avatar', 'wf-influencer']) {
    assert.ok(library.includes(`art: menuArt('${id}')`), id)
  }
  assert.doesNotMatch(library, /coverArt\(/, 'no borrowed category covers on the workflow cards')
})

test('marketer starter cards: photos, and no hover clips left in the media list', () => {
  const media = read('menus/marketer/utils/marketerMedia.js')
  const videos = media.match(/const VIDEOS = new Set\((\[[\s\S]*?\])\)/)[1]
  for (const key of ['insight', 'url', 'recreate', 'bulk']) {
    assert.ok(existsSync(pub(`/marketer-media/way/${key}.webp`)), key)
    assert.doesNotMatch(videos, new RegExp(`"way-${key}"`), `way-${key} clip`)
    assert.ok(!existsSync(pub(`/marketer-media/way/${key}.mp4`)), `${key}.mp4 removed`)
  }
})
