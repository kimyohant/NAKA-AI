/**
 * Drama studio Art Style picker like Topview Drama Studio: Live Action / Animation / Custom tabs on the home page,
 * the Custom description saved as dramas.metadata.customStyle (home composer, create dialog, project settings).
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const home = read('menus/drama/pages/index.vue')
const detail = read('menus/drama/views/detail.vue')

test('home page: three tabs filter the presets by category, live action carries the provider warning', () => {
  assert.match(home, /role="tablist"/)
  assert.match(home, /value: 'live_action', label: t\('index\.styleTabs\.liveAction'\)/)
  assert.match(home, /value: 'animation', label: t\('index\.styleTabs\.animation'\)/)
  assert.match(home, /value: CUSTOM_STYLE, label: t\('index\.styleTabs\.custom'\)/)
  assert.match(home, /category === 'live_action' \? 'live_action' : 'animation'/)
  assert.match(home, /v-for="p in tabStyles"/)
  assert.match(home, /v-if="styleTab === 'live_action'" class="style-warn"/)
})

test('Custom: typed description is required and saved as metadata.customStyle from the composer and the create dialog', () => {
  assert.match(home, /const CUSTOM_STYLE = 'custom'/)
  assert.match(home, /\{ metadata: \{ customStyle: customStyle\.value\.trim\(\) \} \}/)
  assert.match(home, /metadata\.customStyle = formCustomStyle\.value\.trim\(\)/)
  assert.match(home, /t\('index\.styleTabs\.customRequired'\)/)
  assert.match(home, /<option :value="CUSTOM_STYLE">/)
})

test('project settings keep the custom description in the metadata they already merge', () => {
  assert.match(detail, /'tropes', 'customStyle'\]/)
  assert.match(detail, /v-if="settingsForm\.style === 'custom'" v-model="positioningForm\.customStyle"/)
  assert.match(detail, /\{ label: styleName\('custom'\), value: 'custom' \}/)
})

test('both languages have the tab texts, the custom style name and the settings category labels', () => {
  for (const lang of ['th', 'en']) {
    const m = loadLocale(lang)
    for (const k of ['label', 'liveAction', 'animation', 'custom', 'current', 'view', 'liveWarning', 'customLabel', 'customPlaceholder', 'customHint', 'customRequired']) {
      assert.ok(m.index.styleTabs[k], `${lang}: index.styleTabs.${k}`)
    }
    assert.ok(m.index.styleNames.custom, `${lang}: styleNames.custom`)
    assert.ok(m.settings.styles.gallery.cat_live_action && m.settings.styles.gallery.cat_animation, `${lang}: category labels`)
    assert.ok(m.index.styleDescs['live-mind-bending'] && m.index.styleDescs['anim-pixar-3d'], `${lang}: catalog descriptions`)
  }
})
