/**
 * AI Influencer (v14) — frontend structure tests
 *
 * ตรวจ: studioAPI มี endpoint ครบ, types ครบ, แท็บ influencers อยู่ใน studio.vue,
 * workspace เลือก influencer ได้ (settings draft + save), คอมโพเนนต์การ์ด/ไดอะล็อกอ้างฟิลด์ถูก,
 * i18n th/en ครบสมมาตร (tabs/niches/scenes/settings/errors)
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadLocale } from './_locales.mjs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

const useApi = read('app/composables/useApi.ts')
const studioPage = read('menus/product-studio/pages/studio.vue')
const workspace = read('menus/product-studio/views/workspace.vue')
const card = read('menus/product-studio/components/StudioInfluencerCard.vue')
const dialog = read('menus/product-studio/components/StudioInfluencerContentDialog.vue')
const th = loadLocale('th')
const en = loadLocale('en')

test('studioAPI implements every influencer endpoint', () => {
  for (const m of ['influencers', 'createInfluencer', 'updateInfluencer', 'deleteInfluencer', 'generateInfluencerImage', 'influencerContents', 'generateInfluencerReviewImages', 'generateInfluencerScript', 'deleteInfluencerContent']) {
    assert.match(useApi, new RegExp(`\\b${m}:`), `studioAPI.${m} missing`)
  }
  for (const fragment of ['/studio/influencers', '/generate-image', '/contents/images', '/contents/script']) {
    assert.ok(useApi.includes(fragment), `useApi missing path fragment ${fragment}`)
  }
})

test('contract types: StudioInfluencer, StudioInfluencerContent, StudioProject.influencerId, detail.influencer', () => {
  assert.match(useApi, /export interface StudioInfluencer/)
  assert.match(useApi, /export interface StudioInfluencerContent/)
  assert.match(useApi, /export type InfluencerReviewScene = 'unboxing' \| 'holding' \| 'using' \| 'closeup' \| 'lifestyle'/)
  assert.match(useApi, /influencerId: number \| null/)
  assert.match(useApi, /influencer: StudioInfluencer \| null/)
})

test('studio page: third tab + create dialog fields + poll wiring', () => {
  assert.match(studioPage, /tab === 'influencers'/)
  assert.match(studioPage, /productStudio\.tabs\.influencers/)
  assert.match(studioPage, /StudioInfluencerCard/)
  assert.match(studioPage, /StudioInfluencerContentDialog/)
  assert.match(studioPage, /influencerForm\.value\.appearance/)
  assert.match(studioPage, /busyInfluencers/)
  assert.match(studioPage, /studioAPI\.influencers\(\)/)
})

test('workspace: influencer picker in settings + presenter guard accepts influencer', () => {
  assert.match(workspace, /settingsDraft\.influencerId/)
  assert.match(workspace, /influencerId: s\.influencerId/)
  assert.match(workspace, /productStudio\.settings\.influencer/)
  assert.match(workspace, /presenterMissing = computed\(\(\) => template\.value\?\.avatarMode === 'required'[\s\S]*influencer\.value/)
  assert.match(workspace, /studioAPI\.influencers\(\)/)
})

test('card + dialog reference the right fields and scenes', () => {
  assert.match(card, /generateInfluencerImage/)
  assert.match(card, /influencers\.niches\./)
  assert.match(dialog, /generateInfluencerReviewImages/)
  assert.match(dialog, /generateInfluencerScript/)
  assert.match(dialog, /deleteInfluencerContent/)
  for (const scene of ['unboxing', 'holding', 'using', 'closeup', 'lifestyle']) {
    assert.ok(dialog.includes(`'${scene}'`), `dialog missing scene ${scene}`)
  }
})

test('i18n th/en parity for influencer keys', () => {
  for (const [loc, data] of [['th', th], ['en', en]]) {
    const inf = data.productStudio.influencers
    for (const k of ['create', 'createDesc', 'appearance', 'persona', 'emptyTitle', 'contentTitle', 'generateImages', 'generateScript', 'needPortrait', 'resultsEmpty', 'copy']) {
      assert.ok(inf[k], `${loc}.productStudio.influencers.${k} missing`)
    }
    for (const n of ['beauty', 'fashion', 'food', 'tech', 'fitness', 'lifestyle', 'gaming', 'travel', 'home', 'mom_baby']) {
      assert.ok(inf.niches[n], `${loc}.influencers.niches.${n} missing`)
    }
    for (const s of ['unboxing', 'holding', 'using', 'closeup', 'lifestyle']) {
      assert.ok(inf.sceneNames[s], `${loc}.influencers.sceneNames.${s} missing`)
    }
    for (const k of ['influencer', 'influencerNone', 'noInfluencers', 'manageInfluencers']) {
      assert.ok(data.productStudio.settings[k], `${loc}.productStudio.settings.${k} missing`)
    }
    assert.ok(data.productStudio.tabs.influencers, `${loc}.tabs.influencers missing`)
    for (const code of ['E_INFLUENCER_NO_IMAGE', 'E_INFLUENCER_BUSY']) {
      assert.ok(data.errors.codes[code], `${loc}.errors.codes.${code} missing`)
    }
  }
})
