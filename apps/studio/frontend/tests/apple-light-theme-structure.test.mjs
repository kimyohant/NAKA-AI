import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const studioCss = read('../app/assets/studio.css')
const layout = read('../app/layouts/default.vue')
const surfaces = [
  studioCss,
  layout,
  read('../menus/drama/pages/index.vue'),
  read('../menus/drama/views/detail.vue'),
  read('../menus/drama/views/episode.vue'),
].join('\n')

// rebrand หลังชุด Apple-light: ChatFire 火焰橙 + IBM Plex Sans Thai (ดู commit 82877d0)
test('light theme exposes the shipped neutral and brand-orange tokens', () => {
  assert.match(studioCss, /--surface-base:\s*#f7f8fa/i)
  assert.match(studioCss, /--surface-raised:\s*#ffffff/i)
  assert.match(studioCss, /--accent:\s*#f97316/i)
  assert.match(studioCss, /--success:\s*#16a34a/i)
  assert.match(studioCss, /--font-body:\s*'IBM Plex Sans Thai',\s*-apple-system,\s*BlinkMacSystemFont,\s*'SF Pro Text'/)
})

test('core surfaces remove the old film-console and graphite decoration', () => {
  assert.doesNotMatch(surfaces, /#d96f27|rgba\(217\s*,\s*111\s*,\s*39/i)
  assert.doesNotMatch(surfaces, /Noto Serif SC|film-strip|film-frame/i)
  assert.doesNotMatch(surfaces, /#15171a|#1c1f23|#20242a|#30343a/i)
  assert.doesNotMatch(surfaces, /#4c8dff|rgba\(76\s*,\s*141\s*,\s*255/i)
})
