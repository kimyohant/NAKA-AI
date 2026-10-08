import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

// หน้ารายการตอนปัจจุบันคือ views/drama/detail.vue (สร้างตอน + การ์ดตอน)
test('add episode dialog asks for a title and a fixed video resolution', () => {
  const page = read('menus/drama/views/detail.vue')

  // ไม่มีให้เลือก image/video service ใน dialog อีกต่อไป (backend ล็อก config ให้เอง)
  assert.doesNotMatch(page, /图片生成服务/)
  assert.doesNotMatch(page, /视频生成服务/)
  assert.doesNotMatch(page, /svc-card/)
  assert.doesNotMatch(page, /svc-pick/)
  assert.doesNotMatch(page, /imageConfigs|videoConfigs/)

  // ชื่อตอน (auto-name ได้) + คำใบ้
  assert.match(page, /v-model="newEpisodeTitle"/)
  assert.match(page, /:placeholder="t\('detail\.epCreate\.titlePlaceholder'\)"/)
  assert.match(page, /t\('detail\.epCreate\.titleHint'/)

  // ความละเอียดวิดีโอ fix ตอนสร้าง (720p default, มี 480p ให้เลือก)
  assert.match(page, /t\('detail\.epCreate\.resolution'\)/)
  assert.match(page, /v-model="newEpisodeResolution"/)
  assert.match(page, /const resolutionOptions = computed\(/)
  assert.match(page, /value: '720p'/)
  assert.match(page, /value: '480p'/)
  assert.match(page, /newEpisodeResolution = ref\('720p'\)/)
  assert.match(page, /t\('detail\.epCreate\.resolutionHint'\)/)

  // ปุ่ม submit มีสถานะ creating
  assert.match(page, /creatingEpisode \? t\('detail\.epCreate\.creating'\) : t\('detail\.epCreate\.create'\)/)
})

test('addEpisode posts drama_id, title and resolution', () => {
  const page = read('menus/drama/views/detail.vue')

  const addEpisodeBody = page.slice(page.indexOf('async function addEpisode'), page.indexOf('async function confirmDelEpisode'))
  assert.match(addEpisodeBody, /drama_id: dramaId/)
  assert.match(addEpisodeBody, /title: newEpisodeTitle\.value/)
  assert.match(addEpisodeBody, /resolution: newEpisodeResolution\.value/)
  assert.doesNotMatch(addEpisodeBody, /image_config_id/)
  assert.doesNotMatch(addEpisodeBody, /video_config_id/)
  assert.doesNotMatch(addEpisodeBody, /aiConfigAPI/)
})

test('episode card resolution is editable via a dropdown persisted to episodes.resolution', () => {
  const page = read('menus/drama/views/detail.vue')

  // ตัวเลือกความละเอียดบนการ์ดตอน (เมนูเดียวกับสถานะ) + persist ผ่าน episodeAPI.update
  assert.match(page, /epResMenuId/)
  assert.match(page, /function epResolution\(ep\) \{ return ep\.resolution === '480p' \? '480p' : '720p' \}/)
  assert.match(page, /function setEpisodeResolution/)
  assert.match(page, /episodeAPI\.update\(ep\.id, \{ resolution \}\)/)
})

test('add episode dialog does not preload config lists', () => {
  const page = read('menus/drama/views/detail.vue')

  assert.doesNotMatch(page, /loadConfigs/)
  assert.doesNotMatch(page, /aiConfigAPI\.list/)
  assert.doesNotMatch(page, /canCreateEpisode/)
})
