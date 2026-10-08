import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeVideoShot } from '../app/utils/videoPreflight.js'

test('preview and submission use the same ordered images and numbered mentions', () => {
  const plan = analyzeVideoShot({
    prompt: '@Hero enters @Studio. @Coat moves.',
    assets: [
      { kind: 'scene', name: 'Studio', url: 'scene.jpg' },
      { kind: 'character', name: 'Hero', url: 'hero.jpg' },
      { kind: 'prop', name: 'Coat', url: 'hero.jpg' },
    ],
    duration: 8,
  })
  assert.deepEqual(plan.references, ['scene.jpg', 'hero.jpg'])
  assert.deepEqual(plan.assetPlan.map(a => a.index), [1, 2, 2])
  assert.equal(plan.resolvedPrompt, '@图片2Hero enters @图片1Studio. @图片2Coat moves.')
  assert.deepEqual(plan.issues, [])
})

test('missing and unmatched references block a paid submission', () => {
  const plan = analyzeVideoShot({
    prompt: '@Hero meets @Villain',
    assets: [{ kind: 'character', name: 'Hero', url: '' }],
  })
  assert.deepEqual(plan.issues.map(i => i.code), ['missingImage', 'unboundMention', 'unboundMention'])
})

test('too many unique images and invalid numbered references are reported', () => {
  const plan = analyzeVideoShot({
    prompt: '@图片4Extra',
    assets: ['A', 'B', 'C'].map(name => ({ name, url: `${name}.jpg` })),
    limit: 2,
  })
  assert.deepEqual(plan.issues.map(i => i.code), ['tooManyImages', 'invalidIndex'])
})
