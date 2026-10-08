/**
 * Creative Gallery & Ad Analytics — structure tests (docs/ai-marketer/GALLERY.md)
 * ตรวจ route, client contract, ปุ่มเข้าคลัง, i18n parity, กฎ manual analytics
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const view = read('menus/marketer/views/gallery.vue')
const listPage = read('menus/marketer/pages/marketer.vue')
const nuxtConfig = read('nuxt.config.ts') + read('menus/index.ts') + read('menus/marketer/routes.ts')
const useApi = read('app/composables/useApi.ts')
const th = loadLocale('th')
const en = loadLocale('en')
const backendRoute = new URL('../backend/src/modules/marketer/routes/gallery.ts', root)

test('gallery route registered before /marketer/:id + reachable from the marketer page', () => {
  const galleryIdx = nuxtConfig.indexOf("name: 'marketer-gallery'")
  const campaignIdx = nuxtConfig.indexOf("name: 'marketer-campaign'")
  assert.ok(galleryIdx !== -1, 'marketer-gallery route missing')
  assert.ok(campaignIdx !== -1)
  assert.ok(galleryIdx < campaignIdx, '/marketer/gallery must be registered BEFORE /marketer/:id (first-match)')
  assert.match(nuxtConfig, /view: 'views\/gallery\.vue'/)
  assert.match(listPage, /navigateTo\('\/marketer\/gallery'\)/)
})

test('gallery client matches the backend contract (GET list + PUT/DELETE result only)', { skip: !readFileSync(backendRoute, 'utf8') && 'backend not present' }, () => {
  const routes = readFileSync(backendRoute, 'utf8')
  assert.match(routes, /app\.get\('\/'/)
  assert.match(routes, /app\.put\('\/creatives\/:cid\/result'/)
  assert.match(routes, /app\.delete\('\/creatives\/:cid\/result'/)

  const calls = [...useApi.matchAll(/api\.(get|post|put|del)(?:<[^>]*>)?\(\s*[`'](\/gallery[^`']*)[`']/g)]
  assert.equal(calls.length, 3, 'galleryAPI ต้องมี 3 calls เท่านั้น')
  assert.deepEqual(calls.map(m => m[1]), ['get', 'put', 'del'])
})

test('manual analytics: no platform fetching, results entered by the user', () => {
  // useApi เรียก fetch ผ่าน api helper เดิมได้ แต่ห้ามมี URL แพลตฟอร์มตรง ๆ
  assert.doesNotMatch(useApi, /tiktok\.com\/|instagram\.com\/|facebook\.com\/|youtube\.com\/api/, 'useApi hardcodes a platform URL')
  assert.doesNotMatch(view, /\$fetch\(|[^.\w]fetch\(/, 'gallery.vue bypasses useApi')
  assert.doesNotMatch(view, /tiktok\.com\/|instagram\.com\//, 'gallery.vue hardcodes a platform URL')
  assert.doesNotMatch(view, /\bmock\w*\s*[:=]/i, 'gallery.vue contains mock data')
  assert.match(view, /galleryAPI\.saveResult\(/)
  assert.match(view, /galleryAPI\.deleteResult\(/)
  // dialog ต้องบอกผู้ใช้ชัดว่าเป็น manual analytics
  assert.match(view, /manualNote/)
})

test('result dialog exposes every metric field + delete for existing results', () => {
  for (const field of ['views', 'likes', 'comments', 'shares', 'salesThb', 'postedUrl', 'postedAt', 'note']) {
    assert.match(view, new RegExp(`form.${field}`), `dialog missing ${field}`)
  }
  assert.match(view, /btn-danger/)
  assert.match(view, /galleryAPI\.deleteResult/)
})

test('marketer.gallery.* i18n keys exist in both locales and cover every t() call', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) => {
    const key = p ? `${p}.${k}` : k
    return typeof v === 'object' && v !== null ? leaves(v, key) : [key]
  })
  const thKeys = new Set(leaves(th, ''))
  const enKeys = new Set(leaves(en, ''))
  const trending = (k) => k.startsWith('marketer.gallery.')
  const thG = [...thKeys].filter(trending)
  const enG = [...enKeys].filter(trending)
  assert.ok(thG.length >= 38, `expected the full gallery namespace, got ${thG.length}`)
  assert.deepEqual(thG.filter(k => !enKeys.has(k)), [], 'keys missing in en.json')
  assert.deepEqual(enG.filter(k => !thKeys.has(k)), [], 'keys missing in th.json')

  for (const m of view.matchAll(/\bt\('([\w.]+)'/g)) {
    assert.ok(thKeys.has(m[1]), `th.json missing ${m[1]} (used by gallery.vue)`)
    assert.ok(enKeys.has(m[1]), `en.json missing ${m[1]} (used by gallery.vue)`)
  }
  // list page ใช้ปุ่ม "คลังผลงาน"
  assert.match(listPage, /marketer\.list\.gallery/)
  assert.ok(thKeys.has('marketer.list.gallery') && enKeys.has('marketer.list.gallery'))
})

test('locale messages never contain unescaped @ (vue-i18n linked-message SyntaxError crashes the app)', () => {
  // บั๊กจริง: "https://...@shop" ทำ message compiler โยน SyntaxError ตอน render → ทั้ง page ถล่ม
  // วิธีเขียนที่ถูก: {'@'} (เช่น episode.sb.videoPromptPlaceholder เดิม)
  // @ ตามด้วยตัวอักษร (latinh/ไทย) = linked-message ที่ parse ไม่ได้; @ ตามด้วย {/ช่องว่าง = literal ปลอดภัย
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) => {
    const key = p ? `${p}.${k}` : k
    return typeof v === 'object' && v !== null ? leaves(v, key) : [key]
  })
  for (const [loc, data] of [['th', th], ['en', en]]) {
    for (const key of leaves(data, '')) {
      const parts = key.split('.')
      let msg = data
      for (const part of parts) msg = msg[part]
      if (typeof msg !== 'string') continue
      const stripped = msg.replaceAll("{'@'}", '')
      const bad = stripped.match(/@[\w\u0E00-\u0E7F]/)
      assert.ok(!bad, `${loc} ${key} has unescaped @ (@"${bad?.[1]}") — use {'@'} (vue-i18n will throw SyntaxError at render)`)
    }
  }
})
