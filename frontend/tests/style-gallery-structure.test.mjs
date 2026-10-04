/**
 * Style Gallery (คลังสไตล์เลขที่) — frontend structure tests (docs/style-gallery/PLAN.md)
 * ตรวจ: gallery UI ในแท็บสไตล์ภาพ, การเจนพรีวิวผ่าน /tasks เดิม, นำเข้าคลัง, i18n parity,
 * และกติกา upstream "ห้ามมีเลขสไตล์ใน prompt" ที่ฝังใน preview composer
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

const settings = read('app/pages/settings.vue')
const useApi = read('app/composables/useApi.ts')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

test('styles tab renders the numbered gallery with search, categories and import', () => {
  assert.match(settings, /sg-grid/)
  assert.match(settings, /v-model="styleSearch"/)
  assert.match(settings, /filteredStylePresets/)
  assert.match(settings, /styleCategories/)
  assert.match(settings, /styleCategory = 'custom'/)
  assert.match(settings, /importBuiltinStyles\(\)/)
  assert.match(settings, /stylePresetAPI\.importBuiltin\(\)/)
  assert.match(settings, /sg-credit/)
  // พรีวิว: ปุ่มเจน + อัปโหลด + แสดงรูปจาก preview_path
  assert.match(settings, /genStylePreview\(p\)/)
  assert.match(settings, /pickPreviewUpload\(p\)/)
  assert.match(settings, /p\.preview_path/)
})

test('preview generation reuses the existing /tasks pipeline and stores the result', () => {
  assert.match(settings, /taskAPI\.generate\(\{ type: 'image', prompt:/)
  assert.match(settings, /taskAPI\.get\(taskId\)/)
  assert.match(settings, /task\.resultUrl \|\| task\.localPath/)
  assert.match(settings, /preview_path: outcome/)
  assert.match(settings, /uploadAPI\.image\(file\)/)
  // กติกา upstream: prompt ของพรีวิวห้ามมีเลขสไตล์ (โมเดลจะวาดเลขลงภาพ)
  const m = settings.match(/STYLE_PREVIEW_SUBJECT = '([^']+)'/)
  assert.ok(m, 'STYLE_PREVIEW_SUBJECT constant missing')
  assert.doesNotMatch(m[1], /\b\d{3}\b/)
  assert.doesNotMatch(m[1], /\b[A-Z]{2}-\d{3}\b/)
})

test('gallery i18n exists in both locales with full parity', () => {
  const thG = th.settings.styles.gallery
  const enG = en.settings.styles.gallery
  assert.deepEqual(new Set(Object.keys(thG)), new Set(Object.keys(enG)))
  for (const cat of ['FA', 'FB', 'FC', 'FD', 'FE', 'FF', 'FG', 'FH']) {
    assert.equal(typeof thG[`cat_${cat}`], 'string', `th cat_${cat} missing`)
    assert.equal(typeof enG[`cat_${cat}`], 'string', `en cat_${cat} missing`)
  }
  for (const k of ['search', 'import', 'imported', 'catAll', 'catCustom', 'genPreview', 'previewDone', 'previewFailed', 'previewTimeout', 'uploadPreview', 'credit', 'noMatch']) {
    assert.equal(typeof thG[k], 'string', `th gallery.${k} missing`)
    assert.equal(typeof enG[k], 'string', `en gallery.${k} missing`)
  }
  // credit ต้องอ้างที่มาตาม license ของต้นทาง
  assert.match(thG.credit, /yang0\/handraw-style/)
  assert.match(enG.credit, /yang0\/handraw-style/)
})

test('useApi exposes the import endpoint contract', () => {
  assert.match(useApi, /importBuiltin: \(\) => api\.post<\{ imported: number; skipped: number \}>\('\/style-presets\/import-builtin'/)
})
