import assert from 'node:assert/strict'
import { test } from 'node:test'
import { imageAdapters, getImageAdapter } from '../src/core/ai/adapters/registry.js'
import { OpenAIImageAdapter } from '../src/core/ai/adapters/openai-image.js'
import { UnslothImageAdapter } from '../src/core/ai/adapters/unsloth-image.js'
import { officialProviders, isOfficialProvider } from '../src/core/ai/ai.js'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (p: string) => readFileSync(new URL(p, root), 'utf8')

test('unsloth is a registered image provider reusing the OpenAI-compatible adapter', () => {
  const adapter = getImageAdapter('unsloth')
  assert.ok(adapter instanceof UnslothImageAdapter)
  assert.ok(adapter instanceof OpenAIImageAdapter, 'must reuse the openai-compatible request building')
  assert.equal(adapter.provider, 'unsloth')
  assert.equal(imageAdapters.unsloth, adapter)
})

test('officialProviders accepts unsloth for image only (not text-missing, not video-regression)', () => {
  assert.ok(officialProviders.image.includes('unsloth'))
  assert.ok(isOfficialProvider('image', 'unsloth'))
  assert.ok(isOfficialProvider('text', 'unsloth'))
  assert.ok(isOfficialProvider('video', 'unsloth'))
})

test('unsloth image test probe reports models without generating anything', () => {
  const route = read('src/core/routes/aiConfigs.ts')
  // defaults: ราคารูปภาพ = 0 อัตโนมัติสำหรับ unsloth (กัน budget guard บล็อก)
  assert.match(route, /isUnslothImage && configSettings\.price_thb_per_image === undefined/)
  // probe ฝั่ง image: อ่าน /v1/models เท่านั้น — ห้าม POST สร้างรูป
  assert.match(route, /if \(serviceType === 'image'\) \{[\s\S]*?result\.ok = true[\s\S]*?return result\n  \}\n\n  \/\/ text:/)
  const imageBranch = route.match(/if \(serviceType === 'image'\) \{[\s\S]*?\n  \}\n\n  \/\/ text:/)?.[0] || ''
  assert.doesNotMatch(imageBranch, /images\/generations/, 'image probe must not call the generation endpoint')
  assert.match(imageBranch, /\/v1/, 'image probe reads the /v1 models list')
})
