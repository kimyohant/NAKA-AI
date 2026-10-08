import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('studio routes ครบตามตาราง PLAN ข้อ 4 และ mount แล้ว', () => {
  const route = read('src/routes/studio.ts')

  // Global + Gallery
  assert.match(route, /app\.get\('\/options'/)
  assert.match(route, /app\.get\('\/templates'/)
  // Projects CRUD
  assert.match(route, /app\.get\('\/projects'/)
  assert.match(route, /app\.post\('\/projects'/)
  assert.match(route, /app\.post\('\/ingest-url'/)
  assert.match(route, /app\.get\('\/projects\/:id'/)
  assert.match(route, /app\.put\('\/projects\/:id'/)
  assert.match(route, /app\.delete\('\/projects\/:id'/)
  // Script / shots / render / merge
  assert.match(route, /app\.post\('\/projects\/:id\/script'/)
  assert.match(route, /app\.put\('\/projects\/:id\/shots\/:shotId'/)
  assert.match(route, /app\.post\('\/projects\/:id\/render'/)
  assert.match(route, /app\.post\('\/projects\/:id\/merge'/)
  // Images
  assert.match(route, /app\.post\('\/projects\/:id\/images\/generate'/)
  assert.match(route, /app\.delete\('\/projects\/:id\/images\/:imageId'/)
  assert.match(route, /app\.post\('\/projects\/:id\/images\/:imageId\/promote'/)
  // Avatars
  assert.match(route, /app\.get\('\/avatars'/)
  assert.match(route, /app\.post\('\/avatars'/)
  assert.match(route, /app\.put\('\/avatars\/:id'/)
  assert.match(route, /app\.post\('\/avatars\/:id\/generate-image'/)
  assert.match(route, /app\.delete\('\/avatars\/:id'/)
  // 202 สำหรับ script async
  assert.match(route, /202/)

  const index = read('src/index.ts') + read('src/modules.ts')
  assert.match(index, /api\.route\('\/studio', studio\)/)
  assert.match(index, /failStaleStudioProjects/)
})

test('studio error codes ใหม่ครบตามสัญญา', () => {
  const service = read('src/services/studio.ts')
  assert.match(service, /E_STUDIO_BUSY/)
  assert.match(service, /E_STUDIO_NEEDS_SCRIPT/)
  assert.match(service, /E_STUDIO_NEEDS_KEYFRAMES/)
  assert.match(service, /E_STUDIO_NO_VIDEOS/)
  assert.match(service, /E_AVATAR_REQUIRED/)
  const routes = read('src/routes/studio.ts') + read('src/services/studio.ts')
  assert.match(routes, /E_TEMPLATE_UNKNOWN/)
  assert.match(service, /E_NO_IMAGE_MODEL/)
  assert.match(service, /E_NO_VIDEO_MODEL/)
  assert.match(service, /E_NO_TEXT_MODEL/)
})

test('review_director register ครบทุกจุด + save_studio_shots ผ่าน tool', () => {
  const agents = read('src/core/agents/index.ts')
  assert.match(agents, /review_director: \{/) // DEFAULT_PROMPTS
  assert.match(agents, /saveStudioShots: studioTools\.saveStudioShots/) // AGENT_TOOLS
  const skills = read('src/core/agents/skills.ts')
  assert.match(skills, /review_director: \['review-director'\]/)
  const tools = read('src/core/agents/tools/studio-tools.ts')
  assert.match(tools, /save_studio_shots/)
  assert.match(tools, /expectedShots/) // จำนวนช็อตต้องเท่า beats
  assert.match(tools, /buildShotPrompts/) // deterministic prompts จาก builder เดียวกับ PUT shots

  for (const file of ['workspace/prompts/review_director.md', 'workspace/prompts/review_director.en.md',
    'workspace/skills/review-director/SKILL.md', 'workspace/skills/review-director/SKILL.en.md']) {
    const content = read(file)
    assert.match(content, /save_studio_shots/)
    assert.match(content, /2\.5|4-5/, 'ต้องระบุอัตราคำพูดต่อวินาที')
    assert.match(content, /[Cc]ompliance|合规/, 'ต้องมีกฎ compliance')
  }
})

test('render/merge ใช้ของเดิม (task-prep + generateImage/Video + mergeEpisodeVideos) และไม่แตะ writeBackImageAssets', () => {
  const service = read('src/services/studio.ts')
  // videos ผ่าน service จาก task 1 — resolveTaskContext + prepareVideoTask ไม่ก๊อป logic แยก
  assert.match(service, /resolveTaskContext\(/)
  assert.match(service, /prepareVideoTask\(/)
  assert.match(service, /generateVideo\(\{/)
  assert.match(service, /generateAudio/) // เสียงพูดจากโมเดลวิดีโอ
  assert.match(service, /first_frame_url: sb\.firstFrameImage/) // first frame = keyframe
  assert.match(service, /productImages\.slice\(0, 3\)/) // keyframes reference รูปสินค้า 3 รูปแรก
  assert.match(service, /frameType: 'first_frame'/)
  assert.match(service, /mergeEpisodeVideos\(/)
  assert.match(service, /E_STUDIO_NEEDS_KEYFRAMES/)
  assert.match(service, /E_STUDIO_NO_VIDEOS/)
  assert.doesNotMatch(service, /writeBackImageAssets/)
  // script async ผ่าน pipeline_tasks (pattern เดียวกับ Marketer)
  assert.match(service, /startTask\(\{ kind: 'studio_script'/)
  assert.match(service, /failStaleStudioProjects/)
  // images ใช้ product-visuals builder (ไม่เขียน prompt ใหม่)
  assert.match(service, /buildVisualPrompt\(kind, instruction\)/)
  // avatar imageUrl อ่านสดจาก sys_task (image_task_id)
  assert.match(service, /imageTaskId/)
})

test('migration v10 ถูกเตรียมใน schema + drizzle tables', () => {
  const sqliteSchema = read('src/core/db/sqlite-schema.ts')
  assert.match(sqliteSchema, /version: 10/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS studio_projects/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS studio_shots/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS studio_avatars/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS studio_images/)
  const drizzle = read('src/core/db/schema.ts')
  assert.match(drizzle, /export const studioProjects = sqliteTable\('studio_projects'/)
  assert.match(drizzle, /export const studioShots = sqliteTable\('studio_shots'/)
  assert.match(drizzle, /export const studioAvatars = sqliteTable\('studio_avatars'/)
  assert.match(drizzle, /export const studioImages = sqliteTable\('studio_images'/)
  assert.match(drizzle, /referenceId: integer\('reference_id'\)/)
})
