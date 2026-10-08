import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ทดสอบอ่านอย่างเดียวเพื่อกัน regression (ไม่แก้ backend)
const aiConfigRoute = readFileSync(new URL('../src/core/routes/aiConfigs.ts', import.meta.url), 'utf8')
const volcengineAdapter = readFileSync(new URL('../src/core/ai/adapters/volcengine-video.ts', import.meta.url), 'utf8')

test('video presets default to direct Seedance 2.0 generation', () => {
  const combined = `${aiConfigRoute}\n${volcengineAdapter}`
  // โมเดลรุ่นเก่าที่ออกจากระบบต้องไม่กลับมา
  assert.doesNotMatch(combined, /doubao-seedance-1-5-pro-251215/)
})

