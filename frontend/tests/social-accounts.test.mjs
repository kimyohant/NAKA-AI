/**
 * Social Accounts + Brand Profile pages (ticket 07).
 * Checks: the two pages exist at /social/accounts + /social/brand, cards with
 * the four settings + save, auto-mode note, brand five fields with limits,
 * socialAPI settings/brand methods, header links, i18n keys in th and en.
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const accounts = read('app/pages/social/accounts.vue')
const brand = read('app/pages/social/brand.vue')
const inbox = read('app/pages/social/index.vue')
const api = read('app/composables/useApi.ts')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o)

test('socialAPI covers settings + brand routes', () => {
  assert.ok(api.includes('/social/accounts/${id}/settings'), 'missing settings route')
  assert.ok(api.includes('/social/accounts/${id}/brand'), 'missing brand route')
  assert.ok(api.includes('updateSettings'), 'missing updateSettings')
  assert.ok(api.includes('updateBrand'), 'missing updateBrand')
  for (const f of ['reply_mode', 'watch_days', 'reply_to_praise', 'default_language']) {
    assert.ok(api.includes(f), `missing field ${f}`)
  }
})

test('accounts page: card per account with the four settings, saves a change', () => {
  assert.match(accounts, /v-for="a in accounts"/)
  for (const frag of ['replyMode', 'watching', 'watchDays', 'replyToPraise']) {
    assert.ok(accounts.includes(frag), `missing setting ${frag}`)
  }
  assert.ok(accounts.includes('updateSettings'), 'does not save via updateSettings')
  assert.ok(accounts.includes('accountsPage.empty'), 'missing empty state')
  assert.ok(accounts.includes('statusConnected'), 'missing status')
})

test('accounts page: auto mode shows what it will and will not send', () => {
  assert.ok(accounts.includes('autoNote'), 'missing auto note')
  assert.ok(accounts.includes("replyMode === 'auto'"), 'note not gated on auto mode')
  const note = en.social.accountsPage.autoNote
  assert.match(note, /24 hours/)
  assert.match(note, /complaint/i)
  assert.match(note, /unsure/)
})

test('brand page: picker and five fields with limits', () => {
  assert.ok(brand.includes('accountId'), 'missing account picker')
  for (const frag of ['about', 'tone', 'faq', 'forbidden', 'defaultLanguage']) {
    assert.ok(brand.includes(frag), `missing field ${frag}`)
  }
  for (const limit of ['/500', '/200', '/3000']) {
    assert.ok(brand.includes(limit), `missing limit ${limit}`)
  }
  assert.ok(brand.includes('updateBrand'), 'does not save via updateBrand')
})

test('inbox header links open both pages', () => {
  assert.match(inbox, /to="\/social\/accounts"/)
  assert.match(inbox, /to="\/social\/brand"/)
  assert.match(accounts, /to="\/social\/brand/)
  assert.match(brand, /to="\/social\/accounts"/)
})

test('every t() key on both pages exists in th and en', () => {
  for (const [name, page] of [['accounts', accounts], ['brand', brand]]) {
    const keys = [...new Set([...page.matchAll(/(?<![\w$])t\('([a-zA-Z0-9_.]+)'/g)].map(m => m[1]))]
    assert.ok(keys.length > 5, `${name}: too few keys`)
    for (const k of keys) {
      assert.equal(typeof get(th, k), 'string', `th missing ${k}`)
      assert.equal(typeof get(en, k), 'string', `en missing ${k}`)
    }
  }
})
