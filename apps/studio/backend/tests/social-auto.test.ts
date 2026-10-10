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
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')

const { db, schema } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const { registerSocialAdapter } = await import('../src/modules/social/services/registry.js')
const actions = await import('../src/modules/social/services/actions.js')
const responder = await import('../src/modules/social/services/responder.js')
const poller = await import('../src/modules/social/services/poller.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')
const { mastra } = await import('../src/core/mastra/index.js')
const { default: social } = await import('../src/modules/social/routes/social.js')

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
async function addAccount(values: Record<string, unknown> = {}): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.socialAccounts).values({
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
  } as any).returning()
  return Number(res[0].id)
}

async function addPost(accountId: number): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.socialPosts).values({
    accountId, platformPostId: `p-${Math.random().toString(36).slice(2)}`,
    text: 'Post text', postedAt: ts, createdAt: ts, updatedAt: ts,
  } as any).returning()
  return Number(res[0].id)
}

let seq = 0
async function addComment(accountId: number, postId: number | null, values: Record<string, unknown> = {}): Promise<number> {
  seq++
  const ts = now()
  const res = await db.insert(schema.socialComments).values({
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
  } as any).returning()
  return Number(res[0].id)
}

const row = async (id: number) =>
  (await db.select().from(schema.socialComments)).find(r => r.id === id)!
const accRow = async (id: number) =>
  (await db.select().from(schema.socialAccounts)).find(r => r.id === id)!

const H = (h: number) => new Date(Date.now() - h * 3600_000).toISOString()
/** replaceable 3s gap wait, so the suite stays fast */
const noWait = async () => {}
const noGap = { waitBetweenSends: noWait }

/** only this account is watched this round; the fake platform is empty */
async function quietRoundFor(id: number): Promise<void> {
  await db.update(schema.socialAccounts).set({ watching: false })
  await db.update(schema.socialAccounts).set({ watching: true })
    .where(eq(schema.socialAccounts.id, id))
  fake.seedPosts([])
  fake.commentsByPost.clear()
  fake.failQueue.length = 0
  llmQueue.length = 0
}

// --- End to end: draft path ---

test('draft path: comment in, draft, approve, replied', async () => {
  const acc = await addAccount({ platformAccountId: 'e2e-draft' }) // draft mode default
  await quietRoundFor(acc)
  fake.seedPosts([{ id: 'post-draft', text: 'Launch day', createdAt: new Date() }])
  fake.seedComments('post-draft', [
    { id: 'draft-c1', postId: 'post-draft', text: 'How much is it?', authorName: 'Ann', createdAt: new Date(), isOwn: false },
  ])
  llmQueue.push(verdict('reply', 'price question', { reply: 'It is 99 THB.' }))
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  const stored = (await db.select().from(schema.socialComments)).filter(c => c.accountId === acc)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].status, 'draft')
  assert.equal(stored[0].verdict, 'reply')
  assert.equal(fake.sentReplies.length, sentBefore) // draft mode sends nothing

  await actions.sendCommentAsPerson(stored[0].id)
  const c = await row(stored[0].id)
  assert.equal(c.status, 'replied')
  assert.equal(c.replySource, 'approved')
  assert.equal(fake.sentReplies.length, sentBefore + 1)
})

// --- End to end: auto path ---

test('auto path: comment in, queued, sent, replied with source auto', async () => {
  const acc = await addAccount({ platformAccountId: 'e2e-auto', replyMode: 'auto' })
  await quietRoundFor(acc)
  fake.seedPosts([{ id: 'post-auto', text: 'Launch day', createdAt: new Date() }])
  fake.seedComments('post-auto', [
    { id: 'auto-c1', postId: 'post-auto', text: 'How much is it?', authorName: 'Ann', createdAt: new Date(), isOwn: false },
  ])
  llmQueue.push(verdict('reply', 'price question', { reply: 'It is 99 THB.' }))
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  const stored = (await db.select().from(schema.socialComments)).filter(c => c.accountId === acc)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].status, 'replied')
  assert.equal(stored[0].replySource, 'auto')
  assert.ok(stored[0].replyPlatformId)
  assert.equal(fake.sentReplies.length, sentBefore + 1)
  assert.equal(fake.sentReplies[fake.sentReplies.length - 1].text, 'It is 99 THB.')
})

test('judging alone in auto mode leaves a fresh reply queued', async () => {
  const acc = await addAccount({ platformAccountId: 'q-alone', replyMode: 'auto' })
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const id = await addComment(acc, post, { text: 'How much?' })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  assert.equal((await row(id)).status, 'queued')
  assert.equal((await row(id)).verdict, 'reply')
})

// --- Auto gate: only `reply` ---

test('auto mode queues only reply: human, unsure, skip are never queued or sent', async () => {
  const acc = await addAccount({ platformAccountId: 'gate', replyMode: 'auto' })
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const a = await addComment(acc, post, { text: 'Unclear one', commentedAt: H(3) })
  const b = await addComment(acc, post, { text: 'Refund now', commentedAt: H(2) })
  const c = await addComment(acc, post, { text: 'Buy followers', commentedAt: H(1) })
  // judged newest first: c, b, a
  llmQueue.push(
    verdict('skip', 'spam'),
    verdict('human', 'refund request'),
    verdict('unsure', 'unclear intent'),
  )
  await responder.judgeNewComments(acc)
  assert.equal((await row(c)).status, 'skipped')
  assert.equal((await row(b)).status, 'needs_human')
  assert.equal((await row(a)).status, 'needs_human')

  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal(fake.sentReplies.length, sentBefore)
  assert.equal((await row(c)).status, 'skipped')
  assert.equal((await row(b)).status, 'needs_human')
  assert.equal((await row(a)).status, 'needs_human')
})

// --- 24h gates ---

test('a reply verdict on a comment older than 24h becomes a draft in auto mode', async () => {
  const acc = await addAccount({ platformAccountId: 'old-judge', replyMode: 'auto' })
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const id = await addComment(acc, post, { text: 'How much?', commentedAt: H(25) })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  const c = await row(id)
  assert.equal(c.status, 'draft')
  assert.equal(c.verdict, 'reply')
  assert.equal(c.replyText, 'It is 99 THB.')
})

test('a queued comment that aged past 24h becomes a draft and is not sent', async () => {
  const acc = await addAccount({ platformAccountId: 'old-queued', replyMode: 'auto' })
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price',
    replyText: 'It is 99 THB.', commentedAt: H(25),
  })
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal((await row(id)).status, 'draft')
  assert.equal((await row(id)).replyText, 'It is 99 THB.') // a person can still send it
  assert.equal(fake.sentReplies.length, sentBefore)
})

// --- Unjudgeable ---

test('a comment that could not be judged is never sent', async () => {
  const acc = await addAccount({ platformAccountId: 'nojudge', replyMode: 'auto' })
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const id = await addComment(acc, post, { text: 'Is this available?' })
  llmQueue.push(new Error('boom'), new Error('boom'), new Error('boom'))
  await responder.judgeNewComments(acc)
  await responder.judgeNewComments(acc)
  await responder.judgeNewComments(acc)
  assert.equal((await row(id)).status, 'needs_human')
  assert.equal((await row(id)).statusNote, 'could not judge')
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal((await row(id)).status, 'needs_human')
  assert.equal(fake.sentReplies.length, sentBefore)
})

// --- Round limits ---

test('at most 10 replies per round, oldest first, rest stay queued', async () => {
  const acc = await addAccount({ platformAccountId: 'ten', replyMode: 'auto' })
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const ids: number[] = []
  for (let i = 1; i <= 12; i++) {
    ids.push(await addComment(acc, post, {
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
  const rows = await Promise.all(ids.map(row))
  const replied = rows.filter(c => c.status === 'replied')
  const waiting = rows.filter(c => c.status === 'queued')
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
  const acc = await addAccount({ platformAccountId: 'q-rate', replyMode: 'auto' })
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('rate_limited')
  const r = await actions.sendQueuedReplies(acc, noGap)
  assert.equal(r.sent, 0)
  assert.equal(r.rateLimited, true)
  assert.equal((await row(id)).status, 'queued')
  assert.equal((await accRow(acc)).status, 'connected')
  assert.ok((await accRow(acc)).pausedUntil, 'expected paused_until to be set')
  assert.ok(Date.parse((await accRow(acc)).pausedUntil!) > Date.now())
})

test('queued auth_expired goes to draft and the account needs reconnect', async () => {
  const acc = await addAccount({ platformAccountId: 'q-auth', replyMode: 'auto' })
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('auth_expired')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal((await row(id)).status, 'draft')
  assert.equal((await accRow(acc)).status, 'reconnect_needed')
})

test('queued not_found is skipped as deleted on the platform', async () => {
  const acc = await addAccount({ platformAccountId: 'q-gone', replyMode: 'auto' })
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('not_found')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal((await row(id)).status, 'skipped')
  assert.equal((await row(id)).statusNote, 'deleted on the Platform')
})

test('queued rejected goes to needs_human with the platform message', async () => {
  const acc = await addAccount({ platformAccountId: 'q-rej', replyMode: 'auto' })
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('rejected')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal((await row(id)).status, 'needs_human')
  assert.ok(((await row(id)).statusNote ?? '').includes('rejected'))
})

test('queued unknown goes back to queued, then needs_human after 3 rounds', async () => {
  const acc = await addAccount({ platformAccountId: 'q-unk', replyMode: 'auto' })
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('unknown')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal((await row(id)).status, 'queued')
  fake.failNext('unknown')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal((await row(id)).status, 'queued')
  fake.failNext('unknown')
  await actions.sendQueuedReplies(acc, noGap)
  assert.equal((await row(id)).status, 'needs_human')
})

// --- Mode switch / watching ---

test('switching to auto does not send drafts that already wait', async () => {
  const acc = await addAccount({ platformAccountId: 'switch' }) // draft mode
  await quietRoundFor(acc)
  const post = await addPost(acc)
  const id = await addComment(acc, post, { text: 'How much?' })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  assert.equal((await row(id)).status, 'draft')
  await db.update(schema.socialAccounts).set({ replyMode: 'auto' })
    .where(eq(schema.socialAccounts.id, acc))
  const sentBefore = fake.sentReplies.length
  await poller.runSocialPollRound(noGap)
  assert.equal((await row(id)).status, 'draft')
  assert.equal((await row(id)).verdict, 'reply') // untouched, like everything else stored
  assert.equal(fake.sentReplies.length, sentBefore)
})

test('watching off sends nothing, and a person send still works', async () => {
  const acc = await addAccount({ platformAccountId: 'nowatch', replyMode: 'auto', watching: false })
  await db.update(schema.socialAccounts).set({ watching: false })
  fake.seedPosts([])
  fake.commentsByPost.clear()
  const post = await addPost(acc)
  const queuedId = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  const draftId = await addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hello.',
  })
  const sentBefore = fake.sentReplies.length
  const r = await poller.runSocialPollRound(noGap)
  assert.equal(r.accounts, 0)
  assert.equal((await row(queuedId)).status, 'queued')
  assert.equal(fake.sentReplies.length, sentBefore)

  await actions.sendCommentAsPerson(draftId)
  assert.equal((await row(draftId)).status, 'replied')
  assert.equal((await row(draftId)).replySource, 'approved')
  assert.equal(fake.sentReplies.length, sentBefore + 1)
})

// --- Board ---

test('the board route returns queued comments', async () => {
  const acc = await addAccount({ platformAccountId: 'board-q', replyMode: 'auto' })
  const post = await addPost(acc)
  const id = await addComment(acc, post, {
    status: 'queued', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  const res = await social.request(`/comments?account_id=${acc}`)
  assert.equal(res.status, 200)
  const json = await res.json() as any
  const platformCommentId = (await row(id)).platformCommentId
  const found = (json.data.items as any[]).find(i => i.platformCommentId === platformCommentId)
  assert.ok(found)
  assert.equal(found.status, 'queued')
})
