/**
 * Social Auto Reply ticket 04 — verdict + draft with `social_responder`.
 * Fake LLM via the Mastra agent getter swap (same seam as the AI Live test).
 * Covers: verdict→state mapping, no reply text on needs_human, fallback flag
 * on the board route, praise switch, reply rules, rule-break retry, 3 failed
 * rounds, 50-per-round newest-first limit, input cuts + no viewer name,
 * already-judged comments, and the end-to-end poll round.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { eq } from 'drizzle-orm'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-verdict-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const { registerSocialAdapter } = await import('../src/services/social/registry.js')
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

// --- Fake LLM (same seam as the AI Live test) ---

type Scripted = string | Error
const llmQueue: Scripted[] = []
const seenPayloads: any[] = []
let generateCalls = 0
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => {
  if (type !== 'social_responder') return realGetAgent(type)
  return {
    generate: async (messages: Array<{ content: string }>) => {
      generateCalls++
      seenPayloads.push(JSON.parse(messages[0].content))
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
    replyToPraise: true,
    brandAbout: 'We sell jasmine soap',
    brandFaq: 'Price 99 THB. Delivery 2 days.',
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

function addPost(accountId: number, platformPostId: string, text: string): number {
  const ts = now()
  const res = db.insert(schema.socialPosts).values({
    accountId, platformPostId, text, postedAt: ts, createdAt: ts, updatedAt: ts,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

let commentSeq = 0
function addComment(accountId: number, postId: number | null, values: Record<string, unknown> = {}): number {
  commentSeq++
  const ts = now()
  const res = db.insert(schema.socialComments).values({
    accountId,
    postId,
    platformCommentId: `v-${commentSeq}-${Math.random().toString(36).slice(2)}`,
    text: 'How much?',
    authorName: 'Viewer',
    commentedAt: new Date(Date.now() - commentSeq * 1000).toISOString(),
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

const acc = addAccount()
const post = addPost(acc, 'post-v', 'Post text')

// --- Verdict → state ---

test('reply verdict becomes draft with the reply text stored', async () => {
  const id = addComment(acc, post, { text: 'How much is it?' })
  llmQueue.push(verdict('reply', 'price question', { reply: 'It is 99 THB.', fallback: false }))
  const r = await responder.judgeNewComments(acc)
  assert.equal(r.judged, 1)
  const c = row(id)
  assert.equal(c.status, 'draft')
  assert.equal(c.verdict, 'reply')
  assert.equal(c.reason, 'price question')
  assert.equal(c.replyText, 'It is 99 THB.')
  assert.equal(c.fallback, false)
  assert.equal(c.replySource, null)
})

test('skip verdict becomes skipped; human and unsure become needs_human', async () => {
  const ids = [
    addComment(acc, post, { text: 'Buy followers cheap' }),
    addComment(acc, post, { text: 'I want a refund, this is broken' }),
    addComment(acc, post, { text: 'Hmm not sure what this means' }),
  ]
  // newest-first: last inserted has the oldest timestamp, judged last
  llmQueue.push(
    verdict('skip', 'spam'),
    verdict('human', 'refund request'),
    verdict('unsure', 'unclear intent'),
  )
  // reverse: newest (first inserted, smallest commentSeq offset) is judged first
  const before = generateCalls
  await responder.judgeNewComments(acc)
  assert.equal(generateCalls - before, 3)
  assert.equal(row(ids[0]).status, 'skipped')
  assert.equal(row(ids[0]).verdict, 'skip')
  assert.equal(row(ids[0]).statusNote, 'spam')
  assert.equal(row(ids[1]).status, 'needs_human')
  assert.equal(row(ids[1]).verdict, 'human')
  assert.equal(row(ids[2]).status, 'needs_human')
  assert.equal(row(ids[2]).verdict, 'unsure')
})

test('needs_human stores no reply text even when the LLM sends one', async () => {
  const id = addComment(acc, post, { text: 'I will sue you' })
  llmQueue.push(verdict('human', 'legal threat', { reply: 'Sorry!' }))
  await responder.judgeNewComments(acc)
  const c = row(id)
  assert.equal(c.status, 'needs_human')
  assert.equal(c.replyText, null)
})

test('fallback reply is stored and the board route returns it', async () => {
  const id = addComment(acc, post, { text: 'Do you ship to Chiang Mai?' })
  llmQueue.push(verdict('reply', 'shipping not in faq', { reply: 'Please message our Page.', fallback: true }))
  await responder.judgeNewComments(acc)
  assert.equal(row(id).fallback, true)
  assert.equal(row(id).status, 'draft')
  const res = await social.request(`/comments?account_id=${acc}&fallback_only=1`)
  assert.equal(res.status, 200)
  const json = await res.json() as any
  const found = (json.data.items as any[]).find(i => i.platformCommentId === row(id).platformCommentId)
  assert.ok(found)
  assert.equal(found.fallback, true)
  assert.equal(found.replyText, 'Please message our Page.')
})

test('praise is skipped when reply-to-praise is off, drafted when on', async () => {
  const offAcc = addAccount({ platformAccountId: 'praise-off', replyToPraise: false })
  const onAcc = addAccount({ platformAccountId: 'praise-on', replyToPraise: true })
  const offPost = addPost(offAcc, 'post-praise-off', 'Post')
  const onPost = addPost(onAcc, 'post-praise-on', 'Post')
  const offId = addComment(offAcc, offPost, { text: 'สวยมากค่ะ' })
  const onId = addComment(onAcc, onPost, { text: 'สวยมากค่ะ' })
  llmQueue.push(verdict('skip', 'praise, switch off'))
  await responder.judgeNewComments(offAcc)
  assert.equal(row(offId).status, 'skipped')
  llmQueue.push(verdict('reply', 'praise', { reply: 'ขอบคุณมากค่ะ' }))
  await responder.judgeNewComments(onAcc)
  assert.equal(row(onId).status, 'draft')
  assert.equal(row(onId).replyText, 'ขอบคุณมากค่ะ')
})

// --- Reply rules (pure unit tests) ---

test('reply rules: length, adapter limit, emoji, url, handle, hashtag', () => {
  assert.equal(responder.checkReplyRules('a'.repeat(300), 300), null)
  assert.ok(responder.checkReplyRules('a'.repeat(301), 500) !== null)
  assert.ok(responder.checkReplyRules('a'.repeat(60), 50) !== null)
  assert.equal(responder.checkReplyRules('a'.repeat(60), 300), null)
  assert.equal(responder.checkReplyRules('Thanks! 😀', 300), null)
  assert.ok(responder.checkReplyRules('Thanks! 😀🎉', 300) !== null)
  assert.ok(responder.checkReplyRules('See https://x.com/a for details', 300) !== null)
  assert.ok(responder.checkReplyRules('See www.example.com for details', 300) !== null)
  assert.ok(responder.checkReplyRules('Hi @shop please answer', 300) !== null)
  assert.ok(responder.checkReplyRules('Big #sale today', 300) !== null)
  assert.equal(responder.checkReplyRules('สวัสดีค่ะ สินค้าราคา 99 บาท', 300), null)
})

test('a reply that breaks a rule is retried next round and never stored cut', async () => {
  const id = addComment(acc, post, { text: 'How much?' })
  const long = 'x'.repeat(400)
  llmQueue.push(verdict('reply', 'price', { reply: long }))
  await responder.judgeNewComments(acc)
  let c = row(id)
  assert.equal(c.status, 'new')
  assert.equal(c.replyText, null)
  assert.equal(c.verdict, null)
  assert.equal(c.judgeAttempts, 1)
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(acc)
  c = row(id)
  assert.equal(c.status, 'draft')
  assert.equal(c.replyText, 'It is 99 THB.')
})

test('three failed rounds give needs_human with "could not judge"', async () => {
  const id = addComment(acc, post, { text: 'Is this available?' })
  llmQueue.push('garbage output', new Error('boom'), verdict('reply', 'x', { reply: 'Hi @shop' }))
  await responder.judgeNewComments(acc)
  assert.equal(row(id).status, 'new')
  await responder.judgeNewComments(acc)
  assert.equal(row(id).status, 'new')
  await responder.judgeNewComments(acc)
  const c = row(id)
  assert.equal(c.status, 'needs_human')
  assert.equal(c.statusNote, 'could not judge')
  assert.equal(c.replyText, null)
  assert.equal(c.verdict, null)
})

// --- Round limits and input shape ---

test('at most 50 comments judged per round, newest first, rest stay new', async () => {
  const limitAcc = addAccount({ platformAccountId: 'limit-acc' })
  const limitPost = addPost(limitAcc, 'post-limit', 'Post')
  const ids: number[] = []
  for (let i = 0; i < 55; i++) {
    ids.push(addComment(limitAcc, limitPost, { text: `Question ${i}` }))
  }
  for (let i = 0; i < 55; i++) {
    llmQueue.push(verdict('reply', 'q', { reply: `Answer ${i}.` }))
  }
  const callsBefore = generateCalls
  const r = await responder.judgeNewComments(limitAcc)
  assert.equal(r.judged, 50)
  assert.equal(generateCalls - callsBefore, 50)
  const rows = ids.map(row)
  const drafted = rows.filter(c => c.status === 'draft')
  const fresh = rows.filter(c => c.status === 'new')
  assert.equal(drafted.length, 50)
  assert.equal(fresh.length, 5)
  // newest = smallest commentSeq offset = judged; the 5 oldest stay new
  const freshTexts = new Set(fresh.map(c => c.text))
  assert.ok(freshTexts.has('Question 50'))
  assert.ok(freshTexts.has('Question 54'))
  assert.ok(!freshTexts.has('Question 0'))
})

test('payload cuts post to 1000 and comment to 500 with no viewer name', async () => {
  const cutAcc = addAccount({ platformAccountId: 'cut-acc' })
  const cutPost = addPost(cutAcc, 'post-cut', 'p'.repeat(1200))
  addComment(cutAcc, cutPost, { text: 'c'.repeat(600), authorName: 'Somchai Realname' })
  llmQueue.length = 0
  seenPayloads.length = 0
  llmQueue.push(verdict('reply', 'q', { reply: 'Hi.' }))
  await responder.judgeNewComments(cutAcc)
  assert.equal(seenPayloads.length, 1)
  const p = seenPayloads[0]
  assert.equal(p.post.length, 1000)
  assert.equal(p.comment.length, 500)
  assert.equal(p.mode, 'judge')
  assert.equal(p.replyToPraise, true)
  assert.ok(!JSON.stringify(p).includes('Somchai'))
})

test('earlier reply is sent only for a viewer answering under our reply', async () => {
  const erAcc = addAccount({ platformAccountId: 'earlier-acc' })
  const erPost = addPost(erAcc, 'post-er', 'Post')
  addComment(erAcc, erPost, {
    platformCommentId: 'viewer-top', text: 'How much?', parentPlatformCommentId: null,
  })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  await responder.judgeNewComments(erAcc)
  const parent = db.select().from(schema.socialComments).all()
    .find(r => r.platformCommentId === 'viewer-top')!
  // simulate our published reply stored on the parent row
  const ts = now()
  db.update(schema.socialComments).set({
    replyText: 'It is 99 THB.', replyPlatformId: 'our-reply-1', updatedAt: ts,
  }).where(eq(schema.socialComments.id, parent.id)).run()
  addComment(erAcc, erPost, {
    platformCommentId: 'viewer-followup', text: 'And delivery?', parentPlatformCommentId: 'our-reply-1',
  })
  seenPayloads.length = 0
  llmQueue.push(verdict('reply', 'delivery', { reply: 'Two days.' }))
  await responder.judgeNewComments(erAcc)
  // follow-up judged with our earlier reply; the top-level parent keeps its draft
  const followups = seenPayloads.filter(p => p.comment === 'And delivery?')
  assert.equal(followups.length, 1)
  assert.equal(followups[0].earlierReply, 'It is 99 THB.')
})

test('a comment that already has a verdict is not judged again', async () => {
  const vAcc = addAccount({ platformAccountId: 'verdict-acc' })
  const vPost = addPost(vAcc, 'post-v2', 'Post')
  const doneId = addComment(vAcc, vPost, {
    text: 'Old question', status: 'draft', verdict: 'reply',
    reason: 'price', replyText: 'It is 99 THB.',
  })
  const newId = addComment(vAcc, vPost, { text: 'New question' })
  llmQueue.push(verdict('reply', 'price', { reply: 'It is 99 THB.' }))
  const callsBefore = generateCalls
  await responder.judgeNewComments(vAcc)
  assert.equal(generateCalls - callsBefore, 1)
  assert.equal(row(doneId).replyText, 'It is 99 THB.')
  assert.equal(row(newId).status, 'draft')
})

test('mode draft is accepted and always returns a reply', async () => {
  const dAcc = addAccount({ platformAccountId: 'draft-acc' })
  llmQueue.push(JSON.stringify({ verdict: 'reply', reason: 'draft', reply: 'Draft text.' }))
  const text = await responder.requestDraftReply(accRow(dAcc), 'post', 'help me answer')
  assert.equal(text, 'Draft text.')
  assert.equal(seenPayloads[seenPayloads.length - 1].mode, 'draft')
})

// --- End to end through the poll round ---

test('poll round reads, judges, and drafts end to end', async () => {
  // only the e2e account is watched for this round
  db.update(schema.socialAccounts).set({ watching: false }).run()
  const e2e = addAccount({ platformAccountId: 'e2e-page', watching: true })
  fake.seedPosts([{ id: 'post-e2e', text: 'Launch day', createdAt: new Date() }])
  fake.seedComments('post-e2e', [
    {
      id: 'e2e-c1', postId: 'post-e2e', text: 'How much is it?',
      authorName: 'Ann', createdAt: new Date(), isOwn: false,
    },
  ])
  llmQueue.length = 0
  llmQueue.push(verdict('reply', 'price question', { reply: 'It is 99 THB.' }))
  const r = await poller.runSocialPollRound()
  assert.equal(r.skipped, false)
  assert.equal(r.newComments, 1)
  const stored = db.select().from(schema.socialComments).all()
    .filter(c => c.accountId === e2e)
  assert.equal(stored.length, 1)
  assert.equal(stored[0].status, 'draft')
  assert.equal(stored[0].replyText, 'It is 99 THB.')
  db.update(schema.socialAccounts).set({ watching: true }).run()
})
