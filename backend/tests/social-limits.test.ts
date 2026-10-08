/**
 * Social Auto Reply ticket 08 — read limits, pause backoff, reconnect needed.
 * Fake adapter (`fake`) + scripted LLM (always `skip`), temporary SQLite file,
 * runs in CI via `test:social`.
 * Covers: 30 read calls per account per round with resume next round, post
 * list cached one hour, 10 comment pages per post, `unknown` on one post,
 * backoff steps + reset, paused skip, `auth_expired` while reading,
 * `rate_limited` while sending (queued + person), token refresh, and
 * `last_polled_at`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { eq, gt } from 'drizzle-orm'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-limits-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const { registerSocialAdapter } = await import('../src/services/social/registry.js')
const actions = await import('../src/services/social/actions.js')
const poller = await import('../src/services/social/poller.js')
const limits = await import('../src/services/social/limits.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')
const { mastra } = await import('../src/mastra/index.js')

{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const fake = new FakeSocialAdapter()
registerSocialAdapter(fake)

// --- Fake LLM: everything uninteresting is skipped, so judging never blocks ---
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => {
  if (type !== 'social_responder') return realGetAgent(type)
  return {
    generate: async () => ({ text: JSON.stringify({ verdict: 'skip', reason: 'test' }) }),
  }
}

const noGap = { waitBetweenSends: async () => {} }
const H = (h: number) => new Date(Date.now() - h * 3600_000)

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

const accRow = (id: number) =>
  db.select().from(schema.socialAccounts).where(eq(schema.socialAccounts.id, id)).all()[0]

const commentsOf = (accountId: number) =>
  db.select().from(schema.socialComments).where(eq(schema.socialComments.accountId, accountId)).all()

function addQueuedComment(accountId: number, values: Record<string, unknown> = {}): number {
  const ts = now()
  const [post] = db.select().from(schema.socialPosts)
    .where(eq(schema.socialPosts.accountId, accountId)).all()
  const res = db.insert(schema.socialComments).values({
    accountId,
    postId: post?.id ?? null,
    platformCommentId: `q-${Math.random().toString(36).slice(2)}`,
    text: 'How much?',
    commentedAt: H(1).toISOString(),
    status: 'queued',
    verdict: 'reply',
    reason: 'price',
    replyText: 'Hi.',
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).run()
  return Number((res as any).lastInsertRowid)
}

function resetFake(): void {
  fake.failQueue.length = 0
  fake.commentFailures.clear()
  fake.failRefresh = false
  poller.__resetSocialPollerState()
}

/** Full isolation between tests: wipe rows, seeds, failure queues, and poller memory. */
function resetAll(): void {
  db.delete(schema.socialComments).where(gt(schema.socialComments.id, 0)).run()
  db.delete(schema.socialPosts).where(gt(schema.socialPosts.id, 0)).run()
  db.delete(schema.socialAccounts).where(gt(schema.socialAccounts.id, 0)).run()
  fake.posts = []
  fake.commentsByPost.clear()
  resetFake()
}

const calls = () => ({ posts: fake.listPostsCalls, comments: fake.listCommentsCalls })

test('at most 30 read calls per account per round, the next round resumes', async () => {
  resetAll()
  const acc = addAccount({ platformAccountId: 'limit-30' })
  // 20 posts x 3 comments; page size 2 -> post list costs 10 calls,
  // each post costs 2 comment calls -> only 10 posts fit in the budget.
  fake.seedPosts(Array.from({ length: 20 }, (_, i) => ({
    id: `p30-${i}`, text: `Post ${i}`, createdAt: H(1 + i * 0.1),
  })))
  for (let i = 0; i < 20; i++) {
    fake.seedComments(`p30-${i}`, [0, 1, 2].map(k => ({
      id: `p30-${i}-c${k}`, postId: `p30-${i}`, text: `Question ${k}`,
      authorName: 'Ann', createdAt: H(0.5 + k * 0.01), isOwn: false,
    })))
  }

  const before = calls()
  const r1 = await poller.runSocialPollRound(noGap)
  const d1 = { posts: calls().posts - before.posts, comments: calls().comments - before.comments }
  assert.ok(d1.posts + d1.comments <= 30, `round 1 used ${d1.posts + d1.comments} read calls`)
  assert.equal(d1.posts, 10) // whole post list in 10 pages
  assert.equal(d1.comments, 20) // 10 posts x 2 pages, then the budget runs out
  assert.equal(commentsOf(acc).length, 30)
  assert.ok(accRow(acc).lastPolledAt, 'last_polled_at is set after a round')

  const mid = calls()
  const r2 = await poller.runSocialPollRound(noGap)
  const d2 = { posts: calls().posts - mid.posts, comments: calls().comments - mid.comments }
  assert.equal(d2.posts, 0) // post list comes from the hourly cache
  assert.ok(d2.comments <= 30)
  assert.equal(commentsOf(acc).length, 60) // the rest continued where round 1 stopped
  assert.ok(r1.newComments === 30 && r2.newComments === 30)
})

test('the post list is not fetched again inside one hour, but is after a restart', async () => {
  resetAll()
  assert.equal(limits.POSTS_CACHE_TTL_MS, 3600_000)
  const acc = addAccount({ platformAccountId: 'cache-1h' })
  fake.seedPosts([{ id: 'pcache-1', text: 'Cached post', createdAt: H(1) }])
  fake.seedComments('pcache-1', [
    { id: 'pcache-c1', postId: 'pcache-1', text: 'Hi', authorName: 'Ann', createdAt: H(0.5), isOwn: false },
  ])

  const b0 = calls()
  await poller.runSocialPollRound(noGap)
  assert.ok(calls().posts > b0.posts)
  void acc

  const b1 = calls()
  await poller.runSocialPollRound(noGap)
  assert.equal(calls().posts, b1.posts, 'second round must reuse the cached post list')

  poller.__resetSocialPollerState() // simulates a restart: memory is gone
  await poller.runSocialPollRound(noGap)
  assert.ok(calls().posts > b1.posts, 'after a restart the post list is fetched again')
})

test('paging one post stops after 10 pages', async () => {
  resetAll()
  const acc = addAccount({ platformAccountId: 'pages-10' })
  fake.seedPosts([{ id: 'p10', text: 'Long thread', createdAt: H(1) }])
  fake.seedComments('p10', Array.from({ length: 25 }, (_, i) => ({
    id: `p10-c${i}`, postId: 'p10', text: `Comment ${i}`,
    authorName: 'Ann', createdAt: new Date(Date.now() - i * 60_000), isOwn: false,
  })))

  const before = calls()
  await poller.runSocialPollRound(noGap)
  assert.equal(calls().comments - before.comments, 10)
  assert.equal(commentsOf(acc).length, 20) // 10 pages x page size 2
})

test('unknown on one post skips that post, keeps the others, no pause', async () => {
  resetAll()
  const acc = addAccount({ platformAccountId: 'unknown-1' })
  fake.seedPosts([
    { id: 'pnew', text: 'New post', createdAt: H(1) },
    { id: 'pold', text: 'Old post', createdAt: H(2) },
  ])
  fake.seedComments('pnew', [
    { id: 'pnew-c1', postId: 'pnew', text: 'Broken?', authorName: 'Ann', createdAt: H(0.5), isOwn: false },
  ])
  fake.seedComments('pold', [
    { id: 'pold-c1', postId: 'pold', text: 'Fine', authorName: 'Bob', createdAt: H(1.5), isOwn: false },
  ])
  fake.failCommentsFor('pnew', 'unknown')

  await poller.runSocialPollRound(noGap)
  const stored = commentsOf(acc).map(c => c.platformCommentId)
  assert.deepEqual(stored, ['pold-c1'])
  assert.equal(accRow(acc).status, 'connected')
  assert.equal(accRow(acc).pausedUntil, null)
})

test('backoff steps: 15min, 30min, 1h, stays at 1h, retryAfterSec wins', () => {
  assert.equal(limits.backoffDelayMs(0), 15 * 60_000)
  assert.equal(limits.backoffDelayMs(1), 30 * 60_000)
  assert.equal(limits.backoffDelayMs(2), 3600_000)
  assert.equal(limits.backoffDelayMs(9), 3600_000)
  assert.equal(limits.backoffDelayMs(0, 45), 45_000)

  const T = Date.parse('2026-10-08T10:00:00.000Z')
  const acc = addAccount({ platformAccountId: 'backoff-steps' })
  assert.equal(limits.pauseAccount(acc, undefined, T), new Date(T + 15 * 60_000).toISOString())
  assert.equal(accRow(acc).backoffStep, 1)
  assert.equal(limits.pauseAccount(acc, undefined, T), new Date(T + 30 * 60_000).toISOString())
  assert.equal(limits.pauseAccount(acc, undefined, T), new Date(T + 3600_000).toISOString())
  assert.equal(limits.pauseAccount(acc, undefined, T), new Date(T + 3600_000).toISOString())

  const acc2 = addAccount({ platformAccountId: 'backoff-retry' })
  assert.equal(limits.pauseAccount(acc2, 120, T), new Date(T + 120_000).toISOString())
})

test('a good round resets the backoff step', async () => {
  resetAll()
  const acc = addAccount({ platformAccountId: 'reset-step', backoffStep: 3 })
  fake.seedPosts([{ id: 'pr', text: 'Post', createdAt: H(1) }])
  fake.seedComments('pr', [
    { id: 'pr-c1', postId: 'pr', text: 'Hi', authorName: 'Ann', createdAt: H(0.5), isOwn: false },
  ])
  await poller.runSocialPollRound(noGap)
  assert.equal(accRow(acc).backoffStep, 0)
})

test('a paused account is skipped while another is still read', async () => {
  resetAll()
  const pausedAcc = addAccount({
    platformAccountId: 'paused-a',
    pausedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
    backoffStep: 1,
  })
  const liveAcc = addAccount({ platformAccountId: 'live-b' })
  fake.seedPosts([{ id: 'pp', text: 'Post', createdAt: H(1) }])
  fake.seedComments('pp', [
    { id: 'pp-c1', postId: 'pp', text: 'Hi', authorName: 'Ann', createdAt: H(0.5), isOwn: false },
  ])

  const r = await poller.runSocialPollRound(noGap)
  assert.equal(r.accounts, 1)
  assert.equal(commentsOf(pausedAcc).length, 0)
  assert.equal(accRow(pausedAcc).lastPolledAt, null)
  assert.equal(commentsOf(liveAcc).length, 1)
})

test('auth_expired while reading gives reconnect needed, later rounds skip it', async () => {
  resetAll()
  const acc = addAccount({ platformAccountId: 'auth-dead' })
  fake.seedPosts([{ id: 'pa', text: 'Post', createdAt: H(1) }])
  fake.seedComments('pa', [
    { id: 'pa-c1', postId: 'pa', text: 'Hi', authorName: 'Ann', createdAt: H(0.5), isOwn: false },
  ])
  fake.failNext('auth_expired')

  await poller.runSocialPollRound(noGap)
  assert.equal(accRow(acc).status, 'reconnect_needed')
  assert.equal(commentsOf(acc).length, 0)

  const before = calls()
  const r = await poller.runSocialPollRound(noGap)
  assert.equal(calls().posts, before.posts)
  assert.equal(calls().comments, before.comments)
  assert.equal(r.accounts, 0)
})

test('rate_limited while sending pauses the account and the comment goes back', async () => {
  resetAll()
  // Auto send from `queued`.
  const qacc = addAccount({ platformAccountId: 'send-rate-q' })
  const qid = addQueuedComment(qacc)
  fake.failNext('rate_limited')
  const r = await actions.sendQueuedReplies(qacc, noGap)
  assert.equal(r.sent, 0)
  assert.equal(r.rateLimited, true)
  const qrow = db.select().from(schema.socialComments).where(eq(schema.socialComments.id, qid)).all()[0]
  assert.equal(qrow.status, 'queued')
  assert.ok(accRow(qacc).pausedUntil, 'rate_limited send pauses the account')
  assert.ok(Date.parse(accRow(qacc).pausedUntil!) > Date.now())

  // Person send from `needs_human`.
  const pacc = addAccount({ platformAccountId: 'send-rate-p' })
  const pid = addQueuedComment(pacc, { status: 'needs_human' })
  fake.failNext('rate_limited')
  await assert.rejects(actions.sendCommentAsPerson(pid, 'Hello.'), /rate_limited/)
  const prow = db.select().from(schema.socialComments).where(eq(schema.socialComments.id, pid)).all()[0]
  assert.equal(prow.status, 'needs_human')
  assert.ok(accRow(pacc).pausedUntil, 'rate_limited person send pauses the account')
})

test('a token expiring within 10 minutes is refreshed; a failed refresh reconnects', async () => {
  resetAll()
  const acc = addAccount({
    platformAccountId: 'refresh-ok',
    refreshToken: 'old-refresh',
    tokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  })
  fake.seedPosts([{ id: 'pf', text: 'Post', createdAt: H(1) }])
  fake.seedComments('pf', [
    { id: 'pf-c1', postId: 'pf', text: 'Hi', authorName: 'Ann', createdAt: H(0.5), isOwn: false },
  ])
  const refreshBefore = fake.refreshTokenCalls
  await poller.runSocialPollRound(noGap)
  assert.equal(fake.refreshTokenCalls, refreshBefore + 1)
  assert.equal(accRow(acc).accessToken, 'fake-refreshed')
  assert.equal(accRow(acc).status, 'connected')
  assert.ok(commentsOf(acc).length >= 1)

  // A token with plenty of life is left alone.
  db.update(schema.socialAccounts)
    .set({ tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString() })
    .where(eq(schema.socialAccounts.id, acc)).run()
  const freshBefore = fake.refreshTokenCalls
  const acc2 = addAccount({
    platformAccountId: 'refresh-skip',
    refreshToken: 'old-refresh',
    tokenExpiresAt: new Date(Date.now() + 3600_000).toISOString(),
  })
  poller.__resetSocialPollerState()
  await poller.runSocialPollRound(noGap)
  assert.equal(fake.refreshTokenCalls, freshBefore)
  assert.ok(commentsOf(acc2).length >= 1)

  // A failed refresh gives reconnect needed and reads nothing.
  resetAll()
  const acc3 = addAccount({
    platformAccountId: 'refresh-fail',
    refreshToken: 'old-refresh',
    tokenExpiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
  })
  fake.failRefresh = true
  const before = calls()
  await poller.runSocialPollRound(noGap)
  assert.equal(accRow(acc3).status, 'reconnect_needed')
  assert.equal(calls().posts, before.posts)
  assert.equal(calls().comments, before.comments)
})
