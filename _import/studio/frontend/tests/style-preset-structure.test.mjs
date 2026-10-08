import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('project creation dialog only asks for title and visual style', () => {
  const page = read('app/pages/index.vue')

  // dialog ผ่าน i18n ทั้งหมด (ตัวติดตั้งใหม่ไม่ hardcode จีน)
  assert.match(page, /t\('index\.createDialog\.title'\)/)
  assert.match(page, /t\('index\.createDialog\.style'\)/)
  assert.match(page, /v-model="form\.style"/)
  assert.doesNotMatch(page, /total_episodes/)
  assert.doesNotMatch(page, /计划集数/)
  // 硬编码风格列表已移除，预设来自 API
  assert.doesNotMatch(page, /\['realistic', 'anime'/)
  assert.match(page, /stylePresetAPI/)
  assert.match(page, /stylePresetAPI\.list\(\)/)
  assert.match(page, /styleLabel\(d\.style\)/)
})

test('useApi exposes style preset endpoints', () => {
  const useApi = read('app/composables/useApi.ts')

  assert.match(useApi, /stylePresetAPI/)
  assert.match(useApi, /\/style-presets/)
  assert.match(useApi, /\?all=1/)
})

