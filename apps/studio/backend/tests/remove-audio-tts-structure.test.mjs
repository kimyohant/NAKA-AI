import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')
const exists = (path) => existsSync(new URL(path, root))

test('backend removes the voice assignment agent and tools', () => {
  const agents = read('src/core/agents/index.ts')
  const skills = read('src/core/agents/skills.ts')

  assert.doesNotMatch(agents, /voice_assigner/)
  assert.doesNotMatch(agents, /createVoiceTools/)
  assert.doesNotMatch(skills, /voice_assigner/)
  assert.equal(exists('src/agents/tools/voice-tools.ts'), false)
  assert.equal(exists('workspace/skills/voice_assigner/SKILL.md'), false)
})

test('backend removes audio service providers, TTS adapters, and voice routes', () => {
  const index = ['src/index.ts', 'src/modules.ts', ...['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live'].map(m => `src/modules/${m}/index.ts`)].map(read).join('\n')
  const ai = read('src/core/ai/ai.ts')
  const registry = read('src/core/ai/adapters/registry.ts')
  const types = read('src/core/ai/adapters/types.ts')

  assert.doesNotMatch(index, /aiVoices/)
  assert.doesNotMatch(ai, /audio/)
  assert.doesNotMatch(ai, /getAudioConfig/)
  assert.doesNotMatch(registry, /TTS/)
  assert.doesNotMatch(registry, /minimax-tts/)
  assert.doesNotMatch(types, /TTSProviderAdapter/)
  assert.equal(exists('src/routes/aiVoices.ts'), false)
  assert.equal(exists('src/services/tts-generation.ts'), false)
  assert.equal(exists('src/services/adapters/minimax-tts.ts'), false)
  assert.match(read('src/core/ai/adapters/volcengine-video.ts'), /generate_audio:\s*record\.generateAudio/)
  assert.doesNotMatch(read('src/core/ai/adapters/volcengine-video.ts'), /generate_audio:\s*false/)
})

test('backend removes TTS endpoints and audio-specific schema fields', () => {
  const episodes = read('src/modules/drama/routes/episodes.ts')
  const storyboards = read('src/modules/drama/routes/storyboards.ts')
  const characters = read('src/modules/drama/routes/characters.ts')
  const schema = read('src/core/db/schema.ts')

  assert.doesNotMatch(episodes, /audio_config_id/)
  assert.doesNotMatch(episodes, /assign_voices/)
  assert.doesNotMatch(episodes, /generate_voice_samples/)
  assert.doesNotMatch(storyboards, /generate-tts/)
  assert.doesNotMatch(storyboards, /ttsAudioUrl/)
  assert.doesNotMatch(characters, /generate-voice-sample/)
  assert.doesNotMatch(characters, /voiceStyle/)
  assert.doesNotMatch(schema, /audioConfigId/)
  assert.doesNotMatch(schema, /voiceStyle/)
  assert.doesNotMatch(schema, /voiceSampleUrl/)
  assert.doesNotMatch(schema, /voiceProvider/)
  assert.doesNotMatch(schema, /ttsAudioUrl/)
  assert.doesNotMatch(schema, /aiVoices/)
  // 旧 MySQL 方案已整体退役（MySQL→SQLite 一次性迁移完成），mysql-schema.ts 不复存在
  assert.equal(exists('src/db/mysql-schema.ts'), false)
})
