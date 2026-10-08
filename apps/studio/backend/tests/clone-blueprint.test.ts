/**
 * Viral Clone unit tests — blueprint schema, beat merging, matrix Cartesian (docs/viral-clone/AGENT-A Task 4-5)
 */
import './_memory-db.js'
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateBlueprint,
  mergeShortBeats,
  buildMatrix,
  CLONE_MATRIX_CAP,
  type CloneBeat,
} from '../src/modules/viral-clone/services/clone.js'

const goodBeat = { id: 'b1', role: 'hook', line: 'หน้าสิวหายใน 3 วัน?', visual: 'product', visualHint: null, durationSec: 3.5 }
const goodBlueprint = {
  title: 'Acne Serum Viral',
  durationSec: 30,
  beats: [goodBeat, { id: 'b2', role: 'cta', line: 'กดตะกร้าเลย', visual: 'avatar', visualHint: 'หน้าร้าน', durationSec: 4 }],
  hooks: ['ใครยังมีสิว อย่าพลาด', '3 วันจบ จริงหรือ?'],
  captionStyle: { style: 'bold' },
}

test('validateBlueprint: blueprint ครบ schema ผ่าน', () => {
  const result = validateBlueprint(goodBlueprint)
  assert.equal(result.ok, true, result.errors.join('; '))
})

test('validateBlueprint: ฟิลด์ผิด enum/หาย/ว่าง → พร้อมระบุ field ที่พัง', () => {
  const bad = {
    beats: [
      { id: '', role: 'hookk', line: '  ', visual: 'productt', durationSec: -1 },
      { id: 'b1', role: 'demo', line: 'x', visual: 'broll', durationSec: 2 },
      { id: 'b1', role: 'demo', line: 'x', visual: 'broll', durationSec: 2 }, // id ซ้ำ
    ],
    hooks: ['', 'ok'],
    captionStyle: { style: 'fancy' },
  }
  const result = validateBlueprint(bad)
  assert.equal(result.ok, false)
  for (const needle of ['beats[0].id', 'beats[0].role', 'beats[0].line', 'beats[0].visual', 'beats[0].durationSec', 'beats[2].id duplicate', 'hooks', 'captionStyle.style']) {
    assert.ok(result.errors.some(e => e.includes(needle)), `missing error for ${needle}: ${result.errors.join('; ')}`)
  }
  assert.deepEqual(validateBlueprint(null).errors, ['blueprint must be an object'])
  assert.equal(validateBlueprint({ beats: [] }).ok, false)
})

test('mergeShortBeats: beat สั้นกว่า minDurationSec รวมติดกัน ผลรวมคงเดิม (H3 5.17s)', () => {
  const beats: CloneBeat[] = [
    { id: 'b1', role: 'hook', line: 'a', visual: 'product', visualHint: null, durationSec: 3.5 },
    { id: 'b2', role: 'demo', line: 'b', visual: 'product', visualHint: 'demo', durationSec: 4 },
    { id: 'b3', role: 'cta', line: 'c', visual: 'avatar', visualHint: null, durationSec: 6 },
  ]
  const merged = mergeShortBeats(beats, 124 / 24)
  assert.equal(merged.reduce((s, b) => s + b.durationSec, 0), 13.5)
  // 3.5 < 6 → รวมกับ b2 (ผลรวมคู่น้อยสุด) → [7.5, 6]
  assert.equal(merged.length, 2)
  assert.equal(merged[0].durationSec, 7.5)
  assert.equal(merged[0].line, 'a b')
  assert.equal(merged[0].role, 'hook', 'แรงบันดาลใจ role ตาม beat แรกของคู่')
  assert.equal(merged[0].visualHint, 'demo')
  assert.equal(merged[1].durationSec, 6)
})

test('mergeShortBeats: ทุก beat ผ่านเกณฑ์ → ไม่แตะอะไร, ไม่ส่ง minDuration → ไม่แตะ', () => {
  const beats: CloneBeat[] = [
    { id: 'b1', role: 'hook', line: 'a', visual: 'product', visualHint: null, durationSec: 6 },
    { id: 'b2', role: 'cta', line: 'b', visual: 'text', visualHint: null, durationSec: 6 },
  ]
  assert.equal(mergeShortBeats(beats, 124 / 24).length, 2)
  assert.equal(mergeShortBeats(beats, null).length, 2)
})

test('buildMatrix: Cartesian ตรง + มุมว่าง = default (นับ 1 ทางเลือก ไม่ใช่ 0)', () => {
  const { combos, count } = buildMatrix(
    { hookIndexes: [0, 1], productIds: [7], avatarIds: [], languages: ['th', 'en'] },
    { language: 'th' },
  )
  assert.equal(count, 4) // 2 hooks × 1 product × 1 (no avatar) × 2 languages
  assert.deepEqual(combos, [
    { hookIndex: 0, productId: 7, avatarId: null, language: 'th' },
    { hookIndex: 0, productId: 7, avatarId: null, language: 'en' },
    { hookIndex: 1, productId: 7, avatarId: null, language: 'th' },
    { hookIndex: 1, productId: 7, avatarId: null, language: 'en' },
  ])
  // มุมทั้งหมดว่าง → 1 ตัวแปร default
  const empty = buildMatrix({}, { language: 'th' })
  assert.deepEqual(empty.combos, [{ hookIndex: null, productId: null, avatarId: null, language: 'th' }])
  // dedupe มุมซ้ำ
  const dup = buildMatrix({ hookIndexes: [0, 0], languages: ['th'] }, { language: 'th' })
  assert.equal(dup.count, 1)
  // ค่ามั่วในมุมถูกกรอง (ไม่นับเป็นทางเลือก)
  const junk = buildMatrix({ hookIndexes: [-3, 'x', 1], languages: ['th'] }, { language: 'th' })
  assert.deepEqual(junk.combos, [{ hookIndex: 1, productId: null, avatarId: null, language: 'th' }])
})

test('buildMatrix: 2×2×2×2 = 16 เกิน cap 12, 3×2×2×1 = 12 พอดี', () => {
  const big = buildMatrix(
    { hookIndexes: [0, 1], productIds: [1, 2], avatarIds: [1, 2], languages: ['th', 'en'] },
    { language: 'th' },
  )
  assert.equal(big.count, 16)
  assert.ok(big.count > CLONE_MATRIX_CAP)
  const exact = buildMatrix(
    { hookIndexes: [0, 1, 2], productIds: [1, 2], avatarIds: [1, 2], languages: ['th'] },
    { language: 'th' },
  )
  assert.equal(exact.count, 12)
  assert.ok(exact.count <= CLONE_MATRIX_CAP)
})
