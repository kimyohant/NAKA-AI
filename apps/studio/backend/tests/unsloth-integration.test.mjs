// สัญญาระหว่าง backend ↔ frontend ที่ตกหล่นตอนรวมงาน Unsloth (docs/unsloth/PLAN.md ข้อ 3)
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasFrontend, readFrontend } from './_frontend.mjs'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')

test('episode generation-tasks ส่ง queue_position ที่ episode workbench อ่าน (t.queue_position)', () => {
  const route = read('src/routes/episodes.ts')
  const block = route.slice(route.indexOf("app.get('/:id/generation-tasks'"))
  assert.match(block, /queuePosition: videoQueuePosition\(t\)/)
  // toSnakeCase แปลง queuePosition → queue_position
  if (hasFrontend) assert.match(readFrontend('app/views/drama/episode.vue'), /t\.queue_position/)
})

test('boot: studio_render ถูกยกเว้นจาก failStaleRunningTasks และ resume รันทีหลัง', () => {
  const tasks = read('src/core/tasks/pipeline-tasks.ts')
  assert.match(tasks, /RESUMABLE_PIPELINE_KINDS[^=]*=\s*\['studio_render', 'clone_render'\]/)
  assert.match(tasks, /notInArray\(schema\.pipelineTasks\.kind, RESUMABLE_PIPELINE_KINDS\)/)
  const index = read('src/index.ts')
  assert.ok(index.indexOf('failStaleRunningTasks()') < index.indexOf("recoverModules('resume')"))
  // auto-render (product-studio) resumes before seller videos, which wait on it (src/modules.ts order)
  const modules = read('src/modules.ts')
  assert.ok(modules.indexOf('resume: resumeStaleAutoRenders') < modules.indexOf('resume: resumeSellerVideos'))
})
