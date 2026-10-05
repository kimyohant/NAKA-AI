/**
 * Unsloth (local) provider — frontend structure tests (docs/unsloth/PLAN.md)
 *
 * ตรวจ: provider อยู่ในรายการ settings, ฟิลด์ settings วิดีโอครบ, ไม่มี key/IP จริงหลุด,
 * i18n parity (รวม error codes ใหม่ 3 ตัว), logic ล้วนใน unslothFlow.js รันจริง,
 * Studio/episode/Marketer wiring ครบตาม brief
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  UNSLOTH_PROVIDER, UNSLOTH_VIDEO_DEFAULTS, isLocalOrPrivateBaseUrl,
  estimateRenderSeconds, estimateRenderMinutes, shotsBelowMinDuration,
} from '../app/utils/unslothFlow.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const settingsPage = read('app/pages/settings.vue')
const useApi = read('app/composables/useApi.ts')
const providerIcon = read('app/composables/useProviderIcon.ts')
const unslothFlow = read('app/utils/unslothFlow.js')
const workspace = read('app/views/studio/workspace.vue')
const shotCard = read('app/components/StudioShotCard.vue')
const episode = read('app/views/drama/episode.vue')
const campaign = read('app/views/marketer/campaign.vue')
const docCard = read('app/components/MarketerDocCard.vue')
const refCard = read('app/components/MarketerReferenceCard.vue')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

test('provider unsloth is offered for text, image and video with local defaults', () => {
  assert.match(settingsPage, /text:\s*\[[^\]]*'unsloth'\]/)
  assert.match(settingsPage, /image:\s*\[[^\]]*'unsloth'\]/)
  assert.match(settingsPage, /video:\s*\[[^\]]*'unsloth'\]/)
  // image preset: local base URL — ชื่อโมเดลผู้ใช้พิมพ์เอง (ยังไม่รู้ชื่อ image GGUF ของ server)
  assert.match(settingsPage, /unsloth: \{ label: 'Unsloth \(Local\)', baseUrl: 'http:\/\/127\.0\.0\.1:8888', models: \[\] \}/)
  // presets: loopback base + โมเดลตาม PLAN ข้อ 1
  assert.match(settingsPage, /unsloth: \{ label: 'Unsloth \(Local\)', baseUrl: 'http:\/\/127\.0\.0\.1:8888', models: \['unsloth\/Qwen3\.8-27B-GGUF'\] \}/)
  assert.match(settingsPage, /unsloth: \{ label: 'Unsloth \(Local\)', baseUrl: 'http:\/\/127\.0\.0\.1:8888', models: \['unsloth\/MiniMax-H3-GGUF'\] \}/)
  assert.match(useApi, /StudioOptions[\s\S]*?videoProvider\?/)
})

test('video settings fields and payloads are complete', () => {
  for (const field of ['gguf_filename', 'steps', 'quality', 'max_concurrent', 'queue_timeout_minutes']) {
    assert.ok(settingsPage.includes(field), `settings.vue missing ${field}`)
  }
  assert.match(settingsPage, /buildVideoSettingsPayload/)
  assert.match(settingsPage, /settings: buildVideoSettingsPayload\(\)/)
  // ราคา local = 0 และแสดง ฿0 (local)
  assert.match(settingsPage, /฿0 \(local\)/)
  assert.match(settingsPage, /effectivePrice = isUnslothMedia \? 0 : unitPrice/)
  // test payload แนบ settings ให้ backend เช็ค gguf ได้
  assert.match(settingsPage, /settings: buildVideoSettingsPayload\(\) \}/)
})

test('no real API keys or public server IPs in delivered code', () => {
  for (const [name, src] of [['settings.vue', settingsPage], ['unslothFlow.js', unslothFlow]]) {
    assert.doesNotMatch(src, /sk-[A-Za-z0-9]{12,}/, `${name} contains an API key`)
    // IPv4 literal ต้องเป็น loopback/private เท่านั้น (ห้าม IP จริงของ server)
    for (const m of src.matchAll(/https?:\/\/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g)) {
      const octets = m[1].split('.').map(Number)
      const isPrivate = octets[0] === 127 || octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      assert.ok(isPrivate, `${name} contains a public IP literal: ${m[1]}`)
    }
  }
})

test('unslothFlow: local/private URL detection', () => {
  assert.equal(isLocalOrPrivateBaseUrl('http://127.0.0.1:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://localhost:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://[::1]:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://10.1.2.3:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://192.168.0.9:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://172.20.0.1:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://nas.local:8888'), true)
  assert.equal(isLocalOrPrivateBaseUrl('http://203.0.113.7:8888'), false)
  assert.equal(isLocalOrPrivateBaseUrl('http://172.32.0.1:8888'), false)
  assert.equal(isLocalOrPrivateBaseUrl('not a url'), false)
  assert.equal(isLocalOrPrivateBaseUrl(''), false)
})

test('unslothFlow: render time estimation and min-duration helpers', () => {
  assert.equal(estimateRenderSeconds(6, 716), 4296)
  assert.equal(estimateRenderMinutes(6, 716), 72)
  assert.equal(estimateRenderMinutes(0, 716), 0)
  assert.equal(estimateRenderMinutes(5, 0), 0)
  assert.equal(estimateRenderSeconds(3.7, 10), 40)
  const short = [{ durationSec: 4 }, { durationSec: 6 }, { durationSec: 0 }]
  assert.equal(shotsBelowMinDuration(short, 5.17).length, 1)
  assert.deepEqual(shotsBelowMinDuration(short, 0), [])
  assert.equal(UNSLOTH_VIDEO_DEFAULTS.steps, 20)
  assert.equal(UNSLOTH_VIDEO_DEFAULTS.max_concurrent, 1)
})

test('queue status reaches Studio shot cards and episode workbench', () => {
  assert.match(useApi, /videoQueuePosition\?: number \| null/)
  assert.match(useApi, /videoProvider\?: StudioVideoProviderInfo \| null/)
  assert.match(shotCard, /videoQueuePosition/)
  assert.match(workspace, /estimateRenderMinutes/)
  assert.match(workspace, /videoProvider/)
  assert.match(workspace, /queuedVideoCount/)
  assert.match(episode, /queuePosition: t\.queue_position \?\? null/)
  assert.match(episode, /taskQueuePosition\(row\)/)
})

test('marketer revise/analyze go async with page-level polling', () => {
  assert.match(useApi, /reviseDoc: \(id: number, docId: number, instruction: string, asyncMode = true\)/)
  assert.match(useApi, /analyzeReference: \(id: number, refId: number, asyncMode = true\)/)
  assert.match(docCard, /reviseDoc\(props\.campaignId, props\.doc\.id, text, true\)/)
  assert.match(refCard, /analyzeReference\(props\.campaignId, props\.adRef\.id, true\)/)
  assert.match(useApi, /revising\?: boolean/)
  assert.match(useApi, /analyzing\?: boolean/)
  assert.match(docCard, /props\.doc\?\.revising/)
  assert.match(refCard, /props\.adRef\?\.analyzing/)
  assert.match(campaign, /@async-started="onJobAsyncStarted"/)
  assert.match(campaign, /anyDocBusy/)
})

test('unsloth i18n keys exist in both locales with full parity', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  const thAll = new Set(leaves(th, '').map(k => k.replace(/^\./, '')))
  const enAll = new Set(leaves(en, '').map(k => k.replace(/^\./, '')))
  for (const group of ['settings.cfg.unsloth', 'productStudio.settings']) {
    const [top, ...rest] = group.split('.')
    const sub = rest.join('.')
    for (const [loc, all] of [['th', thAll], ['en', enAll]]) {
      const base = sub ? getObj(loc === 'th' ? th : en, `${top}.${sub}`) : getObj(loc === 'th' ? th : en, top)
      assert.ok(base, `${group} missing in ${loc}`)
    }
  }
  function getObj(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o) }
  // ทุก key ที่ settings.vue / workspace.vue ใช้ต้องมีจริง
  for (const [name, src, re] of [
    ['settings.vue', settingsPage, /\bt\('settings\.cfg\.unsloth\.[\w.]+[']*'\)/g],
    ['workspace.vue', workspace, /\bt\('productStudio\.settings\.[\w.]+[']*'\)/g],
  ]) {
    for (const m of src.matchAll(re)) {
      const key = m[0].replace(/\bt\('/, '').replace(/'\)$/, '').replace(/'$/, '')
      assert.ok(thAll.has(key) && enAll.has(key), `missing i18n key ${key} (used by ${name})`)
    }
  }
  for (const c of ['E_LOCAL_PROVIDER_UNREACHABLE', 'E_LOCAL_MODEL_NOT_DOWNLOADED', 'E_VIDEO_QUEUE_TIMEOUT']) {
    assert.equal(typeof en.errors.codes[c], 'string', `en errors.codes.${c} missing`)
    assert.equal(typeof th.errors.codes[c], 'string', `th errors.codes.${c} missing`)
  }
})
