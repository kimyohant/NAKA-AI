/**
 * Viral Clone structure test — endpoint surface + wiring ตามสัญญา (docs/viral-clone/PLAN.md §3 + Notes from Agent B)
 * security scan ครอบโดย tests/unsloth-security.test.mjs (สแกน backend/** ทั้งหมด)
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('routes/clone.ts ครบ endpoint ตามสัญญา (รวม DELETE + PUT/PATCH ของ Agent B)', () => {
  const routes = read('src/modules/viral-clone/routes/clone.ts')
  for (const endpoint of [
    "app.post('/projects'",
    "app.get('/projects'",
    "app.get('/projects/:id'",
    "app.put('/projects/:id'",
    "app.patch('/projects/:id'",
    "app.delete('/projects/:id'",
    "app.post('/projects/:id/analyze'",
    "app.put('/projects/:id/blueprint'",
    "app.post('/projects/:id/variants'",
    "app.post('/projects/:id/render-all'",
    "app.post('/variants/:id/render'",
    "app.delete('/variants/:id'",
  ]) {
    assert.ok(routes.includes(endpoint), `missing endpoint: ${endpoint}`)
  }
  // async endpoints → 202 accepted
  assert.match(routes, /accepted\(c, project\)/)
  assert.match(routes, /accepted\(c, result\)/)
  // mount path
  const index = ['src/index.ts', 'src/modules.ts', ...['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live'].map(m => `src/modules/${m}/index.ts`)].map(read).join('\n')
  assert.match(index, /import clone from '\.\/routes\/clone\.js'/)
  assert.match(index, /api\.route\('\/clone', clone\)/)
})

test('clone service: kind + boot-resume + error codes + สัญญา field', () => {
  const service = read('src/modules/viral-clone/services/clone.ts')
  // pipeline kinds
  const pipeline = read('src/core/tasks/pipeline-tasks.ts')
  assert.match(pipeline, /'clone_analyze' \| 'clone_render'/)
  assert.match(pipeline, /RESUMABLE_PIPELINE_KINDS: PipelineTaskKind\[\] = \['studio_render', 'clone_render'\]/)
  // boot wiring
  const index = ['src/index.ts', 'src/modules.ts', ...['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live'].map(m => `src/modules/${m}/index.ts`)].map(read).join('\n')
  assert.match(index, /failStaleCloneAnalyzes/)
  assert.match(index, /resumeStaleCloneRenders/)
  // error codes ใหม่ตาม PLAN + ที่ Agent A เพิ่ม
  for (const code of ['E_CLONE_ANALYZE_FAILED', 'E_CLONE_MATRIX_TOO_LARGE', 'E_CLONE_BUSY', 'E_CLONE_TRANSLATE_FAILED']) {
    assert.ok(service.includes(code), `missing code: ${code}`)
  }
  // cap 12
  assert.match(service, /CLONE_MATRIX_CAP = 12/)
  // i18n: ห้ามใช้ namespace อื่นฝั่ง backend (guard ความผิดพลาด)
  assert.doesNotMatch(service, /productStudio\./)
})

test('agents: viral_cloner + viral_translator ลงทะเบียนครบทุกจุด', () => {
  const agents = read('src/core/agents/index.ts')
  for (const needle of ["viral_cloner: {", "viral_translator: {"]) {
    const count = agents.split(needle).length - 1
    assert.equal(count, 2, `${needle} ต้องมีทั้งใน DEFAULT_PROMPTS และ AGENT_TOOLS (พบ ${count})`)
  }
  // viral_cloner ไม่มี tool (parse JSON ฝั่ง backend)
  assert.match(agents, /viral_cloner: \{\},/)
})

test('render driver reuse pipeline เดิม (ห้ามสร้าง renderer ใหม่)', () => {
  const service = read('src/modules/viral-clone/services/clone.ts')
  // ใช้ service ร่วมของ generation (sys_task + คิว maxConcurrent) ไม่ใช่ยิง provider เอง
  assert.match(service, /import \{ generateImage, generateVideo \} from '(\.\.\/)+core\/generation\/generation\.js'/)
  assert.match(service, /mergeEpisodeVideos/)
  assert.match(service, /waitForMergeCompletion/)
  // captions primitives ของ Studio (ไม่คัดลอก logic ซับ)
  assert.match(service, /from '(\.\.\/)+core\/production\/captions\.js'/)
  // beat สั้นกว่า minDurationSec → รวมติดกัน (capabilities ของ video config)
  assert.match(service, /getActiveVideoProviderInfo/)
  assert.match(service, /mergeShortBeats/)
})

test('migration v12 tables ตาม PLAN §3', () => {
  const schemaSql = read('src/core/db/sqlite-schema.ts')
  assert.match(schemaSql, /version: 12/)
  for (const col of ['reference_path', 'reference_transcript', 'blueprint_json', 'error_code', 'render_state']) {
    assert.ok(schemaSql.includes(col), `clone_projects missing column ${col}`)
  }
  for (const col of ['overrides_json', 'output_path', 'duration_sec', 'pipeline_task_id']) {
    assert.ok(schemaSql.includes(col), `clone_variants missing column ${col}`)
  }
})
