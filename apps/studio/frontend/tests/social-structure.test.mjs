/**
 * Social inbox (ticket 02) — /social Kanban board over the fake-platform path.
 * Checks: sidebar link, socialAPI routes, five columns, two filters, links to
 * the Accounts/Brand pages, three empty/error states, i18n keys in th and en.
 */
import { readFileSync } from 'node:fs'
import { loadLocale } from './_locales.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const page = read('menus/social/pages/social/index.vue')
const api = read('app/composables/useApi.ts')
const layout = read('app/layouts/default.vue')
const th = loadLocale('th')
const en = loadLocale('en')
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o)

test('sidebar links to /social with a nav label', () => {
  assert.match(layout, /<NuxtLink to="\/social"/)
  assert.equal(typeof th.layout.nav.social, 'string')
  assert.equal(typeof en.layout.nav.social, 'string')
})

test('socialAPI covers the board routes with both filters', () => {
  assert.ok(api.includes('/social/accounts'), 'missing /social/accounts')
  assert.ok(api.includes('/social/comments'), 'missing /social/comments')
  assert.ok(api.includes('account_id'), 'missing account_id filter')
  assert.ok(api.includes('fallback_only'), 'missing fallback_only filter')
})

test('board: five columns with per-state card actions (ticket 05)', () => {
  for (const s of ['needs_human', 'draft', 'queued', 'replied', 'skipped']) {
    assert.ok(page.includes(s), `missing column ${s}`)
  }
  assert.match(page, /v-for="col in columns"/)
  for (const frag of ['approveComment', 'sendComment', 'rejectComment', 'closeComment', 'bringBackComment', 'helpDraft']) {
    assert.ok(page.includes(frag), `missing action ${frag}`)
  }
})

test('card: platform tag, author, age, comment text, reply, fallback badge, status note', () => {
  for (const frag of ['c.platform', 'authorName', 'commentedAt', 'c.text', 'replyText', 'fallbackBadge', 'statusNote']) {
    assert.ok(page.includes(frag), `missing ${frag}`)
  }
})

test('header: account filter, not-in-FAQ filter, links to Accounts and Brand pages', () => {
  assert.match(page, /v-model="accountId"/)
  assert.match(page, /v-model="fallbackOnly"/)
  assert.match(page, /to="\/social\/accounts"/)
  assert.match(page, /to="\/social\/brand"/)
})

test('three empty and error states', () => {
  assert.ok(page.includes('noAccountYet'), 'missing no-account state')
  assert.ok(page.includes('noCommentsYet'), 'missing no-comments state')
  assert.ok(page.includes('loadFailed'), 'missing load-failed state')
})

test('new comments are kept off the board', () => {
  assert.match(page, /c\.status !== 'new'/)
})

test('every t() key on the page exists in th and en', () => {
  const keys = [...new Set([...page.matchAll(/(?<![\w$])t\('([a-zA-Z0-9_.]+)'/g)].map(m => m[1]))]
  assert.ok(keys.length > 10)
  for (const k of keys) {
    assert.equal(typeof get(th, k), 'string', `th missing ${k}`)
    assert.equal(typeof get(en, k), 'string', `en missing ${k}`)
  }
})
