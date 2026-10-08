/**
 * Social Auto Reply ticket 03 — plain rules of the comment filter.
 * Pure unit tests per rule (cut + not cut) plus fake-adapter rounds for
 * "answered outside our app" and the replied-unchanged guard.
 * Temp SQLite via SQLITE_PATH, node:test.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { and, eq } from 'drizzle-orm'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-filter-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const {
  SKIP_OWN,
  SKIP_ALREADY_REPLIED,
  SKIP_NO_TEXT,
  SKIP_VIEWER_TO_VIEWER,
  isNothingToAnswer,
  judgePlainRule,
} = await import('../src/services/social/filter.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const { registerSocialAdapter } = await import('../src/services/social/registry.js')
const poller = await import('../src/services/social/poller.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')
const { default: social } = await import('../src/routes/social.js')

const ctx = (ownIds: string[] = [], repliedIds: string[] = []) => ({
  ownIds: new Set(ownIds),
  repliedIds: new Set(repliedIds),
})

// --- Rule 1: own comment ---

test('rule 1 cuts our own comment, keeps a viewer comment', () => {
  assert.equal(
    judgePlainRule({ id: 'a', text: 'Thanks for asking', isOwn: true }, ctx()),
    SKIP_OWN,
  )
  assert.equal(
    judgePlainRule({ id: 'b', text: 'Thanks for asking', isOwn: false }, ctx()),
    null,
  )
})

// --- Rule 2: already replied on the Platform ---

test('rule 2 cuts a comment that already has our reply under it', () => {
  assert.equal(
    judgePlainRule({ id: 'v', text: 'How much is this', isOwn: false }, ctx(['r'], ['v'])),
    SKIP_ALREADY_REPLIED,
  )
  assert.equal(
    judgePlainRule({ id: 'w', text: 'How much is this', isOwn: false }, ctx(['r'], ['v'])),
    null,
  )
})

// --- Rule 3: nothing to answer ---

test('rule 3 cuts emoji-only, punctuation-only, mention-only, and empty comments', () => {
  for (const text of ['', '   ', '😀❤️🙏', '???...!!!', '@shop @admin', '@someone 🙏']) {
    assert.equal(isNothingToAnswer(text), true, JSON.stringify(text))
    assert.equal(
      judgePlainRule({ id: 'x', text, isOwn: false }, ctx()),
      SKIP_NO_TEXT,
      JSON.stringify(text),
    )
  }
})

test('rule 3 keeps short buying-interest comments', () => {
  for (const text of ['555', '+1', 'สนใจ', 'ราคา?', 'สนใจครับ', 'how much', 'a', '9']) {
    assert.equal(isNothingToAnswer(text), false, JSON.stringify(text))
    assert.equal(
      judgePlainRule({ id: 'x', text, isOwn: false }, ctx()),
      null,
      JSON.stringify(text),
    )
  }
})

// --- Rule 4: viewer replying to another viewer ---

test('rule 4 cuts a viewer reply to another viewer', () => {
  assert.equal(
    judgePlainRule({ id: 'f', text: 'I bought it too', isOwn: false, parentId: 'v' }, ctx(['r'])),
    SKIP_VIEWER_TO_VIEWER,
  )
})

test('a viewer answering under our own comment stays new', () => {
  assert.equal(
    judgePlainRule({ id: 'f', text: 'Do you deliver here', isOwn: false, parentId: 'r' }, ctx(['r'])),
    null,
  )
  assert.equal(
    judgePlainRule({ id: 't', text: 'What time do you open', isOwn: false }, ctx(['r'])),
    null,
  )
})

// --- Integration: poll rounds with the fake adapter ---

const H = (h: number) => new Date(Date.now() - h * 3600_000)
const fake = new FakeSocialAdapter()
registerSocialAdapter(fake)

function addAccount(): number {
  const ts = now()
  const res = db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId: `page-filter-${Math.random().toString(36).slice(2)}`,
    name: 'Fake Page',
    status: 'connected',
    accessToken: 'fake-token',
    watching: true,
    watchDays: 7,
    createdAt: ts,
    updatedAt: ts,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

const accountId = addAccount()
fake.seedPosts([{ id: 'fp-1', text: 'Sale post', createdAt: H(2) }])
fake.seedComments('fp-1', [
  { id: 'fv-1', postId: 'fp-1', text: 'How much is this?', authorName: 'Ann', createdAt: H(1), isOwn: false },
  { id: 'fv-2', postId: 'fp-1', text: '😀❤️', authorName: 'Bob', createdAt: H(1.5), isOwn: false },
  { id: 'fv-3', postId: 'fp-1', text: '@shop', authorName: 'Cat', createdAt: H(1.6), isOwn: false },
])

test('poll round skips plain-rule comments and leaves answerable ones new', async () => {
  await poller.runSocialPollRound()
  const rows = db.select().from(schema.socialComments).all()
    .filter(c => c.accountId === accountId)
  assert.equal(rows.length, 3)
  const byId = new Map(rows.map(r => [r.platformCommentId, r] as const))
  assert.equal(byId.get('fv-1')!.status, 'new')
  assert.equal(byId.get('fv-2')!.status, 'skipped')
  assert.equal(byId.get('fv-2')!.statusNote, SKIP_NO_TEXT)
  assert.equal(byId.get('fv-3')!.status, 'skipped')
  assert.equal(byId.get('fv-3')!.statusNote, SKIP_NO_TEXT)
})

test('a stored draft becomes skipped when the page answers it on the platform', async () => {
  const ts = now()
  db.update(schema.socialComments).set({ status: 'draft', updatedAt: ts })
    .where(and(eq(schema.socialComments.accountId, accountId), eq(schema.socialComments.platformCommentId, 'fv-1'))).run()
  fake.prependComment('fp-1', {
    id: 'fr-1', postId: 'fp-1', text: 'It is 199 bath', authorName: 'Page',
    createdAt: new Date(), isOwn: true, parentId: 'fv-1',
  })
  await poller.runSocialPollRound()
  const rows = db.select().from(schema.socialComments).all()
    .filter(c => c.accountId === accountId)
  const byId = new Map(rows.map(r => [r.platformCommentId, r] as const))
  assert.equal(byId.get('fv-1')!.status, 'skipped')
  assert.equal(byId.get('fv-1')!.statusNote, SKIP_ALREADY_REPLIED)
  assert.equal(byId.get('fr-1')!.status, 'skipped')
  assert.equal(byId.get('fr-1')!.statusNote, SKIP_OWN)
})

test('board route shows the skipped rule name', async () => {
  const res = await social.request(`/comments?account_id=${accountId}`)
  assert.equal(res.status, 200)
  const json = await res.json() as any
  const items = json.data.items as Array<Record<string, any>>
  const skipped = items.filter(i => i.status === 'skipped')
  assert.ok(skipped.length >= 3)
  assert.ok(skipped.every(i => typeof i.statusNote === 'string' && i.statusNote.length > 0))
  assert.ok(skipped.some(i => i.statusNote === SKIP_ALREADY_REPLIED))
})

test('a replied comment does not change when our own reply is read back', async () => {
  // mark fv-1 as replied by us with platform id fr-1 (already stored above)
  const ts = now()
  db.update(schema.socialComments)
    .set({ status: 'replied', replyPlatformId: 'fr-1', repliedAt: ts, updatedAt: ts })
    .where(and(eq(schema.socialComments.accountId, accountId), eq(schema.socialComments.platformCommentId, 'fv-1'))).run()
  await poller.runSocialPollRound()
  const [row] = db.select().from(schema.socialComments)
    .where(eq(schema.socialComments.platformCommentId, 'fv-1')).all()
    .filter(c => c.accountId === accountId)
  assert.equal(row.status, 'replied')
  assert.equal(row.replyPlatformId, 'fr-1')
})
