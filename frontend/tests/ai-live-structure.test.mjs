/**
 * AI Live (docs/ai-live/PLAN.md) — frontend structure + flow helpers
 * ตรวจ: คิวสคริปต์/รอพูดจบ, หน้า /live ใช้ WHEP ผ่าน backend, ยืนยันก่อนไลฟ์จริง, token/stream key เป็น password,
 * เมนูข้าง, liveAPI ครบ endpoint, i18n th/en ครบทุก key ที่หน้าใช้
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIVE_VOICES, nextQueueIndex, waitUntilQuiet } from '../app/utils/liveFlow.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const page = read('app/pages/live.vue')
const api = read('app/composables/useApi.ts')
const layout = read('app/layouts/default.vue')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o)

test('queue index: advances, loops or ends', () => {
  assert.equal(nextQueueIndex(0, 3, false), 1)
  assert.equal(nextQueueIndex(2, 3, true), 0)
  assert.equal(nextQueueIndex(2, 3, false), null)
  assert.equal(nextQueueIndex(0, 0, true), null)
})

test('waitUntilQuiet: waits for speech to start, then to stop; stops when told', async () => {
  const sleep = async () => {}
  let seq = [false, true, true, false]
  assert.equal(await waitUntilQuiet(async () => seq.shift() ?? false, () => true, { sleep, pollMs: 100, startMs: 1000 }), true)
  assert.equal(seq.length, 0)
  // never starts speaking → gives up after startMs and moves on
  let polls = 0
  assert.equal(await waitUntilQuiet(async () => { polls++; return false }, () => true, { sleep, pollMs: 100, startMs: 300 }), true)
  assert.equal(polls, 4)
  // paused → returns false at once
  assert.equal(await waitUntilQuiet(async () => true, () => false, { sleep }), false)
})

test('voices are Edge TTS Thai neural voices with i18n labels', () => {
  for (const v of LIVE_VOICES) {
    assert.match(v.id, /^th-TH-[A-Za-z]+Neural$/)
    assert.equal(typeof get(th, v.label), 'string')
    assert.equal(typeof get(en, v.label), 'string')
  }
})

test('liveAPI covers every backend route; WHEP sends raw SDP', () => {
  for (const p of ['/live/config', '/live/status', '/live/start', '/live/stop', '/live/say', '/live/interrupt', '/live/speaking',
    '/live/push/start', '/live/push/stop', '/live/free-gpu', '/live/script', '/live/answer', '/live/whep']) {
    assert.ok(api.includes(p), `missing ${p}`)
  }
  assert.match(api, /'Content-Type': 'application\/sdp'/)
})

test('page: preview over WHEP, confirm before going live, secrets are password fields', () => {
  assert.match(page, /new RTCPeerConnection\(\)/)
  assert.match(page, /addTransceiver\('video', \{ direction: 'recvonly' \}\)/)
  assert.match(page, /liveAPI\.whep\(/)
  assert.match(page, /<ConfirmDialog[\s\S]*?@confirm="startPush"/)
  assert.match(page, /v-model="form\.token"[^>]*type="password"/)
  assert.match(page, /v-model="form\.rtmpUrl"[^>]*type="password"/)
  assert.match(page, /waitUntilQuiet\(isSpeakingNow/)
  assert.match(page, /onBeforeUnmount\([\s\S]*?closePreview\(\)/)
})

test('sidebar links to /live; every t() key on the page exists in th and en', () => {
  assert.match(layout, /<NuxtLink to="\/live"/)
  assert.equal(typeof th.layout.nav.live, 'string')
  const keys = [...new Set([...page.matchAll(/t\('([a-zA-Z0-9_.]+)'/g)].map(m => m[1]))]
  assert.ok(keys.length > 50)
  for (const k of keys) {
    assert.equal(typeof get(th, k), 'string', `th missing ${k}`)
    assert.equal(typeof get(en, k), 'string', `en missing ${k}`)
  }
})
