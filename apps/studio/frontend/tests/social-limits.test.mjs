/**
 * Social read limits + reconnect UI (ticket 08).
 * Checks: the board shows a reconnect banner and turns send off for drafts of
 * reconnect-needed accounts; the Accounts page shows "checked N minutes ago",
 * "paused until HH:MM", and the reconnect badge; i18n keys exist in th and en.
 */
import { readFileSync } from 'node:fs'
import { loadLocale } from './_locales.mjs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const board = read('menus/social/pages/social/index.vue')
const accounts = read('menus/social/pages/social/accounts.vue')
const th = loadLocale('th')
const en = loadLocale('en')
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o)

test('board: reconnect banner for reconnect-needed accounts', () => {
  assert.ok(board.includes('reconnectBanner'), 'missing banner key')
  assert.ok(board.includes('reconnect_needed'), 'banner not gated on reconnect_needed status')
  assert.match(board, /v-if="!loading && reconnectIds\.size"|v-else-if="!loading && reconnectIds\.size"/)
  assert.equal(typeof th.social.reconnectBanner, 'string')
  assert.equal(typeof en.social.reconnectBanner, 'string')
})

test('board: send is off for drafts of reconnect-needed accounts, drafts stay visible', () => {
  assert.ok(board.includes('sendOff(c)'), 'missing send-off check')
  assert.ok(board.includes('reconnectIds'), 'missing reconnect account set')
  // approve + both send buttons are disabled; reject/close/bring-back are not
  const disabledSends = (board.match(/\|\| sendOff\(c\)/g) ?? []).length
  assert.ok(disabledSends >= 4, `expected >=4 send buttons gated, found ${disabledSends}`)
  assert.ok(!board.includes('sendOff(c)">@{{ t(\'social.reject\') }}'), 'reject must stay enabled')
})

test('accounts page: checked-ago, paused-until, and reconnect badge', () => {
  for (const frag of ['checkedAgo', 'checkedJustNow', 'checkedNever', 'pausedUntil', 'statusReconnect']) {
    assert.ok(accounts.includes(frag), `missing ${frag}`)
  }
  assert.ok(accounts.includes('isPaused(a)'), 'paused line not gated on an active pause')
  for (const k of [
    'social.accountsPage.checkedAgo', 'social.accountsPage.checkedJustNow',
    'social.accountsPage.checkedNever', 'social.accountsPage.pausedUntil',
    'social.accountsPage.statusReconnect',
  ]) {
    assert.equal(typeof get(th, k), 'string', `th missing ${k}`)
    assert.equal(typeof get(en, k), 'string', `en missing ${k}`)
  }
})

test('every t() key on the board page exists in th and en', () => {
  const keys = [...new Set([...board.matchAll(/(?<![\w$])t\('([a-zA-Z0-9_.]+)'/g)].map(m => m[1]))]
  assert.ok(keys.length > 5, 'too few keys')
  for (const k of keys) {
    assert.equal(typeof get(th, k), 'string', `th missing ${k}`)
    assert.equal(typeof get(en, k), 'string', `en missing ${k}`)
  }
})
