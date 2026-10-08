/**
 * AI Live × TikTok LIVE (services/tiktok-live.ts) — ใช้ connection ปลอมแทน tiktok-live-connector (ไม่ต่อ TikTok จริง)
 * ตรวจ: ชื่อช่อง, แปลงเหตุการณ์ chat/gift/follow/member/like/viewers, ของขวัญแบบ streak รายงานครั้งเดียว,
 * events?after=, ไลฟ์จบ/หลุด, ช่องไม่ได้ไลฟ์ → ข้อความไทย, event ค้างจาก connection เก่าถูกทิ้ง
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

const tiktok = await import('../src/services/tiktok-live.js')

class FakeConn extends EventEmitter {
  static last: FakeConn | null = null
  disconnected = false
  constructor(public uniqueId: string, public options: Record<string, unknown>, private fail?: Error) {
    super()
    FakeConn.last = this
  }
  async connect() { if (this.fail) throw this.fail; return {} }
  async disconnect() { this.disconnected = true }
}
let nextFail: Error | undefined
tiktok.__setConnectionFactory((u, o) => new FakeConn(u, o, nextFail) as any)

test('username: accepts @name and profile URLs, rejects junk', () => {
  assert.equal(tiktok.normalizeUsername('@naka.shop'), 'naka.shop')
  assert.equal(tiktok.normalizeUsername('https://www.tiktok.com/@naka_shop/live?x=1'), 'naka_shop')
  assert.throws(() => tiktok.normalizeUsername('a b'), (e: any) => e.errorCode === 'E_TIKTOK_USERNAME')
})

test('connect, then chat/gift/follow/member/like/viewers become events', async () => {
  const s = await tiktok.connectTikTok({ username: '@nakashop', signApiKey: 'euler-key' })
  assert.equal(s.status, 'connected')
  const conn = FakeConn.last!
  assert.equal(conn.uniqueId, 'nakashop')
  assert.equal(conn.options.signApiKey, 'euler-key')
  const start = tiktok.tiktokStatus().lastEventId

  conn.emit('chat', { comment: ' ราคาเท่าไหร่คะ ', user: { uniqueId: 'ann', nickname: 'Ann' } })
  conn.emit('chat', { comment: '   ', user: { uniqueId: 'x' } }) // empty → ignored
  // streakable rose: three taps, reported once at the end with the final count
  conn.emit('gift', { giftDetails: { giftType: 1, giftName: 'Rose', diamondCount: 1 }, repeatCount: 1, repeatEnd: 0, user: { uniqueId: 'bob', nickname: 'Bob' } })
  conn.emit('gift', { giftDetails: { giftType: 1, giftName: 'Rose', diamondCount: 1 }, repeatCount: 3, repeatEnd: 1, user: { uniqueId: 'bob', nickname: 'Bob' } })
  conn.emit('gift', { giftDetails: { giftType: 2, giftName: 'Lion', diamondCount: 29999 }, repeatCount: 1, user: { uniqueId: 'cat', nickname: 'Cat' } })
  conn.emit('follow', { user: { uniqueId: 'dan', nickname: 'Dan' } })
  conn.emit('member', { user: { uniqueId: 'eve', nickname: 'Eve' } })
  conn.emit('like', { totalLikeCount: 1234 })
  conn.emit('roomUser', { viewerCount: 87 })

  const r = tiktok.tiktokEvents(start)
  assert.deepEqual(r.events.map(e => e.kind), ['chat', 'gift', 'gift', 'follow', 'member'])
  assert.equal(r.events[0].text, 'ราคาเท่าไหร่คะ')
  assert.deepEqual(r.events[0].user, { uniqueId: 'ann', nickname: 'Ann' })
  assert.deepEqual(r.events[1].gift, { name: 'Rose', count: 3, diamonds: 1 })
  assert.equal(r.events[2].gift!.name, 'Lion')
  assert.equal(r.totalLikes, 1234)
  assert.equal(r.viewers, 87)
  // after= returns only newer events
  assert.equal(tiktok.tiktokEvents(r.lastEventId).events.length, 0)
})

test('stream end and disconnect are reported once; old connections cannot add events', async () => {
  const old = FakeConn.last!
  old.emit('streamEnd', { action: 3 })
  assert.equal(tiktok.tiktokStatus().status, 'ended')
  await tiktok.connectTikTok({ username: 'nakashop' })
  assert.ok(old.disconnected)
  const fresh = FakeConn.last!
  const before = tiktok.tiktokStatus().lastEventId
  old.emit('chat', { comment: 'late message from the old socket', user: { uniqueId: 'z' } })
  assert.equal(tiktok.tiktokEvents(before).events.length, 0)
  fresh.emit('disconnected', { code: 1006 })
  const s = tiktok.tiktokEvents(before)
  assert.equal(s.status, 'disconnected')
  assert.equal(s.events[0].kind, 'system')
  await tiktok.disconnectTikTok()
  assert.ok(fresh.disconnected)
})

test('channel not live → Thai error, status error', async () => {
  class UserOfflineError extends Error { name = 'UserOfflineError' }
  nextFail = new UserOfflineError('The requested user isn\'t online :(')
  await assert.rejects(() => tiktok.connectTikTok({ username: 'sleepyshop' }), (e: any) => e.errorCode === 'E_TIKTOK_CONNECT' && /ยังไม่ได้ไลฟ์/.test(e.message))
  assert.equal(tiktok.tiktokStatus().status, 'error')
  nextFail = undefined
})
