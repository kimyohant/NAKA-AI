/**
 * Social Auto Reply ticket 06 — Auto mode.
 * Fake adapter (`fake`) + scripted LLM via the Mastra getter swap, temporary
 * SQLite file, runs in CI via `test:social`.
 * Covers: the two end-to-end paths (draft + auto), only `reply` queued,
 * 24h gates (judge + waiting), unjudgeable never sent, 10-per-round
 * oldest-first, the queued send-failure table incl. unknown x3, mode switch
 * leaving drafts alone, watching off (queued waits, person sends work),
 * `reply_source` auto, and queued rows on the board route.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-auto-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const { registerSocialAdapter } = await import('../src/services/social/registry.js')
const actions = await import('../src/services/social/actions.js')
const responder = await import('../src/services/social/responder.js')
const poller = await import('../src/services/social/poller.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')
const { mastra } = await import('../src/mastra/index.js')
const { default: social } = await import('../src/routes/social.js')

{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const fake = new FakeSocialAdapter()
registerSocialAdapter(fake)

// --- Fake LLM (same seam as the other social tests) ---
const llmQueue: Array<string | Error> = []
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => {
  if (type !== 'social_responder') return realGetAgent(type)
  return {
    generate: async () => {
      const next = llmQueue.shift()
      if (next instanceof Error) throw next
      if (next === undefined) throw new Error('no scripted LLM reply left')
      return { text: next }
    },
  }
}
const verdict = (v: string, reason: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ verdict: v, reason, ...extra })

// --- Seed helpers ---
function addAccount(values: Record<string, unknown> = {}): number {
  const ts = now()
  const res = db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId: `page-${Math.random().toString(36).slice(2)}`,
    name: 'Fake Page',
    status: 'connected',
    accessToken: 'fake-token',
    watching: true,
    watchDays: 7,
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

function addPost(accountId: number): number {
  const ts = now()
  const res = db.insert(schema.socialPosts).values({
    accountId, platformPostId: `p-${Math.random().toString(36).slice(2)}`,
    text: 'Post text', postedAt: ts, createdAt: ts, updatedAt: ts,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

let seq = 0
function addComment(accountId: number, postId: number | null, values: Record<string, unknown> = {}): number {
  seq++
  const ts = now()
  const res = db.insert(schema.socialComments).values({
    accountId,
    postId,
    platformCommentId: `auto-${seq}-${Math.random().toString(36).slice(2)}`,
    text: 'How much?',
    authorName: 'Viewer',
    commentedAt: new Date().toISOString(),
    status: 'new',
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

const row = (id: number) =>
  db.select().from(schema.socialComments).all().find(r => r.id === id)!
const accRow = (id: number) =>
  db.select().from(schema.socialAccounts).all().find(r => r.id === id)!

const H = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
/** replaceable 3s gap wait, so the suite stays fast */
const noWait = async () => {}
const noGap = { waitBetweenSends: noWait }

/** only this account is watched this round; the fake platform is empty */
function quietRoundFor(id: number): void {
  db.update(schema.socialAccounts).set({ watching: false }).run()
  db.update(schema.socialAccounts).set({ watching: true })
    .where(eq(schema.socialAccounts.id, id)).run()
  fake.seedPosts([])
  fake.commentsByPost.clear()
  fake.failQueue.length = 0
  llmQueue.length = 0
}

// --- End to end: draft path ---

test('draft path: comment in, draft, approve, replied', async () => {
  const acc = addAccount({ platformAccountId: 'e2e-draft' }) // draft mode default
  quietRoundFor(acc)
  fake.seedPosts([{ id: 'post-draft', text: 'Launch day', createdAt: new Date() }])
  fake.seedComments('post-draft', [
    { id: 'draft-c1', postId: 'post-draft', text: 'How much is it?', authorName: 'Ann', createdAt: new Date(), isOwn: false },
  ])
  llmQueue.push(verdict('reply', 'price question', { reply: 'It is 99 THB.' }))
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  const stored = db.select().from(schema.socialComments).all().filter(c => c.accountId === acc)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].status, 'draft')
  assert.equal(stored[0].verdict, 'reply')
  assert.equal(fake.sentReplies.length, sentBefore) // draft mode sends nothing

  await actions.sendCommentAsPerson(stored[0].id)
  const c = row(stored[0].id)
  assert.equal(c.status, 'replied')
  assert.equal(c.replySource, 'approved')
  assert.equal(fake.sentReplies.length, sentBefore + 1)
})

// --- End to end: auto path ---

test('auto path: comment in, queued, sent, replied with source auto', async () => {
  const acc = addAccount({ platformAccountId: 'e2e-auto', replyMode: 'auto' })
  quietRoundFor(acc)
  fake.seedPosts([{ id: 'post-auto', text: 'Launch day', createdAt: new Date() }])
  fake.seedComments('post-auto', [
    { id: 'auto-c1', postId: 'post-auto', text: 'How much is it?', authorName: 'Ann', createdAt: new Date(), isOwn: false },
  ])
  llmQueue.push(verdict('reply', 'price question', { reply: 'It is 99 THB.' }))
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  const stored = db.select().from(schema.socialComments).all().filter(c => c.accountId === acc)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].status, 'replied')
  assert.equal(stored[0].replySource, 'auto')
  assert.ok(stored[0].replyPlatformId)
  assert.equal(fake.sentReplies.length, sentBefore + 1)
  assert.equal(fake.sentReplies[fake.sentReplies.length - 1].text, 'It is 99 THB.')
})

test('judging alone in auto mode leaves a fresh reply queued', async () => {
  const acc = addAccount({ platformAccountId: 'q-alone', replyMode: 'auto' })
  quietRoundFor(acc)
  const post = addPost(acc)
  const id = addComment(acc, post, { text: 'How much?' })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  assert.equal(row(id).status, 'queued')
  assert.equal(row(id).verdict, 'reply')
})

// --- Auto gate: only `reply` ---

test('auto mode queues only reply: human, unsure, skip are never queued or sent', async () => {
  const acc = addAccount({ platformAccountId: 'gate', replyMode: 'auto' })
  quietRoundFor(acc)
  const post = addPost(acc)
  const a = addComment(acc, post, { text: 'Unclear one', commentedAt: H(3) })
  const b = addComment(acc, post, { text: 'Refund now', commentedAt: H(2) })
  const c = addComment(acc, post, { text: 'Buy followers', commentedAt: H(1) })
  // judged newest first: c, b, a
  llmQueue.push(
    verdict('skip', 'spam'),
    verdict('human', 'refund request'),
    verdict('unsure', 'unclear intent'),
  )
  await responder.judgeNewComments(acc)
  assert.equal(row(c).status, 'skipped')
  assert.equal(row(b).status, 'needs_human')
  assert.equal(row(a).status, 'needs_human')

  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal(fake.sentReplies.length, sentBefore)
  assert.equal(row(c).status, 'skipped')
  assert.equal(row(b).status, 'needs_human')
  assert.equal(row(a).status, 'needs_human')
})

// --- 24h gates ---

test('a reply verdict on a comment older than 24h becomes a draft in auto mode', async () => {
  const acc = addAccount({ platformAccountId: 'old-judge', replyMode: 'auto' })
  quietRoundFor(acc)
  const post = addPost(acc)
  const id = addComment(acc, post, { text: 'How much?', commentedAt: H(25) })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  const c = row(id)
  assert.equal(c.status, 'draft')
  assert.equal(c.verdict, 'reply')
  assert.equal(c.replyText, 'It is 99 THB.')
})

test('a queued comment that aged past 24h becomes a draft and is not sent', async () => {
  const acc = addAccount({ platformAccountId: 'old-queued', replyMode: 'auto' })
  quietRoundFor(acc)
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price',
    replyText: 'It is 99 THB.', commentedAt: H(25),
  })
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal(row(id).status, 'draft')
  assert.equal(row(id).replyText, 'It is 99 THB.') // a person can still send it
  assert.equal(fake.sentReplies.length, sentBefore)
})

// --- Unjudgeable ---

test('a comment that could not be judged is never sent', async () => {
  const acc = addAccount({ platformAccountId: 'nojudge', replyMode: 'auto' })
  quietRoundFor(acc)
  const post = addPost(acc)
  const id = addComment(acc, post, { text: 'Is this available?' })
  llmQueue.push(new Error('boom'), new Error('boom'), new Error('boom'))
  await responder.judgeNewComments(acc)
  await responder.judgeNewComments(acc)
  await responder.judgeNewComments(acc)
  assert.equal(row(id).status, 'needs_human')
  assert.equal(row(id).statusNote, 'could not judge')
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal(row(id).status, 'needs_human')
  assert.equal(fake.sentReplies.length, sentBefore)
})

// --- Round limits ---

test('at most 10 replies per round, oldest first, rest stay queued', async () => {
  const acc = addAccount({ platformAccountId: 'ten', replyMode: 'auto' })
  quietRoundFor(acc)
  const post = addPost(acc)
  const ids: number[] = []
  for (let i = 1; i <= 12; i++) {
    ids.push(addComment(acc, post, {
      text: `Question ${i}h ago`,
      platformCommentId: `ten-${i}`,
      status: 'queued', verdict: 'reply', reason: 'price',
      replyText: `Answer ${i}.`, commentedAt: H(i),
    }))
  }
  const sentBefore = fake.sentReplies.length
  const r = await poller.runSocialPollRound(noGap)
  assert.equal(r.skipped, false)
  assert.equal(fake.sentReplies.length, sentBefore + 10)
  const replied = ids.map(row).filter(c => c.status === 'replied')
  const waiting = ids.map(row).filter(c => c.status === 'queued')
  assert.equal(replied.length, 10)
  assert.equal(waiting.length, 2)
  // oldest first: the two newest (1h, 2h ago) wait
  assert.deepEqual(
    waiting.map(c => c.platformCommentId).sort(),
    ['ten-1', 'ten-2'],
  )
  for (const c of replied) assert.equal(c.replySource, 'auto')
})

// --- Queued send-failure table ---

test('queued rate_limited goes back to queued and pauses the account', async () => {
  const acc = addAccount({ platformAccountId: 'q-rate', replyMode: 'auto' })
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('rate_limited')
  const r = await actions.sendQueuedReplies(acc, noGap)
  assert.equal(r.sent, 0)
  assert.equal(r.rateLimited, true)
  assert.equal(row(id).status, 'queued')
  assert.equal(accRow(acc).status, 'connected')
  assert.ok(accRow(acc).pausedUntil, 'expected paused_until to be set')
  assert.ok(Date.parse(accRow(acc).pausedUntil!) > Date.now())
})

test('queued auth_expired goes to draft and the account needs reconnect', async () => {
  const acc = addAccount({ platformAccountId: 'q-auth', replyMode: 'auto' })
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('auth_expired')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal(row(id).status, 'draft')
  assert.equal(accRow(acc).status, 'reconnect_needed')
})

test('queued not_found is skipped as deleted on the platform', async () => {
  const acc = addAccount({ platformAccountId: 'q-gone', replyMode: 'auto' })
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('not_found')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal(row(id).status, 'skipped')
  assert.equal(row(id).statusNote, 'deleted on the Platform')
})

test('queued rejected goes to needs_human with the platform message', async () => {
  const acc = addAccount({ platformAccountId: 'q-rej', replyMode: 'auto' })
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('rejected')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal(row(id).status, 'needs_human')
  assert.ok((row(id).statusNote ?? '').includes('rejected'))
})

test('queued unknown goes back to queued, then needs_human after 3 rounds', async () => {
  const acc = addAccount({ platformAccountId: 'q-unk', replyMode: 'auto' })
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('unknown')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal(row(id).status, 'queued')
  fake.failNext('unknown')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal(row(id).status, 'queued')
  fake.failNext('unknown')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal(row(id).status, 'needs_human')
})

// --- Mode switch / watching ---

test('switching to auto does not send drafts that already wait', async () => {
  const acc = addAccount({ platformAccountId: 'switch' }) // draft mode
  quietRoundFor(acc)
  const post = addPost(acc)
  const id = addComment(acc, post, { text: 'How much?' })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  assert.equal(row(id).status, 'draft')
  db.update(schema.socialAccounts).set({ replyMode: 'auto' })
    .where(eq(schema.socialAccounts.id, acc)).run()
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal(row(id).status, 'draft')
  assert.equal(row(id).verdict, 'reply') // untouched, like everything else stored
  assert.equal(fake.sentReplies.length, sentBefore)
})

test('watching off sends nothing, and a person send still works', async () => {
  const acc = addAccount({ platformAccountId: 'nowatch', replyMode: 'auto', watching: false })
  db.update(schema.socialAccounts).set({ watching: false }).run()
  fake.seedPosts([])
  fake.commentsByPost.clear()
  const post = addPost(acc)
  const queuedId = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  const draftId = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hello.',
  })
  const sentBefore = fake.sentReplies.length
  const r = await poller.runSocialPollRound(noGap)
  assert.equal(r.accounts, 0)
  assert.equal(row(queuedId).status, 'queued')
  assert.equal(fake.sentReplies.length, sentBefore)

  await actions.sendCommentAsPerson(draftId)
  assert.equal(row(draftId).status, 'replied')
  assert.equal(row(draftId).replySource, 'approved')
  assert.equal(fake.sentReplies.length, sentBefore + 1)
})

// --- Board ---

test('the board route returns queued comments', async () => {
  const acc = addAccount({ platformAccountId: 'board-q', replyMode: 'auto' })
  const post = addPost(acc)
  const id = addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  const res = await social.request(`/comments?account_id=${acc}`)
  assert.equal(res.status, 200)
  const json = await res.json() as any
  const found = (json.data.items as any[]).find(i => i.platformCommentId === row(id).platformCommentId)
  assert.ok(found)
  assert.equal(found.status, 'queued')
})
