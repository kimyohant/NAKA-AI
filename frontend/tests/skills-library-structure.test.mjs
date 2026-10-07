/**
 * Skills Library (เมนู "คลังสกิล" แทน "สตูดิโอสินค้า") — structure tests
 *
 * ตรวจ: แท็บ skills เป็นค่าเริ่มต้นของ /studio, เลือกสกิลเทมเพลต → เปิดฟอร์มสร้างพร้อมเทมเพลต,
 * workflow ทุกตัวชี้ route/แท็บที่มีจริง, i18n th/en ครบ, เมนูเปลี่ยนชื่อแล้ว
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const page = read('app/pages/studio.vue')
const library = read('app/components/StudioSkillsLibrary.vue')
const card = read('app/components/StudioSkillCard.vue')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

test('studio page defaults to the skills tab and wires the library', () => {
  assert.match(page, /isTab\(route\.query\.tab\) \? route\.query\.tab : 'skills'/)
  assert.match(page, /<StudioSkillsLibrary/)
  assert.match(page, /@use-template="useTemplate"/)
  // สกิลวิดีโอสินค้า → AI นักขาย (คลังสกิลรวมกับ AI นักขาย)
  assert.match(page, /navigateTo\(\{ path: '\/seller', query: \{ skill: tpl\.id \} \}\)/)
  // ปุ่มสร้างต้องไม่ส่ง MouseEvent เป็น templateId
  assert.ok(!/@click="openCreate"/.test(page))
})

test('library: search, category chips, workflows point at real routes/tabs', () => {
  assert.match(library, /v-model="query"/)
  assert.match(library, /sl-chip/)
  assert.match(library, /templateArt\(tpl\.id\)/)
  for (const r of ["'/seller'", "'/'", "'/marketer'", "'/viral-clone'", "'/live'"]) assert.ok(library.includes(`route: ${r}`), r)
  for (const tab of ["'avatars'", "'influencers'"]) assert.ok(library.includes(`tab: ${tab}`), tab)
  assert.match(card, /productStudio\.library\.use/)
})

test('menu is renamed and library i18n is symmetric', () => {
  assert.equal(th.layout.nav.studio, 'คลังสกิล')
  assert.equal(en.layout.nav.studio, 'Skills Library')
  const leaves = (o, p = '') => Object.entries(o).flatMap(([k, v]) => typeof v === 'object' ? leaves(v, `${p}.${k}`) : [`${p}.${k}`])
  assert.deepEqual(leaves(th.productStudio.library).sort(), leaves(en.productStudio.library).sort())
  for (const id of ['seller', 'drama', 'marketer', 'viralClone', 'live', 'avatar', 'influencer']) {
    for (const loc of [th, en]) assert.ok(loc.productStudio.library.workflows[id].name.trim())
  }
  assert.ok(th.productStudio.tabs.skills && en.productStudio.tabs.skills)
})
