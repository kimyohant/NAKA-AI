import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readEpisodeWorkbench } from './_episode.mjs'

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8')
const studioCss = read('../app/assets/studio.css')
const layout = read('../app/layouts/default.vue')
const surfaces = [
  studioCss,
  layout,
  read('../menus/drama/pages/index.vue'),
  read('../menus/drama/views/detail.vue'),
  readEpisodeWorkbench(),
].join('\n')

// rebrand เป็นอัตลักษณ์ naka-ai: ขาว/โคบอลต์ + Anuphan (apps/landing/.ui-craft/tokens.md)
test('light theme exposes the naka-ai pearl and cobalt tokens', () => {
  assert.match(studioCss, /--surface-base:\s*#f7f9fd/i)
  assert.match(studioCss, /--surface-raised:\s*#ffffff/i)
  assert.match(studioCss, /--accent:\s*#235be8/i)
  assert.match(studioCss, /--text-0:\s*#15264a/i)
  assert.match(studioCss, /--success:\s*#16a34a/i)
  assert.match(studioCss, /--font-body:\s*'Anuphan',\s*-apple-system,\s*BlinkMacSystemFont,\s*'SF Pro Text'/)
})

test('core surfaces remove the old film-console and graphite decoration', () => {
  assert.doesNotMatch(surfaces, /#d96f27|rgba\(217\s*,\s*111\s*,\s*39/i)
  assert.doesNotMatch(surfaces, /Noto Serif SC|film-strip|film-frame/i)
  assert.doesNotMatch(surfaces, /#15171a|#1c1f23|#20242a|#30343a/i)
  assert.doesNotMatch(surfaces, /#4c8dff|rgba\(76\s*,\s*141\s*,\s*255/i)
})
