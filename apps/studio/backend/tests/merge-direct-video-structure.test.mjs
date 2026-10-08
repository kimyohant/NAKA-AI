import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasFrontend, readFrontend } from './_frontend.mjs'

const mergeService = readFileSync(new URL('../src/core/production/ffmpeg-merge.ts', import.meta.url), 'utf8')
const episodesRoute = readFileSync(new URL('../src/routes/episodes.ts', import.meta.url), 'utf8')
const backendIndex = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
  + readFileSync(new URL('../src/modules.ts', import.meta.url), 'utf8')
const useApi = hasFrontend ? readFrontend('app/composables/useApi.ts') : ''
const composeRoutePath = new URL('../src/routes/compose.ts', import.meta.url)
const composeServicePath = new URL('../src/services/ffmpeg-compose.ts', import.meta.url)

test('episode merge uses generated videos directly without requiring compose output', () => {
  assert.doesNotMatch(mergeService, /Only composed storyboards can be merged/)
  assert.match(mergeService, /sb\.videoUrl\s*\|\|\s*sb\.composedVideoUrl/)
  // 允许部分拼接：没有视频的镜头跳过；显式选中的镜头缺视频才报错
  assert.match(mergeService, /\.filter\(c => Boolean\(c\.url\)\)/)
  assert.match(mergeService, /所选镜头还没有可拼接的视频/)
  assert.match(mergeService, /Some selected shots have no video; select only completed clips/)
  // 本地文件丢失的镜头给出可操作的报错（而不是 ffmpeg 的晦涩输出）
  assert.match(mergeService, /视频文件已丢失（本地文件不存在）/)
})

test('compose workflow is no longer exposed through API surfaces', () => {
  assert.doesNotMatch(episodesRoute, /compose_shots/)
  assert.doesNotMatch(backendIndex, /api\.route\('\/compose'/)
  assert.doesNotMatch(useApi, /export const composeAPI/)
  assert.equal(existsSync(composeRoutePath), false)
  assert.equal(existsSync(composeServicePath), false)
})
