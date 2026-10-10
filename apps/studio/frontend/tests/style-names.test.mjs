/**
 * Style names in the UI language (th / en): utils/styleName.js picks index.styleNames for the built-in presets
 * and the drama art styles, Thai names for the 305-style gallery (handrawStyleNamesTh.js), and the stored name
 * for presets an admin added. Every page that lists styles goes through it, and no Chinese text is shown.
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'
import { galleryNumber, styleDisplayName } from '../app/utils/styleName.js'
import { HANDRAW_STYLE_NAMES_TH } from '../app/utils/handrawStyleNamesTh.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const HAN = /[一-鿿]/

/** vue-i18n's t/te over one locale file, enough for styleDisplayName */
function i18nFor(locale) {
  const messages = loadLocale(locale)
  const get = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), messages)
  return { t: (key) => String(get(key)), te: (key) => typeof get(key) === 'string', locale }
}

test('built-in presets and art styles: the UI language, never the stored Chinese name', () => {
  const th = i18nFor('th')
  const en = i18nFor('en')
  assert.equal(styleDisplayName({ value: '3d', name: '3D 漫剧' }, th), '3D แอนิเมชัน')
  assert.equal(styleDisplayName({ value: '3d', name: '3D 漫剧' }, en), '3D Animation')
  assert.equal(styleDisplayName({ value: 'live-thaiperiod', name: 'Thai Period Drama' }, th), 'ละครย้อนยุคไทย')
  assert.equal(styleDisplayName({ value: 'live-thaiperiod', name: 'Thai Period Drama' }, en), 'Thai Period Drama')
})

test('gallery: Thai name in Thai, the gallery English name (without its number) in English', () => {
  const p = { value: 'handraw-fa-001', name: 'FA-001 · Playful Deadpan Doodle' }
  assert.equal(galleryNumber(p.value), 'FA-001')
  assert.equal(styleDisplayName(p, i18nFor('th')), 'ลายเส้นขี้เล่นหน้าตาย')
  assert.equal(styleDisplayName(p, i18nFor('en')), 'Playful Deadpan Doodle')
  assert.equal(galleryNumber('live-cinematic'), null)
})

test('a preset an admin added keeps the name they typed', () => {
  assert.equal(styleDisplayName({ value: 'my-brand', name: 'สไตล์แบรนด์ฉัน' }, i18nFor('en')), 'สไตล์แบรนด์ฉัน')
})

test('every seeded preset and art style has a Thai and an English name; no Chinese in either', () => {
  const seeds = read('../backend/src/core/db/seed.ts')
  const artStyles = read('../backend/src/core/db/style-seeds.ts')
  const values = [
    ...[...seeds.matchAll(/value: '([a-z0-9-]+)', sortOrder/g)].map(m => m[1]),
    ...[...artStyles.matchAll(/(?:live|anim)\(\d+, '([a-z0-9-]+)'/g)].map(m => m[1]),
  ]
  assert.ok(values.length >= 46, `found ${values.length} seeded styles`)
  for (const locale of ['th', 'en']) {
    const names = loadLocale(locale).index.styleNames
    for (const v of values) {
      assert.equal(typeof names[v], 'string', `${locale} index.styleNames.${v}`)
      assert.doesNotMatch(names[v], HAN, `${locale} ${v}`)
    }
  }
})

test('the gallery has a Thai name for each of its 305 styles', () => {
  const gallery = JSON.parse(read('../backend/src/data/handraw-styles.json'))
  assert.equal(gallery.length, 305)
  for (const s of gallery) {
    assert.ok(HANDRAW_STYLE_NAMES_TH[s.number], `Thai name for ${s.number}`)
    assert.doesNotMatch(HANDRAW_STYLE_NAMES_TH[s.number], HAN, s.number)
  }
  assert.equal(Object.keys(HANDRAW_STYLE_NAMES_TH).length, gallery.length)
})

test('every page that lists styles shows them through styleDisplayName; gallery cards hide the Chinese prompt', () => {
  for (const f of ['app/pages/settings.vue', 'menus/drama/pages/index.vue', 'menus/drama/views/detail.vue', 'menus/marketer/components/MarketerBriefForm.vue']) {
    assert.match(read(f), /styleDisplayName\(/, f)
  }
  const settings = read('app/pages/settings.vue')
  assert.match(settings, /<h4 class="sg-name truncate">\{\{ styleName\(p\) \}\}<\/h4>/)
  assert.doesNotMatch(settings, /\{\{ p\.name \}\}/)
  // the builtin gallery card shows its reference artist; only other presets show the raw prompt
  assert.match(settings, /<p v-if="p\.source === 'builtin'" class="sg-prompt">/)
  assert.match(settings, /<p v-else class="sg-prompt mono">\{\{ p\.prompt \}\}<\/p>/)
  for (const locale of ['th', 'en']) assert.match(loadLocale(locale).settings.styles.gallery.reference, /\{name\}/)
})
