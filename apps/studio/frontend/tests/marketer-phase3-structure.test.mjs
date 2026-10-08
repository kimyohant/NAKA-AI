/**
 * AI Marketer Phase 3 (docs/ai-marketer/PHASE3.md) — frontend structure tests
 *
 * ตรวจ: marketerAPI มี endpoint ใหม่ครบตามสัญญา §2, types ครบ, ขั้น visuals อยู่ใน flow
 * (stepDone/suggestedStep ทำงานถูกจริง ๆ ด้วยการ import ฟังก์ชันมารัน), i18n th/en
 * ครบสมมาตร, error codes ใหม่ถูกแปล, ไม่มี mock หรือ hardcoded text หลงเหลือ
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MARKETER_STEPS, VISUALS_STEP, VISUAL_KINDS, stepDone, suggestedStep } from '../menus/marketer/utils/marketerFlow.js'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const useApi = read('app/composables/useApi.ts')
const workbench = read('menus/marketer/views/campaign.vue')
const phase3Files = [
  ['components/MarketerReferencePanel.vue', read('menus/marketer/components/MarketerReferencePanel.vue')],
  ['components/MarketerReferenceCard.vue', read('menus/marketer/components/MarketerReferenceCard.vue')],
  ['components/MarketerVisualCard.vue', read('menus/marketer/components/MarketerVisualCard.vue')],
]
const allP3 = [['views/marketer/campaign.vue', workbench], ...phase3Files]
const th = loadLocale('th')
const en = loadLocale('en')

test('marketerAPI implements every Phase 3 endpoint from PHASE3.md §2', () => {
  for (const m of ['addReference', 'updateReference', 'deleteReference', 'analyzeReference', 'generateVisuals', 'deleteVisual', 'promoteVisual']) {
    assert.match(useApi, new RegExp(`\\b${m}:`), `marketerAPI.${m} missing`)
  }
  assert.match(useApi, /generateCreatives: \(id: number, data: \{[^}]*referenceId\?: number/, 'generateCreatives must accept referenceId')
  for (const fragment of ['/references`, data', '/references/${refId}`, data', '/references/${refId}/analyze', '/visuals/generate`, data', '/visuals/${vid}`', '/visuals/${vid}/promote']) {
    assert.ok(useApi.includes(fragment), `marketerAPI missing path fragment ${fragment}`)
  }
})

test('contract types: AdReference, CampaignVisual, Creative.referenceId, detail lists', () => {
  assert.match(useApi, /export type AdReferenceStatus = 'draft' \| 'analyzed'/)
  assert.match(useApi, /export type VisualKind = 'packshot' \| 'on_model' \| 'lifestyle'/)
  assert.match(useApi, /export type VisualStatus = 'processing' \| 'completed' \| 'failed'/)
  assert.match(useApi, /export interface AdReference \{/)
  assert.match(useApi, /export interface CampaignVisual \{/)
  assert.match(useApi, /referenceId: number \| null/)
  assert.match(useApi, /references: AdReference\[\]; visuals: CampaignVisual\[\]/)
})

test('visuals is a real step: after brief, done when promoted, never a suggestion trap', () => {
  assert.equal(MARKETER_STEPS.indexOf(VISUALS_STEP), MARKETER_STEPS.indexOf('brief') + 1, 'visuals must follow brief')
  assert.deepEqual(VISUAL_KINDS, ['packshot', 'on_model', 'lifestyle'])
  assert.equal(stepDone('visuals', { visuals: [{ promoted: true }] }), true)
  assert.equal(stepDone('visuals', { visuals: [{ promoted: false }] }), false)
  assert.equal(stepDone('visuals', {}), false)
  // visuals เป็นขั้น optional — suggestedStep ห้ามพาผู้ใช้ไปค้างที่นั่น
  assert.notEqual(suggestedStep({ status: 'draft', docs: [], creatives: [], visuals: [] }), 'visuals')
  assert.notEqual(suggestedStep({ status: 'draft', docs: [], creatives: [], visuals: [{ promoted: true }] }), 'visuals')
})

test('workbench wires the Phase 3 UI and the unified poll', () => {
  assert.match(workbench, /<MarketerReferencePanel/)
  assert.match(workbench, /<MarketerVisualCard/)
  assert.match(workbench, /step === 'visuals'/)
  assert.match(workbench, /marketerAPI\.generateVisuals/)
  assert.match(workbench, /retryVisual/)
  assert.match(workbench, /presetReference/)
  assert.match(workbench, /clearPresetReference/)
  assert.match(workbench, /referenceTitleMap/)
  assert.match(workbench, /hasProcessingVisual/)
  // timer เดียว: agent job 2s มาก่อน, visuals ใช้ 3s เป็น fallback — ไม่ยิง poll ซ้อน
  assert.match(workbench, /if \(busy\.value\) pollTimer = setTimeout\(poll, POLL_INTERVAL_MS\)/)
  assert.match(workbench, /else if \(hasProcessingVisual\.value\) pollTimer = setTimeout\(poll, VISUAL_POLL_INTERVAL_MS\)/)
  assert.match(workbench, /goStep\('visuals'\)/)
})

test('reference UI: sync analyze + markdown renderer + transcript-clear warning + confirm dialog', () => {
  const card = phase3Files.find(([n]) => n.includes('ReferenceCard'))[1]
  const panel = phase3Files.find(([n]) => n.includes('ReferencePanel'))[1]
  assert.match(card, /marketerAPI\.analyzeReference/)
  assert.match(card, /marketerAPI\.updateReference/)
  assert.match(card, /renderMarkdown/)
  assert.match(card, /transcriptChangeWarn/)
  assert.match(panel, /marketerAPI\.addReference/)
  assert.match(panel, /marketerAPI\.deleteReference/)
  assert.match(panel, /ConfirmDialog/)
})

test('visual card: promote/retry/delete and status rendering', () => {
  const card = phase3Files.find(([n]) => n.includes('MarketerVisualCard'))[1]
  assert.match(card, /marketerAPI\.promoteVisual/)
  assert.match(card, /marketerAPI\.deleteVisual/)
  assert.match(card, /emit\('retry', visual\)/)
  assert.match(card, /t\(`marketer\.visualStatus\.\$\{visual\.status\}`\)/)
})

test('Phase 3 i18n keys exist in both locales with full parity', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  const thKeys = new Set(leaves(th.marketer, 'marketer'))
  const enKeys = new Set(leaves(en.marketer, 'marketer'))
  for (const group of ['referenceStatus', 'visualKinds', 'visualStatus', 'references', 'visuals']) {
    assert.ok(th.marketer[group], `th marketer.${group} missing`)
    assert.ok(en.marketer[group], `en marketer.${group} missing`)
  }
  assert.equal(typeof th.marketer.steps.visuals, 'string', 'th marketer.steps.visuals missing')
  assert.equal(typeof en.marketer.steps.visualsSub, 'string', 'en marketer.steps.visualsSub missing')
  for (const v of VISUAL_KINDS) assert.equal(typeof en.marketer.visualKinds[v], 'string', `marketer.visualKinds.${v} missing`)
  for (const v of ['processing', 'completed', 'failed']) assert.equal(typeof th.marketer.visualStatus[v], 'string', `marketer.visualStatus.${v} missing`)
  for (const v of ['draft', 'analyzed']) assert.equal(typeof en.marketer.referenceStatus[v], 'string', `marketer.referenceStatus.${v} missing`)
  // ทุก key ที่ Phase 3 ใช้ต้องมีในสองภาษา
  const src = allP3.map(([, s]) => s).join('\n')
  for (const m of src.matchAll(/\bt\('(marketer\.[\w.]+)'/g)) {
    assert.ok(thKeys.has(m[1]) && enKeys.has(m[1]), `missing i18n key ${m[1]}`)
  }
})

test('Phase 3 error codes are localized', () => {
  for (const c of ['E_REFERENCE_NOT_ANALYZED', 'E_VISUAL_NOT_READY']) {
    assert.equal(typeof en.errors.codes[c], 'string', `en errors.codes.${c} missing`)
    assert.equal(typeof th.errors.codes[c], 'string', `th errors.codes.${c} missing`)
  }
})

test('no hardcoded UI text in Phase 3 components', () => {
  for (const [name, src] of allP3) {
    const stripped = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '')
    assert.doesNotMatch(stripped, /[฀-๿]/, `${name} has hardcoded Thai text`)
    assert.doesNotMatch(stripped, /[一-鿿]/, `${name} has hardcoded Chinese text`)
  }
})

test('no mock data in Phase 3 delivered code', () => {
  for (const [name, src] of allP3) {
    assert.doesNotMatch(src, /\bmock\w*\s*[:=]/i, `${name} contains mock data`)
    assert.doesNotMatch(src, /fixture|dummyData/i, `${name} contains fixture data`)
  }
})
