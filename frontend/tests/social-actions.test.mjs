/**
 * Social person actions (ticket 05) — board cards show the actions for their
 * state, a send-failed note offers send-again / do-not-reply, actions reload
 * the board so the card moves column, and every t() key exists in th and en.
 */
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const page = read('app/pages/social.vue')
const api = read('app/composables/useApi.ts')
const th = JSON.parse(read('app/locales/th.json'))
const en = JSON.parse(read('app/locales/en.json'))
const get = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o)

test('socialAPI covers the person-action routes', () => {
  for (const frag of ['/approve', '/send', '/reject', '/close', '/bring-back', '/help-draft']) {
    assert.ok(api.includes(frag), `missing ${frag}`)
  }
})

test('draft card: approve, edit, reject', () => {
  assert.match(page, /c\.status === 'draft'/)
  for (const k of ['social.approve', 'social.edit', 'social.reject', 'social.send', 'social.cancel']) {
    assert.ok(page.includes(k), `missing ${k}`)
  }
})

test('needs-human card: send, help me draft, do not reply', () => {
  assert.match(page, /c\.status === 'needs_human'/)
  for (const k of ['social.send', 'social.helpDraft', 'social.doNotReply', 'replyPlaceholder']) {
    assert.ok(page.includes(k), `missing ${k}`)
  }
})

test('skipped card: bring back', () => {
  assert.match(page, /c\.status === 'skipped'/)
  assert.ok(page.includes('social.bringBack'), 'missing bringBack')
})

test('send-failed note shows send-again and do-not-reply', () => {
  assert.ok(page.includes('send failed:'), 'missing send-failed detection')
  assert.ok(page.includes('social.sendAgain'), 'missing sendAgain')
})

test('card moves column after an action (reload after act)', () => {
  assert.match(page, /await reload\(\)/)
})

test('every new t() key exists in th and en', () => {
  for (const k of ['approve', 'edit', 'send', 'reject', 'helpDraft', 'doNotReply', 'bringBack', 'sendAgain', 'cancel', 'replyPlaceholder', 'actionFailed', 'drafting']) {
    assert.equal(typeof get(th, `social.${k}`), 'string', `th missing social.${k}`)
    assert.equal(typeof get(en, `social.${k}`), 'string', `en missing social.${k}`)
  }
})
