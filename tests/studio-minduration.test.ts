/**
 * scaleBeats กับ minDurationSec ของโมเดลวิดีโอ (docs/unsloth/AGENT-A-backend.md Task 5)
 * ugc_review 30s กับ H3 (min 5.17s) → ทุกช็อต ≥ 5.17s และผลรวม ≈ 30s
 * กับ provider ไม่มี minDuration → ผลเท่าเดิม (snapshot)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { scaleBeats, getStudioTemplate } from '../src/services/studio-templates.js'

const H3_MIN = 124 / 24 // ≈ 5.1667s

test('ugc_review 30s ไม่มี minDuration → snapshot เดิม [4,6,10,6,4]', () => {
  const template = getStudioTemplate('ugc_review')!
  const beats = scaleBeats(template.beats, 30)
  assert.deepEqual(beats.map(b => b.seconds), [4, 6, 10, 6, 4])
  assert.deepEqual(beats.map(b => b.role), ['hook', 'problem', 'use_product', 'result', 'cta'])
})

test('ugc_review 30s กับ H3 → ทุกช็อต ≥ 5.17s (ปัดเป็น ≥ 6s) และผลรวม = 30', () => {
  const template = getStudioTemplate('ugc_review')!
  const beats = scaleBeats(template.beats, 30, { minDurationSec: H3_MIN })
  assert.equal(beats.reduce((sum, b) => sum + b.seconds, 0), 30)
  for (const beat of beats) {
    assert.ok(
      beat.seconds >= H3_MIN,
      `shot ${beat.role} = ${beat.seconds}s must be >= ${H3_MIN.toFixed(2)}s`,
    )
  }
  // [4,6,10,6,4] → รวมคู่สั้นสุดติดกัน: hook+problem, result+cta
  assert.deepEqual(beats.map(b => b.seconds), [10, 10, 10])
  assert.deepEqual(beats.map(b => b.role), ['hook+problem', 'use_product', 'result+cta'])
})

test('ช็อตที่รวมแล้วเกิน MAX_SHOT_SECONDS ได้เฉพาะเมื่อจำเป็น (ผลรวมคงเดิมเสมอ)', () => {
  const template = getStudioTemplate('ugc_review')!
  const beats = scaleBeats(template.beats, 10, { minDurationSec: H3_MIN })
  assert.equal(beats.reduce((sum, b) => sum + b.seconds, 0), 10)
  assert.equal(beats.length, 1) // 10s / min 6s → รวมจนเหลือช็อตเดียว
  assert.ok(beats[0].seconds >= H3_MIN)
})

test('ทุก template × durationSec 10-60: ผลรวมคงเดิม + ทุกช็อต ≥ minDuration เมื่อระบุ', () => {
  for (const templateId of ['ugc_review', 'how_to_use', 'lifestyle_showcase', 'flash_deal']) {
    const template = getStudioTemplate(templateId)!
    for (let durationSec = 10; durationSec <= 60; durationSec += 5) {
      const without = scaleBeats(template.beats, durationSec)
      assert.equal(without.reduce((s, b) => s + b.seconds, 0), durationSec, `${templateId}@${durationSec} sum`)
      const withMin = scaleBeats(template.beats, durationSec, { minDurationSec: H3_MIN })
      assert.equal(withMin.reduce((s, b) => s + b.seconds, 0), durationSec, `${templateId}@${durationSec} sum with min`)
      if (withMin.length >= 1) {
        for (const beat of withMin) {
          assert.ok(beat.seconds >= H3_MIN, `${templateId}@${durationSec} shot ${beat.role}=${beat.seconds}s >= 5.17s`)
        }
      }
    }
  }
})

test('ไม่ส่ง minDurationSec → ผลลัพธ์เหมือนเรียกเดิมทุกกรณี (additive contract)', () => {
  const template = getStudioTemplate('unboxing')!
  for (let durationSec = 10; durationSec <= 60; durationSec += 7) {
    assert.deepEqual(
      scaleBeats(template.beats, durationSec),
      scaleBeats(template.beats, durationSec, {}),
    )
    assert.deepEqual(
      scaleBeats(template.beats, durationSec),
      scaleBeats(template.beats, durationSec, { minDurationSec: undefined }),
    )
  }
})
