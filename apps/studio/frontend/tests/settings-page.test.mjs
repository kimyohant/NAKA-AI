/**
 * System settings page (app/pages/settings.vue, back from the separate admin/ app):
 * Covered here:
 * style presets + numbered gallery, Unsloth local provider, Seedance 2.0 presets, studio art,
 * removed features (audio/voice, grid prompts, quick-setup cards), i18n parity of settings.*.
 */
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const settings = read('app/pages/settings.vue')
const useApi = read('app/composables/useApi.ts')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))

test('style presets tab: manage presets + numbered gallery with search, categories and import', () => {
  assert.match(settings, /\{ id: 'styles', label: t\('settings\.tabs\.styles'\), icon: Palette \}/)
  for (const fn of ['startAddStyle', 'startEditStyle', 'toggleStyle', 'confirmDelStyle', 'styleToDelete']) assert.match(settings, new RegExp(fn))
  assert.match(settings, /sg-grid/)
  assert.match(settings, /v-model="styleSearch"/)
  assert.match(settings, /filteredStylePresets/)
  assert.match(settings, /styleCategory = 'custom'/)
  assert.match(settings, /stylePresetAPI\.importBuiltin\(\)/)
  assert.match(settings, /genStylePreview\(p\)/)
  assert.match(settings, /pickPreviewUpload\(p\)/)
  // backend /static files go through mediaUrl (admin may be hosted on another origin)
  assert.match(settings, /:src="mediaUrl\(p\.preview_path\)"/)
  assert.match(useApi, /importBuiltin: \(\) => api\.post<\{ imported: number; skipped: number \}>\('\/style-presets\/import-builtin'/)
})

test('style preview generation reuses /tasks and never puts a style number in the prompt', () => {
  assert.match(settings, /taskAPI\.generate\(\{ type: 'image', prompt:/)
  assert.match(settings, /taskAPI\.get\(taskId\)/)
  assert.match(settings, /preview_path: outcome/)
  assert.match(settings, /uploadAPI\.image\(file\)/)
  const m = settings.match(/STYLE_PREVIEW_SUBJECT = '([^']+)'/)
  assert.ok(m, 'STYLE_PREVIEW_SUBJECT constant missing')
  assert.doesNotMatch(m[1], /\b\d{3}\b/)
})

test('Unsloth (local) provider presets and video settings payload', () => {
  assert.match(settings, /text:\s*\[[^\]]*'unsloth'\]/)
  assert.match(settings, /image:\s*\[[^\]]*'unsloth'\]/)
  assert.match(settings, /video:\s*\[[^\]]*'unsloth'\]/)
  assert.match(settings, /unsloth: \{ label: 'Unsloth \(Local\)', baseUrl: 'http:\/\/127\.0\.0\.1:8888', models: \['unsloth\/Qwen3\.8-27B-GGUF'\] \}/)
  for (const field of ['gguf_filename', 'steps', 'quality', 'max_concurrent', 'queue_timeout_minutes']) assert.ok(settings.includes(field), field)
  assert.match(settings, /settings: buildVideoSettingsPayload\(\)/)
  assert.match(settings, /฿0 \(local\)/)
  assert.doesNotMatch(settings, /sk-[A-Za-z0-9]{12,}/)
  for (const m of settings.matchAll(/\bt\('(settings\.cfg\.unsloth\.[\w.]+)'\)/g)) {
    const get = (o) => m[1].split('.').reduce((a, k) => (a == null ? a : a[k]), o)
    assert.ok(get(th) && get(en), `missing i18n ${m[1]}`)
  }
})

test('video presets: Seedance 2.0 official endpoints, no legacy gateways', () => {
  assert.match(settings, /Seedance 2\.0 Official/)
  for (const model of ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615']) assert.ok(settings.includes(model), model)
  assert.doesNotMatch(settings, /doubao-seedance-1-5-pro-251215/)
  const presets = settings.slice(settings.indexOf('const providerPresets = {'))
  assert.doesNotMatch(presets, /api\.firemux\.com/)
  assert.match(presets, /baseUrl: 'https:\/\/ark\.cn-beijing\.volces\.com'/)
  assert.doesNotMatch(settings, /https:\/\/dashscope\.aliyuncs\.com/)
})

test('agent skill library art + style examples are bundled', () => {
  assert.match(settings, /skills-library-art/)
  assert.match(settings, /libraryArtFailed\[item\.id\] = true/)
  assert.match(settings, /coverArt\('agent', libraryAgent\.value\)/)
  assert.match(settings, /v-else-if="styleExample\(p\.value\)/)
  for (const dir of ['covers/agent', 'covers/skill-category', 'skills', 'styles']) {
    assert.ok(existsSync(new URL(`app/public/studio-art/${dir}`, root)), dir)
  }
})

test('removed features stay removed (audio/voice, grid prompts, quick-setup cards)', () => {
  for (const re of [/voice_assigner/, /音色分配/, /serviceTypes[\s\S]*audio/, /speech-2\.8-hd/, /宫格图/, /read_shots_for_grid/, /cell_prompts/, /Quick Setup/, /officialPresetCards/]) {
    assert.doesNotMatch(settings, re)
  }
  assert.match(settings, /prompt_generator/)
})

test('settings.* and admin.* i18n keys have full th/en parity', () => {
  const leaves = (o, p) => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? leaves(v, `${p}.${k}`) : [`${p}.${k}`]))
  for (const ns of ['settings', 'admin']) {
    assert.deepEqual(leaves(th[ns], ns).sort(), leaves(en[ns], ns).sort(), `${ns} parity`)
  }
  assert.match(th.settings.styles.gallery.credit, /yang0\/handraw-style/)
})
