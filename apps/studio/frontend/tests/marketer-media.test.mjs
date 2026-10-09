/**
 * ภาพ/คลิปประกอบหน้า "นักการตลาด AI" (สร้างด้วย AI บนเซิร์ฟเวอร์ของ NAKA-AI)
 * ตรวจว่า: ทุก id ใน utils/marketerMedia.js มีไฟล์จริงใน public/marketer-media, คลิปเล่นแบบปิดเสียง + เคารพ reduced-motion,
 * ปกคลิปมาแรงติดป้าย "ภาพประกอบ AI" (ไม่ใช่ thumbnail จากแพลตฟอร์ม), และไม่มี URL ภายนอก/IP ของเซิร์ฟเวอร์รั่วเข้ามา
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const publicDir = fileURLToPath(new URL('app/public/marketer-media/', root))
const mediaJs = read('menus/marketer/utils/marketerMedia.js')
const component = read('menus/marketer/components/MarketerMedia.vue')
const card = read('menus/marketer/components/MarketerTrendingCard.vue')

const listed = (name) => JSON.parse(mediaJs.match(new RegExp(`const ${name} = new Set\\((\\[[\\s\\S]*?\\])\\)`))[1])
const file = (id, ext) => join(publicDir, id.slice(0, id.indexOf('-')), `${id.slice(id.indexOf('-') + 1)}.${ext}`)

test('every listed image/clip exists in public/marketer-media, and the set is reasonably small', () => {
  for (const id of listed('IMAGES')) assert.ok(existsSync(file(id, 'webp')), `missing ${id}.webp`)
  for (const id of listed('VIDEOS')) {
    assert.ok(existsSync(file(id, 'mp4')), `missing ${id}.mp4`)
    assert.ok(existsSync(file(id, 'poster.webp')), `missing ${id} poster`)
  }
  const walk = (dir) => readdirSync(dir).flatMap(n => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [statSync(join(dir, n)).size]))
  const totalMb = walk(publicDir).reduce((a, b) => a + b, 0) / 1e6
  assert.ok(totalMb < 80, `public/marketer-media is ${totalMb.toFixed(1)} MB`)
})

test('clips are muted inline loops that never autoplay for reduced motion or save-data', () => {
  for (const attr of ['muted', 'loop', 'playsinline']) assert.match(component, new RegExp(`\\n\\s+${attr}\\r?\\n`))
  assert.match(component, /prefers-reduced-motion: reduce/)
  assert.match(component, /saveData/)
})

test('trending covers are labelled as AI illustrations', () => {
  assert.match(card, /:badge="t\('marketer\.trending\.card\.aiPreview'\)"/)
  for (const lang of ['th', 'en']) assert.ok(loadLocale(lang).marketer.trending.card.aiPreview)
})

test('media list is local paths only (no external hosts or server IPs)', () => {
  assert.doesNotMatch(mediaJs, /https?:\/\/|\b\d{1,3}(\.\d{1,3}){3}\b/)
})
