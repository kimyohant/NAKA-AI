/**
 * Social Auto Reply ticket 05 — a person acts on a Comment.
 * Fake adapter (`fake`) + scripted LLM via the Mastra getter swap.
 * Covers: approve (stored text, `approved`), edited/hand-written (`manual`),
 * concurrent double send, stuck `sending` reclaim, reject / do-not-reply /
 * bring-back, brought-back comments never re-judged, the five send-failure
 * kinds, send refused when not connected, help-me-draft side-effect free,
 * wrong-state actions refused.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-actions-'))
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

// --- Fake LLM for help-me-draft ---
const llmQueue: Array<string | Error> = []
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => {
  if (type !== 'social_responder') return realGetAgent(type)
  return {
    generate: async (messages: Array<{ content: string }>) => {
      const next = llmQueue.shift()
      if (next instanceof Error) throw next
      if (next === undefined) throw new Error('no scripted LLM reply left')
      return { text: next }
    },
  }
}

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
    platformCommentId: `a-${seq}-${Math.random().toString(36).slice(2)}`,
    text: 'How much?',
    authorName: 'Viewer',
    commentedAt: ts,
    status: 'needs_human',
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

async function postAction(id: number, action: string, body?: unknown) {
  const res = await social.request(`/comments/${id}/${action}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json() as any
  return { status: res.status, json }
}

const acc = addAccount()
const post = addPost(acc)

// --- Approve / manual sends ---

test('approve publishes the stored text once: replied, approved, platform reply id', async () => {
  const id = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'It is 99 THB.',
  })
  const sentBefore = fake.sentReplies.length
  const { status, json } = await postAction(id, 'approve')
  assert.equal(status, 200)
  assert.equal(json.data.status, 'replied')
  assert.equal(json.data.replySource, 'approved')
  assert.equal(json.data.replyText, 'It is 99 THB.')
  const c = row(id)
  assert.equal(c.status, 'replied')
  assert.equal(c.replySource, 'approved')
  assert.ok(c.replyPlatformId)
  assert.ok(c.repliedAt)
  assert.equal(fake.sentReplies.length, sentBefore + 1)
  assert.equal(fake.sentReplies[fake.sentReplies.length - 1].text, 'It is 99 THB.')
})

test('an edited draft and a hand-written reply are published as manual', async () => {
  const draftId = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'It is 99 THB.',
  })
  const r1 = await postAction(draftId, 'send', { text: 'It is 99 THB, free delivery.' })
  assert.equal(r1.status, 200)
  assert.equal(r1.json.data.replySource, 'manual')
  assert.equal(row(draftId).replyText, 'It is 99 THB, free delivery.')

  const humanId = addComment(acc, post, { status: 'needs_human', verdict: 'human', reason: 'complaint' })
  const r2 = await postAction(humanId, 'send', { text: 'Sorry, please message us.' })
  assert.equal(r2.status, 200)
  assert.equal(r2.json.data.status, 'replied')
  assert.equal(row(humanId).replySource, 'manual')
})

test('two sends of the same comment at the same time give exactly one reply', async () => {
  const id = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'It is 99 THB.',
  })
  const sentBefore = fake.sentReplies.length
  const [a, b] = await Promise.allSettled([
    actions.sendCommentAsPerson(id),
    actions.sendCommentAsPerson(id),
  ])
  const ok = [a, b].filter(r => r.status === 'fulfilled')
  const failed = [a, b].filter(r => r.status === 'rejected')
  assert.equal(ok.length, 1)
  assert.equal(failed.length, 1)
  assert.equal(fake.sentReplies.length, sentBefore + 1)
  assert.equal(row(id).status, 'replied')
})

// --- Stuck sending ---

test('a sending row older than 5 minutes becomes needs_human, nothing sent', async () => {
  const old = new Date(Date.now() - 6 * 60_000).toISOString()
  const id = addComment(acc, post, {
    status: 'sending', verdict: 'reply', reason: 'price', replyText: 'Hi.',
    createdAt: old, updatedAt: old,
  })
  const sentBefore = fake.sentReplies.length
  const n = actions.reclaimStuckSending()
  assert.ok(n >= 1)
  const c = row(id)
  assert.equal(c.status, 'needs_human')
  assert.equal(c.statusNote, 'send not confirmed, check on the Platform')
  assert.equal(fake.sentReplies.length, sentBefore)

  // a fresh sending row is left alone
  const freshId = addComment(acc, post, { status: 'sending', replyText: 'Hi.' })
  assert.equal(actions.reclaimStuckSending(), 0)
  assert.equal(row(freshId).status, 'sending')
  db.update(schema.socialComments).set({ status: 'replied' })
    .where(eq(schema.socialComments.id, freshId)).run()
})

test('the first step of a poll round reclaims stuck sending', async () => {
  const wacc = addAccount({ watching: false })
  const wpost = addPost(wacc)
  const old = new Date(Date.now() - 10 * 60_000).toISOString()
  const id = addComment(wacc, wpost, { status: 'sending', replyText: 'Hi.', createdAt: old, updatedAt: old })
  fake.seedPosts([])
  await poller.runSocialPollRound()
  assert.equal(row(id).status, 'needs_human')
  assert.equal(row(id).statusNote, 'send not confirmed, check on the Platform')
})

// --- Reject / close / bring back ---

test('reject, do-not-reply, and bring-back move states with the right notes', async () => {
  const draftId = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  const r1 = await postAction(draftId, 'reject')
  assert.equal(r1.status, 200)
  assert.equal(row(draftId).status, 'skipped')
  assert.equal(row(draftId).statusNote, 'rejected by user')

  const humanId = addComment(acc, post, { status: 'needs_human', verdict: 'human', reason: 'complaint' })
  const r2 = await postAction(humanId, 'close')
  assert.equal(r2.status, 200)
  assert.equal(row(humanId).status, 'skipped')
  assert.equal(row(humanId).statusNote, 'closed by user')

  const r3 = await postAction(humanId, 'bring-back')
  assert.equal(r3.status, 200)
  assert.equal(r3.json.data.status, 'needs_human')
  assert.equal(row(humanId).status, 'needs_human')
})

test('a brought-back comment is not judged again by the next polling round', async () => {
  const id = addComment(acc, post, {
    status: 'skipped', verdict: null, statusNote: 'no text to answer',
  })
  actions.bringBackComment(id)
  assert.equal(row(id).status, 'needs_human')
  const judged = await responder.judgeNewComments(acc)
  // the brought-back row is needs_human, so judging only touches other `new` rows
  const c = row(id)
  assert.equal(c.status, 'needs_human')
  assert.equal(c.verdict, null)
  assert.equal(judged.judged, 0)
})

// --- Five error kinds ---

test('each send-failure kind gives the ticket table result', async () => {
  // rate_limited from needs_human: back to needs_human, error shown
  const rl = addComment(acc, post, { status: 'needs_human', verdict: 'human', reason: 'x' })
  fake.failNext('rate_limited')
  await assert.rejects(actions.sendCommentAsPerson(rl, 'Hello.'), /rate_limited/)
  assert.equal(row(rl).status, 'needs_human')
  assert.ok((row(rl).statusNote ?? '').startsWith('send failed:'))

  // auth_expired: draft + reconnect needed
  const ae = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('auth_expired')
  await assert.rejects(actions.sendCommentAsPerson(ae), /auth_expired/)
  assert.equal(row(ae).status, 'draft')
  assert.equal(accRow(acc).status, 'reconnect_needed')
  db.update(schema.socialAccounts).set({ status: 'connected' })
    .where(eq(schema.socialAccounts.id, acc)).run()

  // not_found: skipped, deleted on the Platform
  const nf = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('not_found')
  await assert.rejects(actions.sendCommentAsPerson(nf), /not_found/)
  assert.equal(row(nf).status, 'skipped')
  assert.equal(row(nf).statusNote, 'deleted on the Platform')

  // rejected: needs_human with the platform message
  const rj = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('rejected')
  await assert.rejects(actions.sendCommentAsPerson(rj), /rejected/)
  assert.equal(row(rj).status, 'needs_human')
  assert.ok((row(rj).statusNote ?? '').includes('rejected'))

  // unknown: back to draft, error shown
  const un = addComment(acc, post, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  fake.failNext('unknown')
  await assert.rejects(actions.sendCommentAsPerson(un), /unknown/)
  assert.equal(row(un).status, 'draft')
  assert.ok((row(un).statusNote ?? '').startsWith('send failed:'))
})

// --- Guards ---

test('send is refused when the social account is not connected', async () => {
  const off = addAccount({ status: 'reconnect_needed' })
  const offPost = addPost(off)
  const id = addComment(off, offPost, {
    status: 'draft', verdict: 'reply', reason: 'price', replyText: 'Hi.',
  })
  const sentBefore = fake.sentReplies.length
  const { status } = await postAction(id, 'approve')
  assert.equal(status, 400)
  assert.equal(row(id).status, 'draft')
  assert.equal(fake.sentReplies.length, sentBefore)
})

test('help me draft returns text, changes no row, sends nothing', async () => {
  const id = addComment(acc, post, { status: 'needs_human', verdict: 'human', reason: 'complaint' })
  llmQueue.push(JSON.stringify({ verdict: 'reply', reason: 'draft', reply: 'Sorry, message us.' }))
  const sentBefore = fake.sentReplies.length
  const before = row(id)
  const { status, json } = await postAction(id, 'help-draft')
  assert.equal(status, 200)
  assert.equal(json.data.text, 'Sorry, message us.')
  const after = row(id)
  assert.deepEqual(
    [after.status, after.verdict, after.replyText, after.statusNote],
    [before.status, before.verdict, before.replyText, before.statusNote],
  )
  assert.equal(fake.sentReplies.length, sentBefore)
})

test('actions on a comment in the wrong state are refused', async () => {
  const id = addComment(acc, post, {
    status: 'replied', verdict: 'reply', reason: 'price',
    replyText: 'Hi.', replySource: 'approved',
  })
  assert.equal((await postAction(id, 'approve')).status, 400)
  assert.equal((await postAction(id, 'send', { text: 'Again' })).status, 400)
  assert.equal((await postAction(id, 'reject')).status, 400)
  assert.equal((await postAction(id, 'close')).status, 400)
  assert.equal((await postAction(id, 'bring-back')).status, 400)
  assert.equal(row(id).status, 'replied')
})

test('hand-written text must only fit the adapter limit', async () => {
  const id = addComment(acc, post, { status: 'needs_human', verdict: 'human', reason: 'x' })
  const long = 'a'.repeat(fake.capabilities.maxReplyChars + 1)
  const { status } = await postAction(id, 'send', { text: long })
  assert.equal(status, 400)
  assert.equal(row(id).status, 'needs_human')
  assert.equal((await postAction(id, 'send', { text: '' })).status, 400)
})
