/**
 * AI Marketer quick start (TopView "Popular Ways to Get Started" ฉบับ NAKA-AI — ย้ายจาก naka-ai studio 05)
 * ตรวจว่า: section อยู่ในหน้า marketer ก่อนคลิปมาแรง, เรียก API ผ่าน marketerQuickAPI/marketerAPI เท่านั้น,
 * การ์ด 02–04 สร้างแคมเปญแล้วสั่ง autopilot, ไม่มี scraper/ดาวน์โหลดคลิป, i18n th/en สมมาตรครบทุก key ที่ใช้
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const page = read('menus/marketer/pages/marketer.vue')
const quick = read('menus/marketer/components/MarketerQuickStart.vue')
const dialog = read('menus/marketer/components/MarketerQuickCampaignDialog.vue')
const api = read('app/composables/useApi.ts')
const th = loadLocale('th')
const en = loadLocale('en')

const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === 'object' ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`])

test('quick start sits on the marketer page above the trending section', () => {
  const quickAt = page.indexOf('<MarketerQuickStart />')
  assert.ok(quickAt > 0, 'MarketerQuickStart missing')
  assert.ok(quickAt < page.indexOf('<MarketerTrendingSection />'), 'quick start must come before trending')
})

test('API client: catalog/insights endpoints and campaign autopilot', () => {
  for (const pattern of [/'\/marketer\/catalog'/, /'\/marketer\/insights'/, /`\/marketer\/insights\/\$\{id\}`/, /`\/campaigns\/\$\{id\}\/autopilot`/]) {
    assert.match(api, pattern)
  }
  assert.doesNotMatch(quick + dialog, /fetch\(/, 'components call the API only through useApi')
})

test('four starters: insight dialog + campaign dialog modes that create a campaign then start autopilot', () => {
  for (const key of ['insight', 'url', 'recreate', 'bulk']) assert.match(quick, new RegExp(`key: '${key}'`))
  assert.match(quick, /marketerQuickAPI\.createInsight/)
  assert.match(quick, /<MarketerQuickCampaignDialog/)
  assert.match(dialog, /marketerAPI\.create\(/)
  assert.match(dialog, /marketerAPI\.addReference\(/) // recreate → AdReference (existing analyze flow)
  assert.match(dialog, /marketerAPI\.autopilot\(campaign\.id/)
  assert.match(dialog, /marketerAPI\.ingestUrl\(/) // URL → video reuses the existing ingest
  assert.match(dialog, /navigateTo\(`\/marketer\/\$\{campaign\.id\}`\)/)
})

test('no platform scraping or clip download; markdown goes through the escaping renderer', () => {
  assert.doesNotMatch(quick + dialog, /yt-dlp|tiktok\.com\/api|download\(/i)
  assert.match(quick, /renderMarkdown\(/)
  assert.match(quick, /v-html="renderMarkdown/)
})

test('every marketer.quick key used exists in both locales, and th/en have the same keys', () => {
  const thKeys = flatten(th.marketer.quick).sort()
  const enKeys = flatten(en.marketer.quick).sort()
  assert.deepEqual(thKeys, enKeys)
  const used = new Set([...(quick + dialog).matchAll(/t\('marketer\.quick\.([\w.]+)'/g)].map(m => m[1]))
  for (const key of used) assert.ok(thKeys.includes(key), `missing marketer.quick.${key}`)
  for (const id of ['category_opportunity', 'trending_products', 'competitor_scan', 'pricing_strategy', 'title_optimization', 'review_insights',
    'ugc_brief', 'video_script', 'viral_analysis', 'campaign_calendar', 'roas_analysis', 'search_terms']) {
    assert.ok(th.marketer.quick.templates[id] && en.marketer.quick.templates[id], id)
  }
  for (const way of ['insight', 'url', 'recreate', 'bulk']) assert.ok(th.marketer.quick.ways[way].title, way)
  // vue-i18n: "|" splits plurals and "@" links messages — neither may appear by accident
  const values = (obj) => Object.values(obj).flatMap(v => (v && typeof v === 'object' ? values(v) : [v]))
  for (const value of [...values(th.marketer.quick), ...values(en.marketer.quick)]) assert.doesNotMatch(String(value), /[|@]/, value)
})
