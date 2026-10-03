/**
 * Product Studio — structure & contract tests (docs/product-studio/PLAN.md)
 *
 * ตรวจ: studioAPI ครบทุก endpoint ตามตาราง PLAN §4, routes ลงทะเบียน, เมนูใน layout,
 * i18n th/en ครบสมมาตร (รวม 12 เทมเพลต / 12 ภาษา / 15 ตลาด / 8 แพลตฟอร์ม / error codes 6 ตัว),
 * logic ใน studioFlow.js ทำงานถูกจริง (import มารัน), ไม่มี mock/hardcode
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  STUDIO_STEPS, STUDIO_IMAGE_KINDS, STUDIO_DURATION_MIN, STUDIO_DURATION_MAX,
  isStepDone, nextIncompleteStep, clampStudioDuration, speechSeconds, dialogueTooLong, beatBars, applyPlatformDefaults,
} from '../app/utils/studioFlow.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const useApi = read('app/composables/useApi.ts')
const listPage = read('app/pages/studio.vue')
const workspace = read('app/views/studio/workspace.vue')
const components = ['StudioTemplateCard', 'StudioTemplateGallery', 'StudioShotCard', 'StudioAvatarCard', 'StudioImageCard', 'StudioProductImages']
  .map((n) => [`components/${n}.vue`, read(`app/components/${n}.vue`)])
const nuxtConfig = read('nuxt.config.ts')
const layout = read('app/layouts/default.vue')
const plan = read('../docs/product-studio/PLAN.md')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))
const uiFiles = [['pages/studio.vue', listPage], ['views/studio/workspace.vue', workspace], ...components]

const studioBlock = useApi.slice(useApi.indexOf('export const studioAPI'))
const normalize = (p) => p.replace(/\$\{[^}]*$/, '').replace(/\$\{[^}]+\}/g, ':').replace(/\?.*$/, '').replace(/\/$/, '')

function frontendCalls() {
  const calls = []
  for (const m of studioBlock.matchAll(/api\.(get|post|put|del)(?:<[^>]*>)?\(\s*[`'](\/studio[^`']*)[`']/g)) {
    calls.push(`${m[1] === 'del' ? 'DELETE' : m[1].toUpperCase()} ${normalize(m[2])}`)
  }
  return calls
}

test('studioAPI implements every endpoint in PLAN.md §4', () => {
  const contract = [...plan.matchAll(/\|\s*(GET|POST|PUT|DELETE)\s*\|\s*`(\/[^`]*)`\s*\|/g)]
    .filter((m) => !m[2].startsWith('/campaigns'))
    .map((m) => `${m[1]} ${normalize(`/studio${m[2]}`.replace(/:\w+/g, ':'))}`)
  const calls = frontendCalls()
  assert.equal(contract.length, 20, `expected 20 contract endpoints, parsed ${contract.length}`)
  for (const c of contract) assert.ok(calls.includes(c), `studioAPI missing contract endpoint ${c}`)
  for (const c of calls) assert.ok(contract.includes(c), `studioAPI calls ${c} which is not in the contract`)
})

test('studioAPI methods exist by name', () => {
  for (const m of ['options', 'templates', 'list', 'create', 'ingestUrl', 'get', 'update', 'del', 'script', 'updateShot', 'render', 'merge', 'generateImages', 'deleteImage', 'promoteImage', 'avatars', 'createAvatar', 'updateAvatar', 'generateAvatarImage', 'deleteAvatar']) {
    assert.match(useApi, new RegExp(`\\b${m}:`), `studioAPI.${m} missing`)
  }
  for (const t of ['export interface StudioProject {', 'export interface StudioShot {', 'export interface StudioMerge {', 'export interface StudioAvatar {', 'export interface StudioImage {', 'export interface StudioTemplate {', 'export interface StudioOptions {']) {
    assert.match(useApi, new RegExp(t.replace(/[{]/g, '\\{')))
  }
})

test('routes and menu are registered', () => {
  assert.match(nuxtConfig, /name: 'studio-workspace'/)
  assert.match(nuxtConfig, /path: '\/studio\/:id'/)
  assert.match(nuxtConfig, /views\/studio\/workspace\.vue/)
  assert.match(layout, /to="\/studio"/)
  assert.match(layout, /layout\.nav\.studio/)
  assert.match(layout, /isProductStudioRoute/)
})

test('studio.* i18n keys exist in both locales with full parity', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  const thKeys = new Set(leaves(th.productStudio, 'productStudio'))
  const enKeys = new Set(leaves(en.productStudio, 'productStudio'))
  assert.deepEqual([...thKeys].filter((k) => !enKeys.has(k)), [], 'keys missing in en.json')
  assert.deepEqual([...enKeys].filter((k) => !thKeys.has(k)), [], 'keys missing in th.json')
  assert.equal(typeof th.layout.nav.studio, 'string')
  assert.equal(typeof en.layout.nav.studio, 'string')
  // ข้อมูล global options ห้าม hardcode ใน frontend — ต้องมี label ครบจาก i18n
  assert.equal(Object.keys(th.productStudio.languages).length, 12)
  assert.equal(Object.keys(en.productStudio.languages).length, 12)
  assert.equal(Object.keys(th.productStudio.markets).length, 15)
  assert.equal(Object.keys(th.productStudio.platforms).length, 8)
})

test('all 12 templates have name, description and beat labels in both locales', () => {
  const ids = ['ugc_review', 'unboxing', 'before_after', 'problem_solution', 'how_to_use', 'three_reasons', 'comparison', 'try_on', 'creator_story', 'lifestyle_showcase', 'asmr_closeup', 'flash_deal']
  for (const id of ids) {
    for (const loc of [th, en]) {
      const tpl = loc.productStudio.templates[id]
      assert.ok(tpl, `studio.templates.${id} missing`)
      assert.equal(typeof tpl.name, 'string')
      assert.ok(tpl.name.trim())
      assert.equal(typeof tpl.description, 'string')
      assert.ok(tpl.description.trim())
      assert.ok(tpl.beats && Object.keys(tpl.beats).length >= 3, `studio.templates.${id}.beats missing`)
      for (const role of Object.keys(tpl.beats)) assert.ok(tpl.beats[role].trim())
    }
  }
})

test('new studio error codes are localized', () => {
  const codes = ['E_STUDIO_BUSY', 'E_STUDIO_NEEDS_SCRIPT', 'E_STUDIO_NEEDS_KEYFRAMES', 'E_STUDIO_NO_VIDEOS', 'E_AVATAR_REQUIRED', 'E_TEMPLATE_UNKNOWN']
  for (const c of codes) {
    assert.equal(typeof en.errors.codes[c], 'string', `en errors.codes.${c} missing`)
    assert.equal(typeof th.errors.codes[c], 'string', `th errors.codes.${c} missing`)
  }
})

test('every t() key used by studio UI exists in both locales', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  const thKeys = new Set(leaves(th, '').map(k => k.replace(/^\./, '')))
  const enKeys = new Set(leaves(en, '').map(k => k.replace(/^\./, '')))
  for (const [name, src] of uiFiles) {
    for (const m of src.matchAll(/\bt\('(productStudio\.[\w.]+)'/g)) {
      assert.ok(thKeys.has(m[1]) && enKeys.has(m[1]), `missing i18n key ${m[1]} (used by ${name})`)
    }
  }
})

test('dynamic i18n keys use the productStudio prefix (studio.* belongs to the home page)', () => {
  for (const [name, src] of uiFiles) {
    assert.doesNotMatch(src, /[`'"]studio\.(templates|categories|languages|markets|platforms)\./, `${name} builds a studio.* key`)
  }
  const categories = ['review', 'demo', 'fashion_beauty', 'showcase', 'promo']
  for (const locale of [th, en]) {
    for (const c of categories) assert.ok(locale.productStudio?.categories?.[c], `missing productStudio.categories.${c}`)
  }
})

test('render-all continues to videos even when keyframes are already done or some failed', () => {
  assert.match(workspace, /if \(allKeyframesDone\.value\) continueRenderAll\(\)/)
  assert.match(workspace, /function continueRenderAll\(\)[\s\S]*?processingMedia\.value/)
  assert.match(workspace, /disposed = true/)
})

test('workspace implements the 6-step flow with a single poll timer', () => {
  assert.match(workspace, /STUDIO_STEPS/)
  for (const step of STUDIO_STEPS) {
    assert.match(workspace, new RegExp(`step === '${step}'`), `step ${step} must be reachable`)
  }
  assert.match(workspace, /studioAPI\.get\(projectId\)/)
  assert.match(workspace, /POLL_INTERVAL_MS/)
  assert.match(workspace, /RENDER_POLL_INTERVAL_MS/)
  assert.match(workspace, /clearTimeout\(pollTimer\)/)
  assert.match(workspace, /studioAPI\.script/)
  assert.match(workspace, /studioAPI\.render/)
  assert.match(workspace, /studioAPI\.merge/)
  assert.match(workspace, /studioErrorCodeOf/)
  assert.match(workspace, /<StudioTemplateGallery/)
  assert.match(workspace, /<StudioShotCard/)
  assert.match(workspace, /<StudioProductImages/)
  assert.match(workspace, /autoVideosArmed/)
})

test('studioFlow: steps complete in order and suggestions never point past render', () => {
  const empty = { shots: [], latestMerge: null }
  assert.equal(nextIncompleteStep(null), 'product')
  assert.equal(nextIncompleteStep({ ...empty, productName: 'x' }), 'template')
  assert.equal(nextIncompleteStep({ ...empty, productName: 'x', templateId: 'ugc_review' }), 'settings')
  assert.equal(nextIncompleteStep({ ...empty, productName: 'x', templateId: 't', language: 'th', market: 'TH', platform: 'tiktok', durationSec: 30 }), 'script')
  assert.equal(nextIncompleteStep({ ...empty, productName: 'x', templateId: 't', language: 'th', market: 'TH', platform: 'tiktok', durationSec: 30, shots: [{ videoStatus: 'completed' }] }), 'export')
  assert.equal(isStepDone('render', empty), false)
  assert.equal(isStepDone('render', { shots: [{ videoStatus: 'completed' }] }), true)
  assert.equal(isStepDone('export', { latestMerge: { status: 'completed' } }), true)
  assert.equal(isStepDone('export', { latestMerge: { status: 'processing' } }), false)
})

test('studioFlow: duration clamp respects the platform ceiling', () => {
  assert.equal(clampStudioDuration(15), 15)
  assert.equal(clampStudioDuration(5), STUDIO_DURATION_MIN)
  assert.equal(clampStudioDuration(999), STUDIO_DURATION_MAX)
  assert.equal(clampStudioDuration(45, 30), 30)
  assert.equal(clampStudioDuration('abc'), 20)
  assert.equal(STUDIO_DURATION_MIN, 10)
  assert.equal(STUDIO_DURATION_MAX, 60)
})

test('studioFlow: speech estimate uses words for spaced languages, chars for th/zh/ja/ko', () => {
  // 2.5 คำ/วินาที: 10 คำ → 4s
  assert.equal(speechSeconds('one two three four five six seven eight nine ten', 'en'), 4)
  // ไทย 12 code unit/วินาที (สระ/วรรณยุกต์นับแยก): 24 ตัว → 2s · จีน 4.5 ตัว/วินาที: 9 ตัว → 2s
  assert.equal(speechSeconds('ก'.repeat(24), 'th'), 2)
  assert.equal(speechSeconds('好'.repeat(9), 'zh'), 2)
  assert.equal(speechSeconds('', 'en'), 0)
  // บรรทัดรีวิวไทยปกติ (~3 วินาทีเมื่อพูดจริง) ต้องไม่ถูกเตือนในช็อต 5 วินาที
  assert.equal(dialogueTooLong('ครีมตัวนี้ทาแล้วผิวชุ่มชื้นทั้งวันเลยค่ะ', 'th', 5), false)
  assert.equal(dialogueTooLong('x'.repeat(1), 'th', 0), false)
  // 15% tolerance: 5s ของ en ≈ 12.5 คำ พอดี; 14 คำ (5.6s) เกิน
  const twelve = Array(12).fill('w').join(' ')
  const fifteen = Array(15).fill('w').join(' ')
  assert.equal(dialogueTooLong(twelve, 'en', 5), false)
  assert.equal(dialogueTooLong(fifteen, 'en', 5), true)
})

test('studioFlow: beat bars are proportional and platform defaults apply', () => {
  const bars = beatBars({ beats: [{ role: 'a', seconds: 3 }, { role: 'b', seconds: 3 }] })
  assert.equal(bars.length, 2)
  assert.equal(bars[0].width, 50)
  assert.equal(bars[1].start, 50)
  assert.deepEqual(beatBars({ beats: [] }), [])
  const applied = applyPlatformDefaults(
    { platform: 'tiktok', aspectRatio: '9:16', durationSec: 60 },
    { id: 'shopee', defaultAspect: '1:1', maxDurationSec: 45 },
  )
  assert.equal(applied.platform, 'shopee')
  assert.equal(applied.aspectRatio, '1:1')
  assert.equal(applied.durationSec, 45)
})

test('no hardcoded UI text in studio files', () => {
  for (const [name, src] of uiFiles) {
    const stripped = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '')
    assert.doesNotMatch(stripped, /[฀-๿]/, `${name} has hardcoded Thai text`)
    assert.doesNotMatch(stripped, /[一-鿿]/, `${name} has hardcoded Chinese text`)
  }
})

test('no mock data in studio delivered code', () => {
  for (const [name, src] of uiFiles) {
    assert.doesNotMatch(src, /\bmock\w*\s*[:=]/i, `${name} contains mock data`)
    assert.doesNotMatch(src, /fixture|dummyData/i, `${name} contains fixture data`)
  }
})
