import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildVisualPrompt, visualSizeFor } from '../src/services/product-visuals.js'

/**
 * Snapshot: prompt/size ของ Marketer visuals (ย้ายจาก services/marketer.ts ตาม
 * docs/product-studio/PLAN.md ข้อ 2) ต้องเหมือนเดิมทุกตัวอักษร — Marketer และ Studio ใช้ builder เดียวกัน
 */
test('visual prompt builder output is unchanged after the product-visuals extraction', () => {
  assert.equal(
    buildVisualPrompt('packshot', null),
    'Professional e-commerce packshot photograph of the exact product shown in the reference image, on a pure white seamless background, even studio lighting, centered composition, sharp focus, subtle soft shadow. No props, no people, no added text or graphics. Keep the exact product design, label, text layout, colors and proportions from the reference image — the product must stay recognizable as the same item.',
  )
  assert.equal(
    buildVisualPrompt('on_model', 'Thai woman, 25, in a cafe'),
    'Advertising photograph of a person naturally holding or using the exact product shown in the reference image, product clearly visible, well-lit and unaltered, believable hands and posture. Keep the exact product design, label, text layout, colors and proportions from the reference image — the product must stay recognizable as the same item. Additional direction from the user: Thai woman, 25, in a cafe.',
  )
  assert.equal(
    buildVisualPrompt('lifestyle', null),
    'Lifestyle advertising photograph of the exact product shown in the reference image in a realistic usage context, product sharp and clearly visible in the foreground. Keep the exact product design, label, text layout, colors and proportions from the reference image — the product must stay recognizable as the same item.',
  )
})

test('visual size mapping is unchanged', () => {
  assert.equal(visualSizeFor(null, 'packshot'), '1024x1024')
  assert.equal(visualSizeFor('9:16', 'on_model'), '1024x1820')
  assert.equal(visualSizeFor('1:1', 'on_model'), '1024x1024')
  assert.equal(visualSizeFor('16:9', 'on_model'), '1820x1024')
  assert.equal(visualSizeFor('16:9', 'packshot'), '1024x1024') // packshot สี่เหลี่ยมจัตุรัสเสมอ
})
