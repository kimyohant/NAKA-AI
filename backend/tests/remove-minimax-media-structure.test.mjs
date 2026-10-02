import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('../..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

// MiniMax 图片适配器已下架；MiniMax **视频**适配器重新成为官方支持 provider（见 CLAUDE.md / ai.ts officialProviders.video）
test('MiniMax image provider stays removed; MiniMax video is a supported official provider', () => {
  const ai = read('backend/src/services/ai.ts')
  const route = read('backend/src/routes/aiConfigs.ts')
  const registry = read('backend/src/services/adapters/registry.ts')

  // 图片 provider 列表不含 minimax，视频列表包含
  assert.doesNotMatch(ai, /image: \[[^\]]*minimax/i)
  assert.match(ai, /video: \[[^\]]*minimax/i)
  assert.match(route, /p === 'minimax'/) // 视频配置的官方入参分支
  assert.match(registry, /import { MiniMaxVideoAdapter } from '\.\/minimax-video'/)
  assert.match(registry, /minimax: new MiniMaxVideoAdapter\(\)/)
  assert.equal(exists('backend/src/services/adapters/minimax-image.ts'), false)
  assert.equal(exists('backend/src/services/adapters/minimax-video.ts'), true)
  // TTS 品类仍然不存在
  assert.doesNotMatch(registry, /tts/i)
  assert.equal(exists('backend/src/services/adapters/minimax-tts.ts'), false)
})
