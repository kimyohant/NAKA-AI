import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('studio phase2 routes ครบ + mount', () => {
  const route = read('src/modules/product-studio/routes/studio.ts')
  assert.match(route, /app\.post\('\/projects\/:id\/auto-render'/)
  assert.match(route, /app\.post\('\/projects\/:id\/auto-render\/cancel'/)
  assert.match(route, /app\.post\('\/projects\/from-campaign'/)
  // merge route รับ captions option (ผ่าน body)
  assert.match(route, /app\.post\('\/projects\/:id\/merge'/)
  // 202 สำหรับ auto-render
  assert.match(route, /202/)
  const index = ['src/index.ts', 'src/modules.ts', ...['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live'].map(m => `src/modules/${m}/index.ts`)].map(read).join('\n')
  assert.match(index, /resumeStaleAutoRenders/)
})

test('studio2 error codes ใหม่ครบ', () => {
  const service = read('src/modules/product-studio/services/studio.ts')
  const autorender = read('src/modules/product-studio/services/studio-autorender.ts')
  const captions = read('src/core/production/captions.ts')
  assert.match(service + autorender, /E_STUDIO_CAMPAIGN_NOT_FOUND/)
  assert.match(captions, /E_CAPTION_FONT_MISSING/)
  assert.match(autorender, /E_TASK_INTERRUPTED/)
  assert.match(autorender + service, /E_STUDIO_BUSY/)
  // auto_render JSON ผูกใน toProjectJson
  assert.match(service, /autoRender: parseAutoRender\(row\.autoRender\)/)
  assert.match(service, /sourceCampaignId: row\.sourceCampaignId/)
})

test('auto-render ใช้ฟังก์ชันเดิมของ studio.ts (ไม่ก๊อป logic ส่งงาน)', () => {
  const autorender = read('src/modules/product-studio/services/studio-autorender.ts')
  assert.match(autorender, /submitRenderStage\(/)
  assert.match(autorender, /mergeProject\(projectId, \{ fromAutoRender: true \}\)/)
  assert.match(autorender, /from '.\/studio.js'/)
  // pipeline_tasks kind studio_render
  const pipeline = read('src/core/tasks/pipeline-tasks.ts')
  assert.match(pipeline, /'studio_render'/)
  // ห้าม poll ถี่กว่า 5s ฝั่ง server
  assert.match(autorender, /Math\.max\(opts\.pollMs \?\? POLL_MS, 5000\)/)
  assert.match(autorender, /resumeStaleAutoRenders/)
  assert.match(autorender, /E_TASK_INTERRUPTED/)
})

test('captions: merge ฝั่ง Studio เรียก burn หลัง concat, drama merge ปกติไม่กระทบ', () => {
  const service = read('src/modules/product-studio/services/studio.ts')
  assert.match(service, /burnCaptionsAfterMerge\(/)
  assert.match(service, /waitForMergeCompletion\(mergeId\)/)
  assert.match(service, /captionsEnabled = opts\.captions \?\?/)
  assert.match(service, /assertCaptionFontAvailable\(project\.language\)/)
  assert.match(service, /set\(\{ mergedUrl: outputRel, captioned: true, subtitleUrl: srtRel \}\)/)
  // merge ของ drama ปกติ: ffmpeg-merge.ts ไม่มี caption logic ใด ๆ
  const merge = read('src/core/production/ffmpeg-merge.ts')
  assert.doesNotMatch(merge, /captions|subtitle/i)
})
// desktop packaging (fonts bundled into the Electron app) is tested in desktop/tests
