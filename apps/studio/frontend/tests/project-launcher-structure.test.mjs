import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const page = readFileSync(new URL('../menus/drama/pages/index.vue', import.meta.url), 'utf8')
const studioCss = readFileSync(new URL('../app/assets/studio.css', import.meta.url), 'utf8')

test('project list opens project detail before choosing an episode', () => {
  // Topview-style home: การ์ดโปรเจกต์เปิดเข้าหน้า detail ก่อนเลือกตอน
  assert.match(page, /openDrama/)
  assert.match(page, /navigateTo\(`\/drama\/\$\{d\.id\}`\)/)
  assert.match(page, /t\('index\.openProject'\)/)
  assert.doesNotMatch(page, /openWorkbench/)
})

test('project status is manually marked, not derived from content', () => {
  // สถานะ manual: ตัวเลือก + เมนูบนการ์ด + persist ลง dramas.status
  assert.match(page, /const statusOptions = computed\(/)
  assert.match(page, /value: 'draft'/)
  assert.match(page, /value: 'active'/)
  assert.match(page, /value: 'completed'/)
  assert.match(page, /function currentStatus\(d\) \{ return d\.status \|\| 'draft' \}/)
  assert.match(page, /function setDramaStatus/)
  assert.match(page, /dramaAPI\.update\(d\.id, \{ status \}\)/)
  assert.match(page, /statusMenuId/)
  // ตัวกรองอิงสถานะ manual
  assert.match(page, /currentStatus\(d\) === statusFilter\.value/)
  // ไม่มีการเดาสถานะอัตโนมัติเหลืออยู่
  assert.doesNotMatch(page, /getProgress/)
  assert.doesNotMatch(page, /d\.episodes\?\.length \? '进行中' : '待开始'/)
})

test('project launcher keeps controls simple', () => {
  assert.match(page, /t\('index\.searchPlaceholder'\)/)
  assert.match(page, /t\('index\.studio\.createNew'\)/)
  assert.doesNotMatch(page, /剧集列表/)
  assert.doesNotMatch(page, /制作队列/)
  assert.doesNotMatch(page, /最近活动/)
})

test('create dialog fixes aspect ratio at project creation', () => {
  assert.match(page, /t\('index\.createDialog\.aspectRatio'\)/)
  assert.match(page, /form\.aspect_ratio/)
  assert.match(page, /aspectRatioOptions/)
  assert.match(page, /aspect_ratio: '16:9'/)
  assert.match(page, /t\('index\.createDialog\.aspectRatioHint'\)/)
  assert.match(page, /value: '16:9'/)
  assert.match(page, /value: '9:16'/)
  assert.match(page, /value: '1:1'/)
  assert.doesNotMatch(page, /计划集数/)
})

test('global buttons use the shipped action palette', () => {
  assert.match(studioCss, /--action-primary:\s*#235be8/)
  assert.match(studioCss, /--action-secondary:\s*#e8edf5/)
  assert.match(studioCss, /--action-danger:\s*#dc2626/)
  assert.match(studioCss, /\.btn-primary\s*\{/)
})
