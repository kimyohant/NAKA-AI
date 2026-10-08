import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

// โครงปัจจุบัน: รายการตอนอยู่ใน views/drama/detail.vue (route /drama/:id)
// และ asset library คือ board page (views/drama/board.vue, route /drama/:id/board)
test('episode card exposes a delete action', () => {
  const page = read('menus/drama/views/detail.vue')
  const useApi = read('app/composables/useApi.ts')

  assert.match(useApi, /episodeAPI = \{[\s\S]*?del: \(id: number\) => api\.del\(`\/episodes\/\$\{id\}`\)/)
  // เมนู … ของการ์ดตอนมี action ลบ (danger) → เปิด ConfirmDialog
  assert.match(page, /episodeToDelete = ep/)
  assert.match(page, /<ConfirmDialog/)
  assert.match(page, /await episodeAPI\.del\(ep\.id\)/)
  // ไม่ใช้ confirm() ของเบราว์เซอร์
  assert.doesNotMatch(page, /[^D]confirm\(/)
})

test('drama detail header links to the asset board page', () => {
  const page = read('menus/drama/views/detail.vue')

  assert.match(page, /ws-board-btn/)
  assert.match(page, /navigateTo\(`\/drama\/\$\{drama\.id\}\/board`\)/)
})

test('episode status is manually marked, not derived from script content', () => {
  const page = read('menus/drama/views/detail.vue')

  // สถานะ manual: ตัวเลือก + เมนูบนการ์ด + persist ลง episodes.status
  assert.match(page, /const epStatusOptions = computed\(/)
  assert.match(page, /function epStatus\(ep\) \{ return ep\.status \|\| 'draft' \}/)
  assert.match(page, /function setEpisodeStatus/)
  assert.match(page, /episodeAPI\.update\(ep\.id, \{ status \}\)/)
  assert.match(page, /epStatusMenuId/)
  // ไม่มีการเดาสถานะจากเนื้อความอีกต่อไป (hasScript ปัจจุบันใช้กับ ready-tab ของ workspace ไม่เกี่ยวกับสถานะตอน)
  assert.doesNotMatch(page, /已完成剧本/)
  assert.doesNotMatch(page, /待编写/)
})

test('asset board lists character and scene materials with a viewer', () => {
  const page = read('menus/drama/views/board.vue')

  // แหล่งข้อมูล: โปรเจกต์ (ตัวละคร/ฉาก/ของประกอบพร้อมรูป) ผ่าน dramaAPI.get
  assert.match(page, /dramaAPI\.get\(dramaId\)/)
  // กรอง all / character / scene / prop
  assert.match(page, /filter\.value === 'all' \|\| m\.kindKey === filter\.value/)
  assert.match(page, /visibleAssets/)
  // กริดการ์ด + viewer overlay
  assert.match(page, /class="board-card"/)
  assert.match(page, /class="board-thumb"/)
  assert.match(page, /board-viewer/)
  // วัสดุที่ยังไม่มีรูปมีปุ่ม generate ต่อ
  assert.match(page, /generateMaterial\(m\)/)
})
