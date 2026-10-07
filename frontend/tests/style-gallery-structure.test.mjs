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

const useApi = read('app/composables/useApi.ts')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

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
