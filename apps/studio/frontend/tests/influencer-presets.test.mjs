/**
 * "AI Influencer พร้อมรีวิว" on the AI Marketer page: 10 ready-made presenters (app/utils/influencerPresets.js) whose
 * cards open Product Studio → Influencers with the create form filled and the card photo uploaded as the face.
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { INFLUENCER_PRESETS, influencerPreset, influencerPresetImage } from '../app/utils/influencerPresets.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const studio = read('menus/product-studio/pages/studio.vue')
const quick = read('menus/marketer/components/MarketerQuickStart.vue')
const niches = JSON.parse(studio.match(/const NICHES = (\[[^\]]+\])/)[1].replace(/'/g, '"'))

test('10 presets, one per card, with a real niche, a Thai look and persona, and a sharp photo', () => {
  assert.equal(INFLUENCER_PRESETS.length, 10)
  INFLUENCER_PRESETS.forEach((p, i) => {
    assert.equal(p.id, `i${String(i + 1).padStart(2, '0')}`)
    assert.ok(niches.includes(p.niche), `${p.id} niche ${p.niche}`)
    for (const f of ['name', 'appearance', 'persona']) assert.match(p[f], /[ก-๙]/, `${p.id}.${f}`)
    const file = fileURLToPath(new URL(`app/public${influencerPresetImage(p.id)}`, root))
    assert.ok(existsSync(file), `${p.id} photo`)
    const size = statSync(file).size
    assert.ok(size > 40_000 && size < 260_000, `${p.id} photo is ${size} bytes (too compressed or too heavy)`)
  })
  assert.equal(influencerPreset('i99'), null)
  assert.equal(influencerPresetImage('../x'), '')
})

test('the marketer cards are buttons that open Product Studio with the preset', () => {
  assert.match(quick, /<button v-for="id in influencers" :key="id" type="button" class="qs-reel qs-person" @click="useInfluencer\(id\)">/)
  assert.match(quick, /navigateTo\(\{ path: '\/studio', query: \{ tab: 'influencers', preset: `i\$\{id\.slice\(11\)\}` \} \}\)/)
  assert.doesNotMatch(quick, /<figure v-for="id in influencers"/)
})

test('Product Studio fills the create form from ?preset= and uploads the card photo as the face', () => {
  assert.match(studio, /async function applyInfluencerPreset\(id: unknown\)/)
  assert.match(studio, /influencerForm\.value = \{ \.\.\.influencerForm\.value, name: preset\.name, appearance: preset\.appearance, persona: preset\.persona, niche: preset\.niche \}/)
  assert.match(studio, /uploadAPI\.image\(new File\(\[blob\]/)
  assert.match(studio, /applyInfluencerPreset\(route\.query\.preset\)/)
  assert.match(studio, /watch\(\(\) => route\.query\.preset, applyInfluencerPreset\)/)
})

test('the create dialog shows only the influencer fields on the influencer tab (the avatar form was a bare v-else)', () => {
  assert.match(studio, /<template v-else-if="tab === 'avatars'">/)
  assert.doesNotMatch(studio, /<\/template>\s*<template v-else>\s*<label class="field">\s*<span class="field-label">\{\{ t\('productStudio\.avatars\.name'\)/)
})
