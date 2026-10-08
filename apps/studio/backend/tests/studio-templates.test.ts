import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  STUDIO_TEMPLATES, getStudioTemplate, scaleBeats, templateDurationSec,
  STUDIO_LANGUAGES, STUDIO_MARKETS, STUDIO_PLATFORMS,
} from '../src/modules/product-studio/services/studio-templates.js'

/**
 * ชื่อ role ต้องตรงกับ "รายการที่ Agent B ส่งมา" (frontend แปลผ่าน
 * productStudio.templates.<id>.beats.<role>) — ต่างแม้ตัวเดียว UI จะแสดง role ดิบ
 */
const AGENT_B_ROLE_LIST: Record<string, string[]> = {
  ugc_review: ['hook', 'problem', 'use_product', 'result', 'cta'],
  unboxing: ['hook', 'unbox', 'reveal', 'details', 'cta'],
  before_after: ['hook', 'during', 'after', 'cta'],
  problem_solution: ['problem', 'intro', 'solve', 'cta'],
  how_to_use: ['hook', 'step1', 'step2', 'step3', 'cta'],
  three_reasons: ['hook', 'reason1', 'reason2', 'reason3', 'cta'],
  comparison: ['hook', 'generic', 'ours', 'cta'],
  try_on: ['hook', 'try', 'show', 'cta'],
  creator_story: ['story', 'turning_point', 'result', 'cta'],
  lifestyle_showcase: ['scene1', 'scene2', 'scene3', 'packshot'],
  asmr_closeup: ['macro', 'texture', 'sound', 'packshot'],
  flash_deal: ['hook', 'show', 'offer', 'cta'],
}

test('12 templates ตรงตาม PLAN ข้อ 3 + role strings ตรงรายการของ Agent B', () => {
  assert.equal(STUDIO_TEMPLATES.length, 12)
  assert.equal(new Set(STUDIO_TEMPLATES.map(t => t.id)).size, 12)
  const categories = new Set(STUDIO_TEMPLATES.map(t => t.category))
  for (const cat of ['review', 'demo', 'fashion_beauty', 'showcase', 'promo']) {
    assert.ok(categories.has(cat), `missing category ${cat}`)
  }
  for (const template of STUDIO_TEMPLATES) {
    const expected = AGENT_B_ROLE_LIST[template.id]
    assert.ok(expected, `unknown template ${template.id}`)
    assert.deepEqual(template.beats.map(b => b.role), expected, `${template.id} role strings ต้องตรงรายการของ Agent B`)
    assert.ok(template.beats.every(b => b.seconds > 0))
    assert.equal(template.beats.every(b => typeof b.seconds === 'number'), true)
    assert.ok(['required', 'optional', 'hands', 'none'].includes(template.avatarMode))
    assert.ok(template.platforms.length > 0)
    // asmr_closeup ไม่มีบทพูดตาม PLAN; ชนิดอื่นมี
    if (template.id === 'asmr_closeup') assert.equal(template.hasDialogue, false)
    else assert.equal(template.hasDialogue, true)
  }
  // avatar modes ตามตาราง PLAN ข้อ 3
  assert.equal(getStudioTemplate('ugc_review')?.avatarMode, 'required')
  assert.equal(getStudioTemplate('unboxing')?.avatarMode, 'hands')
  assert.equal(getStudioTemplate('lifestyle_showcase')?.avatarMode, 'none')
  assert.equal(getStudioTemplate('before_after')?.avatarMode, 'optional')
  assert.equal(getStudioTemplate('flash_deal')?.category, 'promo')
  assert.equal(getStudioTemplate('try_on')?.category, 'fashion_beauty')
  assert.equal(getStudioTemplate('nope'), null)
})

test('scaleBeats: ผลรวม = durationSec, แต่ละช็อต ≥ 2s, deterministic', () => {
  for (const template of STUDIO_TEMPLATES) {
    for (const duration of [10, 17, 24, 30, 45, 60]) {
      const scaled = scaleBeats(template.beats, duration)
      assert.equal(scaled.length, template.beats.length, `${template.id}@${duration}`)
      assert.equal(scaled.map(b => b.role).join(','), template.beats.map(b => b.role).join(','))
      assert.equal(templateDurationSec(scaled), duration, `${template.id}@${duration} ผลรวมต้องเท่า durationSec`)
      assert.ok(scaled.every(b => b.seconds >= 2), `${template.id}@${duration} ทุกช็อต ≥ 2s`)
      assert.ok(scaled.every(b => Number.isInteger(b.seconds)))
    }
  }
  // deterministic: เรียกซ้ำได้ผลเดิม
  const t = STUDIO_TEMPLATES[0]
  assert.deepEqual(scaleBeats(t.beats, 30), scaleBeats(t.beats, 30))
  // สัดส่วนคงอัตราส่วนเดิมโดยประมาณ (ช็อตที่ยาวสุดยังยาวสุด)
  const scaled = scaleBeats(t.beats, 60)
  assert.equal(scaled[2].role, 'use_product')
  assert.equal(Math.max(...scaled.map(b => b.seconds)), scaled.find(b => b.role === 'use_product')?.seconds)
})

test('options: languages / markets / platforms ครบ', () => {
  assert.equal(STUDIO_LANGUAGES.length, 12)
  assert.equal(STUDIO_MARKETS.length, 15)
  assert.equal(STUDIO_PLATFORMS.length, 8)
  assert.ok(STUDIO_MARKETS.every(m => m.currency && m.defaultLanguage))
  assert.ok(STUDIO_PLATFORMS.every(p => ['9:16', '1:1', '16:9'].includes(p.defaultAspect) && p.maxDurationSec >= 60))
  assert.ok(STUDIO_MARKETS.find(m => m.id === 'TH')?.defaultLanguage === 'th')
})
