/**
 * Product Studio Phase 2 (docs/product-studio/PHASE2.md) — frontend structure tests
 *
 * ตรวจ: studioAPI เมธอดใหม่ตาม PHASE2 §2, auto-render แทน browser chain สมบูรณ์
 * (ไม่เหลือ autoVideosArmed), captions UI, Marketer→Studio bridge, i18n parity
 * (ห้ามมี `'studio.` เหลือใน Studio UI), logic ใน studioFlow.js รันจริง
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isAutoRenderActive, autoRenderProgress, shotsWithoutCaptions, captionSourceOf } from '../menus/product-studio/utils/studioFlow.js'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const useApi = read('app/composables/useApi.ts')
const workspace = read('menus/product-studio/views/workspace.vue')
const listPage = read('menus/product-studio/pages/studio.vue')
const campaign = read('menus/marketer/views/campaign.vue')
const creativeCard = read('menus/marketer/components/MarketerCreativeCard.vue')
const fromCampaignDialog = read('menus/product-studio/components/StudioFromCampaignDialog.vue')
const shotCard = read('menus/product-studio/components/StudioShotCard.vue')
const studioUiFiles = [
  ['views/studio/workspace.vue', workspace],
  ['pages/studio.vue', listPage],
  ['components/StudioFromCampaignDialog.vue', fromCampaignDialog],
  ['components/StudioShotCard.vue', shotCard],
]
const th = loadLocale('th')
const en = loadLocale('en')

test('studioAPI implements the PHASE2 §2 endpoints', () => {
  for (const m of ['autoRender', 'cancelAutoRender', 'fromCampaign']) {
    assert.match(useApi, new RegExp(`\\b${m}:`), `studioAPI.${m} missing`)
  }
  assert.match(useApi, /autoRender: \(id: number, data: \{ force\?: boolean \}/)
  assert.match(useApi, /cancelAutoRender: \(id: number\) => api\.post<StudioProject>\(`\/studio\/projects\/\$\{id\}\/auto-render\/cancel`/)
  assert.match(useApi, /fromCampaign: \(data: \{ campaignId: number; creativeId\?: number; templateId: string \}\) => api\.post<StudioProject>\('\/studio\/projects\/from-campaign'/)
  assert.match(useApi, /merge: \(id: number, data: \{ captions\?: boolean \}/)
})

test('contract types: autoRender shape + project fields + merge subtitle fields', () => {
  assert.match(useApi, /export type AutoRenderStage = 'idle' \| 'keyframes' \| 'videos' \| 'merging' \| 'done' \| 'failed' \| 'cancelled'/)
  assert.match(useApi, /export interface StudioAutoRender \{/)
  for (const field of ['captions: boolean', 'captionStyle: \'clean\' | \'bold\' | \'boxed\'', 'aiLabelBurnIn: boolean', 'autoRender: StudioAutoRender', 'sourceCampaignId: number | null']) {
    assert.match(useApi, new RegExp(field.replace(/[{}]/g, '\\$&')), `StudioProject missing ${field}`)
  }
  assert.match(useApi, /captioned: boolean/)
  assert.match(useApi, /subtitleUrl: string \| null/)
})

test('server-side auto-render replaces the browser chain completely', () => {
  for (const gone of ['autoVideosArmed', 'continueRenderAll', 'keepOpenWarn']) {
    assert.ok(!workspace.includes(gone), `workspace still contains ${gone}`)
  }
  for (const need of ['studioAPI.autoRender', 'studioAPI.cancelAutoRender', 'startAutoRender', 'stopAutoRender', 'autoRenderActive', 'productStudio.autoRender.stage.', 'productStudio.autoRender.doneToast']) {
    assert.match(workspace, new RegExp(need), `workspace missing ${need}`)
  }
  // poll 3s ระหว่าง pipeline วิ่ง — timer เดียวเดิม
  assert.match(workspace, /processingMedia\.value \|\| mergeProcessing\.value \|\| autoRenderActive\.value/)
  // ปุ่มรายช็อต/merge ปิดระหว่าง pipeline
  assert.match(workspace, /:disabled="renderBlock"/)
  // done → พาไปขั้นส่งออก
  assert.match(workspace, /goStep\('export'\)/)
})

test('captions UI: settings preview, export switch + srt, script no-caption hints', () => {
  assert.match(workspace, /settingsDraft\.captions/)
  assert.match(workspace, /settingsDraft\.captionStyle/)
  assert.match(workspace, /CAPTION_STYLES/)
  assert.match(workspace, /settingsDraft\.aiLabelBurnIn/)
  assert.match(workspace, /mergeCaptions/)
  assert.match(workspace, /productStudio\.captions\.downloadSrt/)
  assert.match(workspace, /latestMerge\.subtitleUrl/)
  assert.match(workspace, /latestMerge\.captioned/)
  assert.match(workspace, /noCaptionCount/)
  assert.match(shotCard, /productStudio\.captions\.noCaptionBadge/)
})

test('marketer → studio bridge is wired on both levels', () => {
  assert.match(campaign, /<StudioFromCampaignDialog/)
  assert.match(campaign, /openStudioDialog\(\)/)
  assert.match(campaign, /@to-studio="openStudioDialog\(\$event\)"/)
  assert.match(campaign, /marketer\.work\.toStudio/)
  assert.match(creativeCard, /emit\('toStudio', creative\)/)
  assert.match(creativeCard, /marketer\.creatives\.toStudio/)
  assert.match(fromCampaignDialog, /studioAPI\.fromCampaign/)
  assert.match(fromCampaignDialog, /<StudioTemplateGallery/)
})

test('Phase 2 i18n keys exist in both locales with full parity', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  const thKeys = new Set(leaves(th.productStudio, 'productStudio'))
  const enKeys = new Set(leaves(en.productStudio, 'productStudio'))
  assert.deepEqual([...thKeys].filter((k) => !enKeys.has(k)), [], 'keys missing in en.json')
  assert.deepEqual([...enKeys].filter((k) => !thKeys.has(k)), [], 'keys missing in th.json')
  for (const group of ['autoRender', 'captions', 'fromCampaign']) {
    assert.ok(th.productStudio[group] && en.productStudio[group], `productStudio.${group} missing`)
  }
  for (const stage of ['idle', 'keyframes', 'videos', 'merging', 'done', 'failed', 'cancelled']) {
    assert.equal(typeof en.productStudio.autoRender.stage[stage], 'string', `autoRender.stage.${stage} missing`)
  }
  for (const style of ['clean', 'bold', 'boxed']) {
    assert.equal(typeof th.productStudio.captions.styles[style], 'string', `captions.styles.${style} missing`)
  }
  assert.equal(typeof th.marketer.work.toStudio, 'string')
  assert.equal(typeof en.marketer.creatives.toStudio, 'string')
  // ทุก t() key ที่ phase 2 ใช้ต้องมีจริง
  const flat = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flat(v, `${p}.${k}`) : [`${p}.${k}`])
  const thAll = new Set(flat(th, '').map(k => k.replace(/^\./, '')))
  const enAll = new Set(flat(en, '').map(k => k.replace(/^\./, '')))
  for (const [name, src] of studioUiFiles) {
    for (const m of src.matchAll(/\bt\('(productStudio\.[\w.]+)'/g)) {
      assert.ok(thAll.has(m[1]) && enAll.has(m[1]), `missing i18n key ${m[1]} (used by ${name})`)
    }
  }
})

test('Phase 2 error codes are localized', () => {
  for (const c of ['E_STUDIO_CAMPAIGN_NOT_FOUND', 'E_CAPTION_FONT_MISSING']) {
    assert.equal(typeof en.errors.codes[c], 'string', `en errors.codes.${c} missing`)
    assert.equal(typeof th.errors.codes[c], 'string', `th errors.codes.${c} missing`)
  }
})

test('Studio UI never uses the forbidden studio.* prefix', () => {
  for (const [name, src] of [...studioUiFiles, ['components/StudioTemplateCard.vue', read('menus/product-studio/components/StudioTemplateCard.vue')], ['components/StudioTemplateGallery.vue', read('menus/product-studio/components/StudioTemplateGallery.vue')], ['components/StudioAvatarCard.vue', read('menus/product-studio/components/StudioAvatarCard.vue')], ['components/StudioImageCard.vue', read('menus/product-studio/components/StudioImageCard.vue')], ['components/StudioProductImages.vue', read('menus/product-studio/components/StudioProductImages.vue')]]) {
    assert.doesNotMatch(src, /\bt\('studio\./, `${name} uses the home-page studio.* prefix`)
    assert.doesNotMatch(src, /\bt\(`studio\./, `${name} uses the home-page studio.* prefix`)
  }
})

test('studioFlow: auto-render progress and caption helpers', () => {
  const running = { autoRender: { stage: 'videos', total: 4, done: 2, failed: 1 } }
  assert.equal(isAutoRenderActive(running), true)
  assert.equal(isAutoRenderActive({ autoRender: { stage: 'done' } }), false)
  assert.equal(isAutoRenderActive({}), false)
  const prog = autoRenderProgress(running)
  assert.equal(prog.percent, 75)
  assert.equal(prog.done, 2)
  assert.equal(prog.failed, 1)
  assert.equal(autoRenderProgress({ autoRender: { stage: 'idle' } }).percent, 0)
  assert.equal(autoRenderProgress({ autoRender: { stage: 'merging', total: 1, done: 0 } }).percent, 0)
  // caption source: dialogue ก่อน ไม่งั้น onScreenText ไม่งั้น null
  assert.equal(captionSourceOf({ dialogue: ' สวัสดี ', onScreenText: null }), 'dialogue')
  assert.equal(captionSourceOf({ dialogue: null, onScreenText: ' 50% ' }), 'onScreenText')
  assert.equal(captionSourceOf({ dialogue: null, onScreenText: null }), null)
  const shots = [
    { dialogue: 'a', onScreenText: null },
    { dialogue: null, onScreenText: 'b' },
    { dialogue: null, onScreenText: null },
  ]
  assert.equal(shotsWithoutCaptions(shots).length, 1)
  assert.equal(shotsWithoutCaptions([]).length, 0)
})
