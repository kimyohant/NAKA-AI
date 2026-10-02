import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

// ทดสอบอ่านอย่างเดียวเพื่อกัน regression (ไม่แก้ backend)
const settingsPage = readFileSync(new URL('../app/pages/settings.vue', import.meta.url), 'utf8')
const aiConfigRoute = readFileSync(new URL('../../backend/src/routes/aiConfigs.ts', import.meta.url), 'utf8')
const volcengineAdapter = readFileSync(new URL('../../backend/src/services/adapters/volcengine-video.ts', import.meta.url), 'utf8')

test('video presets default to direct Seedance 2.0 generation', () => {
  const combined = `${settingsPage}\n${aiConfigRoute}\n${volcengineAdapter}`
  // โมเดลรุ่นเก่าที่ออกจากระบบต้องไม่กลับมา
  assert.doesNotMatch(combined, /doubao-seedance-1-5-pro-251215/)
  // preset ทางการ Volcengine Ark มี Seedance 2.0 ครบทั้งสามรุ่น
  assert.match(settingsPage, /Seedance 2\.0 Official/)
  assert.match(settingsPage, /doubao-seedance-2-0-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-fast-260128/)
  assert.match(settingsPage, /doubao-seedance-2-0-mini-260615/)
})

test('video presets use official provider endpoints', () => {
  const providerPresets = settingsPage.slice(settingsPage.indexOf('const providerPresets = {'))
  // ไม่กลับไปใช้เกตเวย์ตัวกลาง
  assert.doesNotMatch(providerPresets, /api\.firemux\.com/)
  assert.match(providerPresets, /baseUrl: 'https:\/\/ark\.cn-beijing\.volces\.com'/)
  // Wan 3.0 ทางการ Alibaba Bailian (workspace endpoint)
  assert.match(providerPresets, /https:\/\/\{WorkspaceId\}\.cn-beijing\.maas\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/dashscope\.aliyuncs\.com/)
  assert.doesNotMatch(settingsPage, /https:\/\/api\.vidu\.com/)
})
