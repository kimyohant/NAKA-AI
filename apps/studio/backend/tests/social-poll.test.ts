/**
 * Social Auto Reply ticket 02 — poller + registry, fake `fake` adapter.
 * PGlite (pglite://memory), node:test. Covers: the migration tables and keys,
 * unknown-platform lookup, fake-only-in-tests, read-only poll round, dedupe,
 * skip rules, paging stop, running guard, empty backend.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-poll-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')

const { db, schema } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const { sqlite } = await import('./_sql.js')
const { getSocialAdapter, registerSocialAdapter } = await import('../src/modules/social/services/registry.js')
const poller = await import('../src/modules/social/services/poller.js')
const { FakeSocialAdapter } = await import('./helpers/fake-social-adapter.js')

const fake = new FakeSocialAdapter()
registerSocialAdapter(fake)

const H = (h: number) => new Date(Date.now() - h * 3600_000)
const D = (d: number) => new Date(Date.now() - d * 86400_000)

async function addAccount(values: Record<string, unknown>): Promise<number> {
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

test('the startup migration creates the three social tables; an account has an owner', async () => {
  for (const t of ['social_accounts', 'social_posts', 'social_comments']) {
    assert.ok((await sqlite.columns(t)).length > 0, `missing table ${t}`)
  }
  assert.ok((await sqlite.columns('social_accounts')).includes('owner_user_id'))
})

test('unknown platform lookup throws the exact message', async () => {
  assert.throws(() => getSocialAdapter('nosuch'), /Unsupported social platform: nosuch/)
  assert.throws(() => getSocialAdapter('FACEBOOK'), /Unsupported social platform: FACEBOOK/)
})

test('fake adapter exists only in the test folder', async () => {
  const srcDir = path.resolve(import.meta.dirname, '../src')
  const stack = [srcDir]
  const offenders: string[] = []
  while (stack.length) {
    const cur = stack.pop()!
    for (const entry of readdirSync(cur)) {
      const full = path.join(cur, entry)
      if (statSync(full).isDirectory()) {
        stack.push(full)
      } else if (/\.(ts|js)$/.test(entry)) {
        const text = readFileSync(full, 'utf8')
        if (text.includes('fake-social-adapter') || /platform\s*=\s*['"]fake['"]/.test(text)) {
          offenders.push(path.relative(srcDir, full))
        }
      }
    }
  }
  assert.deepEqual(offenders, [])
})

test('empty backend round runs without errors', async () => {
  const r = await poller.runSocialPollRound()
  assert.deepEqual(r, { skipped: false, accounts: 0, newComments: 0 })
})

let connectedId = 0
let disconnectedId = 0
let pausedWatchId = 0

test('seed accounts and fake platform data', async () => {
  connectedId = await addAccount({})
  disconnectedId = await addAccount({ platformAccountId: 'page-disc', status: 'disconnected' })
  pausedWatchId = await addAccount({ platformAccountId: 'page-nowatch', watching: false })

  fake.seedPosts([
    { id: 'post-1', text: 'New product launch', createdAt: H(2) },
    { id: 'post-2', text: 'Old post outside window', createdAt: D(30) },
  ])
  fake.seedComments('post-1', [
    { id: 'c1', postId: 'post-1', text: 'How much?', authorName: 'Ann', createdAt: H(1), isOwn: false },
    { id: 'c2', postId: 'post-1', text: 'Nice!', authorName: 'Bob', createdAt: H(3), isOwn: false },
    { id: 'c3', postId: 'post-1', text: 'Where is the shop?', authorName: 'Cat', createdAt: H(4), isOwn: false },
  ])
})

test('poll round stores posts and comments of a connected watching account as new', async () => {
  const r = await poller.runSocialPollRound()
  assert.equal(r.skipped, false)
  assert.equal(r.accounts, 1)
  assert.equal(r.newComments, 3)

  const posts = (await db.select().from(schema.socialPosts))
    .filter(p => p.accountId === connectedId)
  assert.equal(posts.length, 1) // only the post inside watch_days
  assert.equal(posts[0].platformPostId, 'post-1')

  const comments = (await db.select().from(schema.socialComments))
    .filter(c => c.accountId === connectedId)
  assert.equal(comments.length, 3)
  for (const c of comments) assert.equal(c.status, 'new')
  assert.ok(comments.every(c => typeof c.postId === 'number'))
})

test('a second round over the same comments stores each comment once', async () => {
  const before = (await db.select().from(schema.socialComments)).length
  const r = await poller.runSocialPollRound()
  assert.equal(r.newComments, 0)
  const after = (await db.select().from(schema.socialComments)).length
  assert.equal(after, before)
  // unique key (account_id, platform_comment_id) exists
  assert.ok((await sqlite.uniques('social_comments')).includes('account_id,platform_comment_id'))
})

test('disconnected and non-watching accounts are not read', async () => {
  const callsBefore = fake.listPostsCalls
  await poller.runSocialPollRound()
  assert.equal(fake.listPostsCalls, callsBefore) // post list comes from the hourly cache (ticket 08)
  const rowsFor = async (id: number) => (await db.select().from(schema.socialComments)).filter(c => c.accountId === id)
  assert.equal((await rowsFor(disconnectedId)).length, 0)
  assert.equal((await rowsFor(pausedWatchId)).length, 0)
  const acc = async (id: number) => (await db.select().from(schema.socialAccounts)).find(a => a.id === id)!
  assert.equal((await acc(disconnectedId)).lastPolledAt, null)
})

test('paging stops at the first already-stored comment', async () => {
  fake.prependComment('post-1', { id: 'c0', postId: 'post-1', text: 'New question', authorName: 'Dan', createdAt: H(0.5), isOwn: false })
  const commentsBefore = fake.listCommentsCalls
  const r = await poller.runSocialPollRound()
  assert.equal(r.newComments, 1)
  assert.equal(fake.listCommentsCalls, commentsBefore + 1) // second page never fetched
  const stored = (await db.select().from(schema.socialComments)).filter(c => c.accountId === connectedId)
  assert.equal(stored.length, 4)
})

test('a round that starts while another is running is skipped', async () => {
  const { registerSocialAdapter: reg } = await import('../src/modules/social/services/registry.js')
  let release!: () => void
  const gate = new Promise<void>(r => (release = r))
  const blocking = {
    platform: 'blocking',
    capabilities: { canReply: false, maxReplyChars: 0, needsPublicCallback: false },
    listPosts: async () => { await gate; return { items: [] } },
    listComments: async () => ({ items: [] }),
    reply: async () => ({ replyId: 'x' }),
    getAuthUrl: () => '',
    exchangeCode: async () => [],
  }
  reg(blocking as any)
  const blockingId = await addAccount({ platform: 'blocking', platformAccountId: 'page-block' })
  const first = poller.runSocialPollRound()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(poller.isSocialPollRunning(), true)
  const second = await poller.runSocialPollRound()
  assert.deepEqual(second, { skipped: true, accounts: 0, newComments: 0 })
  release()
  await first
  const { gt } = await import('drizzle-orm')
  await db.delete(schema.socialAccounts).where(gt(schema.socialAccounts.id, 0))
  assert.ok(blockingId > 0)
})
