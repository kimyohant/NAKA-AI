/**
 * AI นักขาย (docs/ai-seller/PLAN.md) — frontend structure + sellerCopy logic
 * ตรวจ: sellerAPI ตรงกับ routes ฝั่ง backend, เมนู/route ลงทะเบียน, i18n th/en สมมาตร,
 * composeChannel ประกอบข้อความเหมือน backend (ลิงก์ต่อท้ายคอมเมนต์ครั้งเดียว), parseHashtags
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { composeChannel, parseHashtags, postLink, SELLER_CHANNELS, CHANNEL_POST_URLS } from '../app/utils/sellerCopy.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const useApi = read('app/composables/useApi.ts')
const routes = read('../backend/src/routes/seller.ts')
const layout = read('app/layouts/default.vue')
const nuxtConfig = read('nuxt.config.ts')
const workspace = read('app/views/seller/workspace.vue')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

test('sellerAPI calls exactly the backend seller routes', () => {
  const block = useApi.slice(useApi.indexOf('export const sellerAPI'))
  const norm = (p) => p.replace(/\$\{[^}]+\}/g, ':id').replace(/\/$/, '')
  const calls = [...block.matchAll(/api\.(get|post|put|del)(?:<[^>]*>)?\(\s*[`'](\/seller[^`']*)[`']/g)]
    .map(m => `${m[1] === 'del' ? 'DELETE' : m[1].toUpperCase()} ${norm(m[2])}`).sort()
  const served = [...routes.matchAll(/app\.(get|post|put|delete)\('([^']+)'/g)]
    .map(m => `${m[1].toUpperCase()} /seller${m[2]}`).sort()
  assert.deepEqual(calls, served)
})

test('main menu: every module except the Skills Library; AI Seller is the app home', () => {
  const mainNav = layout.slice(layout.indexOf('<nav class="side-nav">'), layout.indexOf('</nav>'))
  const links = [...mainNav.matchAll(/to="([^"]+)"/g)].map(m => m[1])
  // คลังสกิล (/studio) ไม่อยู่ในเมนู — รวมอยู่ใน AI นักขายแล้ว
  assert.deepEqual(links, ['/drama', '/marketer', '/seller', '/viral-clone', '/live'])
  assert.match(layout, /go\('\/seller'\)/)
  // / → /seller; หน้าแรกเดิม (สตูดิโอละคร) ย้ายไป /drama
  assert.match(nuxtConfig, /pages\.push\(\{ path: '\/', redirect: '\/seller' \}\)/)
  assert.match(nuxtConfig, /dramaHome\.path = '\/drama'/)
  // หน้าแรกของ AI นักขายแนวคลังสกิล: hero + ค้นหา + ชิปหมวด + การ์ดสกิล
  const home = read('app/pages/seller.vue')
  for (const need of ['sh-hero', 'v-model="query"', 'sh-chip', '<StudioSkillCard', '@use="useSkill(tpl)"', 'studioAPI.templates()']) {
    assert.ok(home.includes(need), `seller home missing ${need}`)
  }
})

test('menu, route and workspace wiring', () => {
  assert.match(layout, /to="\/seller"/)
  assert.match(layout, /layout\.nav\.seller/)
  assert.match(nuxtConfig, /path: '\/seller\/:id'/)
  assert.match(workspace, /sellerAPI\.generate/)
  assert.match(workspace, /navigator\.clipboard\.writeText/)
  assert.match(workspace, /uploadAPI\.video/)
  assert.match(workspace, /sellerAPI\.studioVideos/)
})

test('i18n parity + labels for every channel', () => {
  const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  assert.deepEqual(leaves(th.seller).sort(), leaves(en.seller).sort())
  assert.equal(th.layout.nav.seller, 'AI นักขาย')
  for (const ch of SELLER_CHANNELS) {
    assert.ok(th.seller.channels[ch] && th.seller.tips[ch] && CHANNEL_POST_URLS[ch].startsWith('https://'))
  }
  for (const code of ['E_SELLER_NEEDS_PRODUCT', 'E_SELLER_NO_CHANNEL', 'E_SELLER_COPY']) {
    assert.ok(th.errors.codes[code] && en.errors.codes[code], code)
  }
})

test('composeChannel / parseHashtags / postLink', () => {
  assert.deepEqual(parseHashtags('#a b, #c  #a ##d'), ['a', 'b', 'c', 'd'])
  assert.equal(postLink({ affiliateUrl: ' ', productUrl: 'https://p' }), 'https://p')
  assert.equal(postLink({ affiliateUrl: 'https://aff', productUrl: 'https://p' }), 'https://aff')
  const out = composeChannel({ caption: 'hi', hashtags: ['x', 'y'], comment: 'buy' }, 'https://aff')
  assert.deepEqual(out, { post: 'hi\n\n#x #y', comment: 'buy\nhttps://aff' })
  assert.equal(composeChannel({ caption: '', hashtags: [], comment: 'see https://aff' }, 'https://aff').comment, 'see https://aff')
  assert.deepEqual(composeChannel(undefined, null), { post: '', comment: '' })
})

test('skills library is built into AI Seller (skill → Studio video → attached to the post)', () => {
  const skillVideo = read('app/components/SellerSkillVideo.vue')
  const list = read('app/pages/seller.vue')
  assert.match(workspace, /<SellerSkillVideo/)
  assert.match(workspace, /:before-start="save"/)
  assert.match(workspace, /route\.query\.skill/)
  // วิดีโอไม่อยู่ใน autosave — กันค่าเก่าทับวิดีโอที่ระบบแนบให้
  const payloadFn = workspace.slice(workspace.indexOf('function payload()'), workspace.indexOf('// ===== autosave'))
  assert.ok(!/videoUrl:/.test(payloadFn), 'payload() must not send videoUrl')
  assert.match(workspace, /videoJob\?\.running/)
  assert.match(skillVideo, /studioAPI\.templates\(\)/)
  assert.match(skillVideo, /sellerAPI\.makeVideo/)
  assert.match(skillVideo, /sellerAPI\.stopVideo/)
  assert.match(skillVideo, /<StudioSkillCard/)
  assert.match(list, /route\.query\.skill/)
  assert.match(list, /query: \{ skill: skill\.value \}/)
  for (const st of ['scripting', 'keyframes', 'videos', 'merging', 'done', 'failed', 'cancelled']) {
    assert.ok(th.seller.skillVideo.stage[st] && en.seller.skillVideo.stage[st], st)
  }
  for (const code of ['E_SELLER_VIDEO_BUSY', 'E_SELLER_VIDEO_FAILED', 'E_SELLER_VIDEO_GONE', 'E_SELLER_VIDEO_CANCELLED']) {
    assert.ok(th.errors.codes[code] && en.errors.codes[code], code)
  }
})
