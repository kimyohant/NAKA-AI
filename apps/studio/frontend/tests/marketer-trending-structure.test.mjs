/**
 * Marketer Trending Videos (Thailand) — structure & contract tests (docs/ai-marketer/TRENDING.md)
 *
 * ตรวจว่า: section ถูกแทรกในหน้า marketer, เรียก API ผ่าน trendingAPI/marketerAPI เท่านั้น,
 * flow โคลนสร้าง AdReference ผ่าน endpoint เดิม, i18n ครบสมมาตร, ไม่มี URL แพลตฟอร์ม/scraper
 */
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const section = read('menus/marketer/components/MarketerTrendingSection.vue')
const card = read('menus/marketer/components/MarketerTrendingCard.vue')
const listPage = read('menus/marketer/pages/marketer.vue')
const useApi = read('app/composables/useApi.ts')
const th = loadLocale('th')
const en = loadLocale('en')
const backendTrending = new URL('../backend/src/modules/marketer/routes/trending.ts', root)

test('trending section is wired into the marketer list page', () => {
  assert.match(listPage, /<MarketerTrendingSection/)
  assert.match(section, /MarketerTrendingCard/)
  assert.match(card, /emit\('replicate'/)
})

test('trending client matches the backend route (GET /trending-videos only)', { skip: !existsSync(backendTrending) && 'backend not present' }, () => {
  const routes = read(backendTrending)
  assert.match(routes, /app\.get\('\/'/)
  // client: เฉพาะ GET เดียว — ไม่มี endpoint อื่นถูกยิง
  const calls = [...useApi.matchAll(/api\.(get|post|put|del)(?:<[^>]*>)?\(\s*[`'](\/trending-videos[^`']*)[`']/g)]
  assert.ok(calls.length >= 1, 'trendingAPI.list missing')
  assert.ok(calls.every(m => m[1] === 'get'), 'trending client must be read-only')
  assert.doesNotMatch(useApi, /\/trending-videos[^`']*['`]?\s*,\s*\{/)

  // service ฝั่ง backend เป็น static seed — ห้ามมี scraper
  const service = read('../backend/src/modules/marketer/services/trending.ts')
  assert.doesNotMatch(service, /fetch\(|axios|playwright|puppeteer/)
})

test('replicate flow creates an AdReference via the existing contract (no new endpoint)', () => {
  assert.match(section, /marketerAPI\.addReference\(/)
  assert.match(section, /transcript:\s*patternBrief\(entry\)/)
  // pattern brief ต้องระบุชัดว่าเป็น pattern ไม่ใช่ถ้อยคำต้นฉบับ (กฎทรัพย์สิน/ToS — TRENDING.md §5)
  assert.match(section, /ไม่ใช่ถ้อยคำต้นฉบับ/)
  // สร้างแคมเปญใหม่ได้: market ล็อก TH + platform ตามเทรนด์
  assert.match(section, /market:\s*'TH'/)
  assert.match(section, /platforms:\s*\[entry\.platform\]/)
  // จบ flow ด้วยการพาไปหน้าแคมเปญ
  assert.match(section, /navigateTo\(`\/marketer\/\$\{campaignId\}`\)/)
})

test('no platform URLs, no bypassing useApi, no mock data', () => {
  for (const [name, src] of [['MarketerTrendingSection', section], ['MarketerTrendingCard', card]]) {
    assert.doesNotMatch(src, /\$fetch\(|\bfetch\(/, `${name} bypasses useApi`)
    assert.doesNotMatch(src, /tiktok\.com|douyin\.com|instagram\.com|youtube\.com/, `${name} hardcodes a platform URL`)
    assert.doesNotMatch(src, /\bmock\w*\s*[:=]/i, `${name} contains mock data`)
  }
})

test('marketer.trending.* i18n keys exist in both locales and cover every t() call', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) => {
    const key = p ? `${p}.${k}` : k
    return typeof v === 'object' && v !== null ? leaves(v, key) : [key]
  })
  const thKeys = new Set(leaves(th, ''))
  const enKeys = new Set(leaves(en, ''))
  const trending = (k) => k.startsWith('marketer.trending.')
  const thTrending = [...thKeys].filter(trending)
  const enTrending = [...enKeys].filter(trending)
  assert.ok(thTrending.length >= 40, `expected the full trending namespace, got ${thTrending.length}`)
  assert.deepEqual(thTrending.filter(k => !enKeys.has(k)), [], 'keys missing in en.json')
  assert.deepEqual(enTrending.filter(k => !thKeys.has(k)), [], 'keys missing in th.json')

  // ทุก static key ที่ t() เรียกต้องมีจริง (ทั้งหมด ไม่ใช่แค่ trending)
  for (const [name, src] of [['MarketerTrendingSection', section], ['MarketerTrendingCard', card]]) {
    for (const m of src.matchAll(/\bt\('([\w.]+)'/g)) {
      assert.ok(thKeys.has(m[1]), `th.json missing ${m[1]} (used by ${name})`)
      assert.ok(enKeys.has(m[1]), `en.json missing ${m[1]} (used by ${name})`)
    }
  }
  // dynamic keys ที่ใช้บ่อยต้องมีจริง
  for (const key of ['marketer.trending.card.replicate', 'marketer.trending.dialog.created']) {
    assert.ok(thKeys.has(key) && enKeys.has(key), `missing dynamic-contract key ${key}`)
  }
})
