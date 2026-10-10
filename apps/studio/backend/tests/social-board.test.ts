/**
 * Social Auto Reply ticket 02 — board route: GET /comments with account and
 * "not in FAQ" filters, GET /accounts without tokens. Temp SQLite, node:test.
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-social-board-'))
process.env.DATABASE_URL = 'pglite://memory'
process.env.STORAGE_PATH = path.join(dir, 'static')

const { db, schema } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const { default: social } = await import('../src/modules/social/routes/social.js')

async function addAccount(platformAccountId: string): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.socialAccounts).values({
    platform: 'fake',
    platformAccountId,
    name: `Page ${platformAccountId}`,
    status: 'connected',
    accessToken: 'super-secret-token',
    watching: true,
    watchDays: 7,
    createdAt: ts,
    updatedAt: ts,
  } as any).returning()
  return Number(res[0].id)
}

async function addPost(accountId: number, platformPostId: string, text: string): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.socialPosts).values({
    accountId, platformPostId, text, postedAt: ts, createdAt: ts, updatedAt: ts,
  } as any).returning()
  return Number(res[0].id)
}

async function addComment(accountId: number, postId: number, values: Record<string, unknown>): Promise<number> {
  const ts = now()
  const res = await db.insert(schema.socialComments).values({
    accountId,
    postId,
    platformCommentId: `c-${Math.random().toString(36).slice(2)}`,
    text: 'comment',
    authorName: 'Viewer',
    commentedAt: ts,
    status: 'needs_human',
    createdAt: ts,
    updatedAt: ts,
    ...values,
  } as any).returning()
  return Number(res[0].id)
}

const accA = await addAccount('board-a')
const accB = await addAccount('board-b')
const postA = await addPost(accA, 'p-a', 'Post A text')
const postB = await addPost(accB, 'p-b', 'Post B text')
await addComment(accA, postA, { platformCommentId: 'ca-1', text: 'How much?', status: 'draft', verdict: 'reply', reason: 'price question', fallback: false, replyText: 'Please DM us', replySource: 'auto' })
await addComment(accA, postA, { platformCommentId: 'ca-2', text: 'What is the phone number?', status: 'needs_human', verdict: 'reply', reason: 'missing contact', fallback: true, statusNote: 'not in faq' })
await addComment(accB, postB, { platformCommentId: 'cb-1', text: 'Spam link', status: 'skipped', verdict: 'skip', reason: 'spam', fallback: false, statusNote: 'spam rule' })

async function getComments(qs: string) {
  const res = await social.request(`/comments${qs}`)
  assert.equal(res.status, 200)
  const json = await res.json() as any
  assert.equal(json.code, 200)
  return json.data.items as Array<Record<string, any>>
}

test('board route returns comment, post text, state, verdict, reason, fallback, status note, reply fields', async () => {
  const items = await getComments('')
  assert.equal(items.length, 3)
  const draft = items.find(i => i.platformCommentId === 'ca-1')!
  assert.equal(draft.text, 'How much?')
  assert.equal(draft.postText, 'Post A text')
  assert.equal(draft.status, 'draft')
  assert.equal(draft.verdict, 'reply')
  assert.equal(draft.reason, 'price question')
  assert.equal(draft.fallback, false)
  assert.equal(draft.replyText, 'Please DM us')
  assert.equal(draft.replySource, 'auto')
  assert.equal(draft.accountId, accA)
  assert.equal(draft.platform, 'fake')
})

test('board route filters by account', async () => {
  const items = await getComments(`?account_id=${accB}`)
  assert.equal(items.length, 1)
  assert.equal(items[0].platformCommentId, 'cb-1')
})

test('board route filters by not in FAQ', async () => {
  const items = await getComments('?fallback_only=1')
  assert.equal(items.length, 1)
  assert.equal(items[0].platformCommentId, 'ca-2')
  assert.equal(items[0].statusNote, 'not in faq')
  const both = await getComments(`?account_id=${accA}&fallback_only=1`)
  assert.equal(both.length, 1)
})

test('board route rejects an invalid account_id', async () => {
  const res = await social.request('/comments?account_id=nope')
  assert.equal(res.status, 400)
})

test('accounts route never returns tokens', async () => {
  const res = await social.request('/accounts')
  assert.equal(res.status, 200)
  const json = await res.json() as any
  assert.equal(json.data.items.length, 2)
  const raw = JSON.stringify(json.data)
  assert.ok(!raw.includes('super-secret-token'))
  assert.ok(!raw.includes('access_token'))
  assert.ok(!raw.includes('refresh_token'))
  assert.equal(json.data.items[0].status, 'connected')
})
