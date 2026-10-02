/**
 * AI Marketer — structure & contract tests
 *
 * ตรวจว่า frontend เรียก API ตรงกับ route จริงของ backend (backend/src/routes/campaigns.ts,
 * สัญญาใน docs/ai-marketer/PLAN.md ข้อ 4), ไม่มี hardcoded UI text, ไม่มี mock data,
 * และ locale th/en มี key ครบสมมาตรกัน (marketer.* + errors.codes ที่ backend ส่งจริง)
 */
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const useApi = read('app/composables/useApi.ts')
const listPage = read('app/pages/marketer.vue')
const workbench = read('app/views/marketer/campaign.vue')
const components = ['MarketerBriefForm', 'MarketerDocCard', 'MarketerCreativeCard']
  .map((n) => [`components/${n}.vue`, read(`app/components/${n}.vue`)])
const nuxtConfig = read('nuxt.config.ts')
const layout = read('app/layouts/default.vue')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))
const uiFiles = [['pages/marketer.vue', listPage], ['views/marketer/campaign.vue', workbench], ...components]

const backendRoutesUrl = new URL('../backend/src/routes/campaigns.ts', root)

const marketerBlock = useApi.slice(useApi.indexOf('export const marketerAPI'))
/** `/campaigns/${id}/docs/${docId}` → `/campaigns/:/docs/:` เพื่อเทียบกับ route ฝั่ง backend */
const normalize = (p) => p.replace(/\$\{[^}]*$/, '').replace(/\$\{[^}]+\}/g, ':').replace(/\?.*$/, '').replace(/\/$/, '')

function frontendCalls() {
  const calls = []
  for (const m of marketerBlock.matchAll(/api\.(get|post|put|del)(?:<[^>]*>)?\(\s*[`'](\/campaigns[^`']*)[`']/g)) {
    calls.push(`${m[1] === 'del' ? 'DELETE' : m[1].toUpperCase()} ${normalize(m[2])}`)
  }
  return calls
}

test('marketerAPI only calls endpoints that the backend actually serves', { skip: !existsSync(backendRoutesUrl) && 'backend not present' }, () => {
  const routes = readFileSync(backendRoutesUrl, 'utf8')
  const served = new Set(
    [...routes.matchAll(/app\.(get|post|put|delete)\('([^']*)'/g)]
      .map((m) => `${m[1].toUpperCase()} ${normalize(`/campaigns${m[2]}`.replace(/:\w+/g, ':'))}`),
  )
  const calls = frontendCalls()
  assert.ok(calls.length >= 15, `expected the full campaign client, got ${calls.length} calls`)
  for (const c of calls) assert.ok(served.has(c), `frontend calls ${c} but backend has no such route`)
  // ทุก route ของ backend ต้องมี client รองรับ
  for (const s of served) assert.ok(calls.includes(s), `backend route ${s} has no frontend client`)
})

test('marketer UI talks to the backend only through marketerAPI', () => {
  assert.ok(!existsSync(new URL('app/composables/useMarketer.ts', root)), 'stale useMarketer.ts must not come back')
  for (const [name, src] of uiFiles) {
    assert.doesNotMatch(src, /useMarketer|campaignAPI/, `${name} uses a non-contract client`)
    assert.doesNotMatch(src, /\$fetch\(|\bfetch\(/, `${name} bypasses useApi`)
  }
})

test('JSON fields follow the camelCase contract', () => {
  for (const [name, src] of uiFiles) {
    for (const bad of ['brand_context', 'updated_at', 'created_at', 'error_msg', 'current_key']) {
      assert.ok(!src.includes(bad), `${name} uses snake_case field ${bad}`)
    }
  }
  assert.match(useApi, /researchNotes: string \| null/)
  assert.match(useApi, /budgetThb: number \| null/)
  assert.match(useApi, /mode\?: 'replace' \| 'append'/)
})

test('marketer routes are registered and reachable', () => {
  assert.match(nuxtConfig, /name: 'marketer-campaign'/)
  assert.match(nuxtConfig, /path: '\/marketer\/:id'/)
  assert.match(nuxtConfig, /views\/marketer\/campaign\.vue/)
  assert.match(layout, /to="\/marketer"/)
  assert.match(layout, /layout\.nav\.marketer/)
})

test('workspace implements the 5-step flow and polls the campaign while busy', () => {
  assert.match(workbench, /MARKETER_STEPS/)
  for (const step of ['brief', 'research', 'strategy', 'creatives', 'production']) {
    assert.match(workbench, new RegExp(`step === '${step}'|goStep\\('${step}'\\)`), `step ${step} must be reachable`)
  }
  // async: 202 → poll GET /campaigns/:id ทุก POLL_INTERVAL_MS จน status ไม่ลงท้าย -ing
  assert.match(workbench, /marketerAPI\.get\(campaignId\)/)
  assert.match(workbench, /POLL_INTERVAL_MS/)
  assert.match(workbench, /isBusyStatus/)
  assert.match(workbench, /clearTimeout\(pollTimer\)/)
  // production hand-off → episode workbench
  assert.match(workbench, /marketerAPI\.produceCreative/)
  assert.match(workbench, /navigateTo\(`\/drama\/\$\{res\.dramaId\}\/episode\/\$\{res\.episodeNumber\}`\)/)
  // reuse the shared cards
  assert.match(workbench, /<MarketerBriefForm/)
  assert.match(workbench, /<MarketerDocCard/)
  assert.match(workbench, /<MarketerCreativeCard/)
  // creatives: append vs replace
  assert.match(workbench, /runCreatives\('replace'\)/)
  assert.match(workbench, /'append'/)
})

test('document cards expose revise, approve and revision history', () => {
  const doc = components.find(([n]) => n.includes('DocCard'))[1]
  assert.match(doc, /marketerAPI\.reviseDoc/)
  assert.match(doc, /marketerAPI\.docRevisions/)
  assert.match(doc, /marketerAPI\.restoreDocRevision/)
  assert.match(doc, /setStatus\('approved'\)/)
})

test('no hardcoded UI text — every visible string goes through t()', () => {
  for (const [name, src] of uiFiles) {
    const stripped = src
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/\s\/\/ .*$/gm, '') // 行尾注释
    assert.doesNotMatch(stripped, /[฀-๿]/, `${name} has hardcoded Thai text`)
    assert.doesNotMatch(stripped, /[一-鿿]/, `${name} has hardcoded Chinese text`)
  }
})

test('no mock data in delivered code', () => {
  for (const [name, src] of uiFiles) {
    assert.doesNotMatch(src, /\bmock\w*\s*[:=]/i, `${name} contains mock data`)
    assert.doesNotMatch(src, /fixture|dummyData/i, `${name} contains fixture data`)
  }
})

test('dangerous actions go through ConfirmDialog', () => {
  assert.match(listPage, /ConfirmDialog/)
  assert.match(workbench, /ConfirmDialog/)
  assert.match(workbench, /toDeleteCreative/)
})

test('marketer.* i18n keys exist in both locales with full parity', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  const thKeys = new Set(leaves(th.marketer, 'marketer'))
  const enKeys = new Set(leaves(en.marketer, 'marketer'))
  assert.deepEqual([...thKeys].filter((k) => !enKeys.has(k)), [], 'keys missing in en.json')
  assert.deepEqual([...enKeys].filter((k) => !thKeys.has(k)), [], 'keys missing in th.json')
  for (const [name, src] of uiFiles) {
    for (const m of src.matchAll(/\bt\('(marketer\.[\w.]+)'/g)) {
      assert.ok(enKeys.has(m[1]), `en.json missing ${m[1]} (used by ${name})`)
    }
  }
  // dynamic keys: every enum value the backend can send has a label
  const enums = {
    status: ['draft', 'researching', 'research_ready', 'strategizing', 'strategy_ready', 'writing', 'creatives_ready', 'failed'],
    docKinds: ['product_brief', 'market_research', 'audience_insight', 'message_map', 'campaign_plan', 'content_brief'],
    platforms: ['tiktok', 'reels', 'youtube_shorts', 'facebook', 'shopee', 'lazada'],
    formats: ['ugc', 'product_demo', 'problem_solution', 'before_after', 'testimonial', 'unboxing'],
    creativeStatus: ['draft', 'approved', 'in_production'],
    steps: ['brief', 'research', 'strategy', 'creatives', 'production'],
  }
  for (const [group, values] of Object.entries(enums)) {
    for (const v of values) assert.equal(typeof en.marketer[group]?.[v], 'string', `marketer.${group}.${v} missing`)
  }
  assert.equal(typeof th.layout.nav.marketer, 'string')
  assert.equal(typeof en.layout.nav.marketer, 'string')
})

test('campaign error codes sent by the backend are localized', () => {
  const codes = [
    'E_CAMPAIGN_BUSY', 'E_INGEST_FAILED', 'E_STRATEGY_NEEDS_RESEARCH', 'E_CREATIVES_NEED_STRATEGY',
    'E_CREATIVE_IN_PRODUCTION', 'E_INVALID_FIELD', 'E_AGENT_UNAVAILABLE', 'E_NO_TEXT_MODEL',
  ]
  for (const c of codes) {
    assert.equal(typeof en.errors.codes[c], 'string', `en errors.codes.${c} missing`)
    assert.equal(typeof th.errors.codes[c], 'string', `th errors.codes.${c} missing`)
  }
})
