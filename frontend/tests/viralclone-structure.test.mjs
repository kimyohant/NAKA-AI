/**
 * Viral Clone Studio (สตูดิโอโคลนไวรัล) — frontend structure tests (docs/viral-clone/PLAN.md)
 *
 * ตรวจ: nav + route registration, endpoint surface ครบตาม PLAN §3, logic ล้วนใน viralCloneFlow.js
 * รันจริง, ไม่ชนชื่อ auto-import กับ flow อื่น, i18n th/en parity, ไม่มี key/IP จริงหลุด
 */
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CLONE_MATRIX_CAP, cloneErrorCodeOf, matrixVariantCount, matrixOverCap,
  beatsTotalSeconds, usableHooks, isValidBlueprint, isCloneProjectBusy, isCloneVariantBusy,
} from '../app/utils/viralCloneFlow.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const layout = read('app/layouts/default.vue')
const nuxtConfig = read('nuxt.config.ts')
const useApi = read('app/composables/useApi.ts')
const flow = read('app/utils/viralCloneFlow.js')
const listPage = read('app/pages/viral-clone.vue')
const workspace = read('app/views/viralclone/workspace.vue')
const editor = read('app/components/ViralCloneBlueprintEditor.vue')
const matrix = read('app/components/ViralCloneMatrixBuilder.vue')
const card = read('app/components/ViralCloneVariantCard.vue')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

const NEW_FILES = { listPage, workspace, editor, matrix, card }

test('nav link + dynamic route are registered', () => {
  assert.match(layout, /to="\/viral-clone"/)
  assert.match(layout, /isViralCloneRoute/)
  assert.match(layout, /\bCopy\b/)
  assert.match(nuxtConfig, /viralclone-workspace/)
  assert.match(nuxtConfig, /\/viral-clone\/:id/)
  assert.ok(existsSync(new URL('app/views/viralclone/workspace.vue', root)), 'workspace view missing')
  assert.ok(existsSync(new URL('app/pages/viral-clone.vue', root)), 'list page missing')
})

test('cloneAPI covers every endpoint in PLAN §3', () => {
  const endpoints = [
    "'/clone/projects'",
    '`/clone/projects/${id}`',
    '`/clone/projects/${id}/analyze`',
    '`/clone/projects/${id}/blueprint`',
    '`/clone/projects/${id}/variants`',
    '`/clone/projects/${id}/render-all`',
    '`/clone/variants/${variantId}/render`',
    '`/clone/variants/${variantId}`',
  ]
  for (const ep of endpoints) assert.ok(useApi.includes(ep), `useApi missing endpoint ${ep}`)
  // ปุ่ม async ตามสัญญา (202 + poll)
  assert.match(useApi, /analyze: \(id: number, asyncMode = true\)/)
  assert.match(useApi, /renderVariant: \(variantId: number, asyncMode = true\)/)
  // types
  for (const t of ['CloneProject', 'CloneVariant', 'CloneBlueprint', 'CloneMatrix', 'CloneDetail']) {
    assert.match(useApi, new RegExp(`(interface|type) ${t}\\b`), `missing type ${t}`)
  }
  assert.match(useApi, /queuePosition\?: number \| null/)
})

test('viralCloneFlow: pure logic runs for real', () => {
  assert.equal(matrixVariantCount(null), 0)
  // ไม่เลือกมุมไหน = ใช้ default ของโปรเจกต์ (นับ 1)
  assert.equal(matrixVariantCount({}), 1)
  assert.equal(matrixVariantCount({ hookIndexes: [0, 1], productIds: [3, 7], avatarIds: [], languages: ['th', 'en'] }), 8)
  assert.equal(matrixOverCap({ hookIndexes: Array(13).fill(0) }), true)
  assert.equal(matrixOverCap({}), false)
  assert.equal(CLONE_MATRIX_CAP, 12)

  const bp = {
    beats: [
      { id: 'b1', role: 'hook', line: 'สวัสดี', visual: 'avatar', visualHint: null, durationSec: 2.5 },
      { id: 'b2', role: 'demo', line: 'สาธิต', visual: 'product', visualHint: null, durationSec: 4 },
      { id: 'b3', role: 'cta', line: '', visual: 'text', visualHint: null, durationSec: 1.5 },
    ],
    hooks: ['hook ใหม่', '   ', 'hook ที่สาม'],
  }
  assert.equal(beatsTotalSeconds(bp), 8)
  assert.equal(beatsTotalSeconds(null), 0)
  assert.equal(beatsTotalSeconds({ beats: [{ durationSec: Number.NaN }] }), 0)
  assert.deepEqual(usableHooks(bp), ['hook ใหม่', 'hook ที่สาม'])
  assert.equal(isValidBlueprint(bp), true)
  assert.equal(isValidBlueprint({ ...bp, beats: [...bp.beats, { id: 'b4', role: 'nope', line: '', visual: 'text', visualHint: null, durationSec: 1 }] }), false)
  assert.equal(isValidBlueprint({ ...bp, beats: [{ ...bp.beats[0], durationSec: 0 }] }), false)
  assert.equal(isValidBlueprint(null), false)

  assert.equal(isCloneProjectBusy('analyzing'), true)
  assert.equal(isCloneProjectBusy('ready'), false)
  assert.equal(isCloneVariantBusy('queued'), true)
  assert.equal(isCloneVariantBusy('rendering'), true)
  assert.equal(isCloneVariantBusy('completed'), false)

  assert.equal(cloneErrorCodeOf('E_CLONE_ANALYZE_FAILED: bad json'), 'E_CLONE_ANALYZE_FAILED')
  assert.equal(cloneErrorCodeOf('plain message'), null)
  assert.equal(cloneErrorCodeOf(null), null)
})

test('no auto-import name collisions with other flow utils', () => {
  const exportsOf = (src) => [...src.matchAll(/export\s+(?:const|function|let)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
  const mine = new Set(exportsOf(flow))
  assert.ok(mine.size >= 8, 'viralCloneFlow should export its helpers')
  for (const other of ['app/utils/marketerFlow.js', 'app/utils/studioFlow.js', 'app/utils/unslothFlow.js']) {
    const theirs = exportsOf(read(other))
    const clash = theirs.filter((name) => mine.has(name))
    assert.deepEqual(clash, [], `export name clash with ${other}: ${clash.join(', ')}`)
  }
})

test('pages and components are wired to the flow utils and api', () => {
  assert.match(listPage, /uploadAPI\.video\(file\)/)
  assert.match(listPage, /cloneAPI\.list\(\)/)
  assert.match(listPage, /isCloneProjectBusy/)
  assert.match(workspace, /CLONE_POLL_INTERVAL_MS/)
  assert.match(workspace, /cloneAPI\.analyze\(projectId\)/)
  assert.match(workspace, /cloneAPI\.renderAll\(projectId\)/)
  assert.match(workspace, /isCloneVariantBusy/)
  assert.match(matrix, /matrixVariantCount/)
  assert.match(matrix, /matrixOverCap/)
  assert.match(editor, /isValidBlueprint/)
  assert.match(editor, /beatsTotalSeconds/)
  assert.match(card, /cloneErrorCodeOf/)
  assert.match(card, /isCloneVariantBusy/)
})

test('no real API keys or public server IPs in new files', () => {
  for (const [name, src] of Object.entries(NEW_FILES)) {
    assert.doesNotMatch(src, /sk-[A-Za-z0-9]{12,}/, `${name} contains an API key`)
    for (const m of src.matchAll(/https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g)) {
      const octets = m[1].split('.').map(Number)
      const isPrivate = octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      assert.ok(isPrivate, `${name} contains a public IP literal: ${m[1]}`)
    }
  }
})

function leaves(obj, prefix = '') {
  const out = new Set()
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object') for (const s of leaves(v, key)) out.add(s)
    else out.add(key)
  }
  return out
}

test('viralClone i18n exists in both locales with full parity', () => {
  const thAll = leaves(th)
  const enAll = leaves(en)
  // ทั้ง subtree ต้อง parity กัน
  const thNs = [...thAll].filter((k) => k.startsWith('viralClone.'))
  const enNs = [...enAll].filter((k) => k.startsWith('viralClone.'))
  assert.ok(thNs.length >= 80, `too few viralClone keys in th (${thNs.length})`)
  assert.deepEqual(new Set(thNs), new Set(enNs), 'viralClone th/en parity mismatch')
  // สถานะ 8 ตัวครบ
  for (const s of ['draft', 'analyzing', 'ready', 'error', 'queued', 'rendering', 'completed', 'failed']) {
    assert.ok(thNs.includes(`viralClone.status.${s}`) && enNs.includes(`viralClone.status.${s}`), `status ${s} missing`)
  }
  // nav + error codes
  assert.equal(typeof th.layout.nav.viralClone, 'string')
  assert.equal(typeof en.layout.nav.viralClone, 'string')
  for (const code of ['E_CLONE_ANALYZE_FAILED', 'E_CLONE_MATRIX_TOO_LARGE']) {
    assert.equal(typeof th.errors.codes[code], 'string', `th errors.codes.${code} missing`)
    assert.equal(typeof en.errors.codes[code], 'string', `en errors.codes.${code} missing`)
  }
  // ทุก key ที่ไฟล์ใหม่ใช้ต้องมีจริง (ยกเว้น dynamic `tab_${tab}` — เช็กแยกด้านล่าง)
  for (const [name, src] of Object.entries(NEW_FILES)) {
    for (const m of src.matchAll(/\bt\('viralClone\.[\w.]+[']*'/g)) {
      const key = m[0].replace(/\bt\('/, '').replace(/'$/, '').replace(/'$/, '')
      assert.ok(thAll.has(key) && enAll.has(key), `missing i18n key ${key} (used by ${name})`)
    }
  }
  for (const tab of ['blueprint', 'variants', 'reference']) {
    assert.ok(thAll.has(`viralClone.work.tab_${tab}`) && enAll.has(`viralClone.work.tab_${tab}`), `tab key ${tab} missing`)
  }
})
