/**
 * AI นักขาย (services/seller.ts) — fake Mastra agent + SQLite ชั่วคราว
 * ตรวจ: validation (ลิงก์ http(s), ไฟล์ต้องเป็น /static), สร้าง/แก้/ลบ, AI แคปชั่นต่อช่องทาง
 * (แฮชแท็กล้าง # / จำกัดจำนวน, ลิงก์ต่อท้ายคอมเมนต์โดย backend), JSON เสีย → ลองซ้ำ → E_SELLER_COPY
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-seller-'))
process.env.SQLITE_PATH = path.join(dir, 'test.sqlite3')
process.env.STORAGE_PATH = path.join(dir, 'static')

const { initSqliteSchema } = await import('../src/db/sqlite-schema.js')
const { db, schema } = await import('../src/db/index.js')
const { now } = await import('../src/utils/response.js')
const seller = await import('../src/services/seller.js')
const { mastra } = await import('../src/mastra/index.js')
{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const replies: string[] = []
const prompts: any[] = []
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => type === 'seller_copywriter'
  ? { generate: async (msgs: any[]) => { prompts.push(JSON.parse(msgs[0].content)); return { text: replies.shift() ?? '' } } }
  : realGetAgent(type)

test('generate without a text model → E_NO_TEXT_MODEL', async () => {
  const post = await seller.createPost({ productName: 'เซรั่ม' })
  await assert.rejects(() => seller.generateCopy(post!.id), (e: any) => e.errorCode === 'E_NO_TEXT_MODEL')
  db.insert(schema.aiServiceConfigs).values({
    serviceType: 'text', provider: 'openai', name: 'test', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: JSON.stringify(['m']),
    isActive: true, priority: 1, createdAt: now(), updatedAt: now(),
  } as any).run()
})

test('create/update validation', async () => {
  await assert.rejects(() => seller.createPost({}), (e: any) => e.errorCode === 'E_SELLER_NEEDS_PRODUCT')
  await assert.rejects(() => seller.createPost({ productName: 'x', productUrl: 'javascript:alert(1)' }), (e: any) => e.errorCode === 'E_INVALID_FIELD')
  await assert.rejects(() => seller.createPost({ productName: 'x', productImages: ['/etc/passwd'] }), (e: any) => e.errorCode === 'E_INVALID_FIELD')
  await assert.rejects(() => seller.createPost({ productName: 'x', tone: 'angry' }), (e: any) => e.errorCode === 'E_INVALID_FIELD')
  const post = await seller.createPost({ productName: 'ครีมกันแดด', productImages: ['static/products/a.png', '/static/products/a.png'] })
  assert.equal(post!.title, 'ครีมกันแดด')
  assert.deepEqual(post!.productImages, ['/static/products/a.png'])
  assert.deepEqual(post!.channels, ['tiktok', 'shopee', 'facebook', 'instagram'])
  const upd = await seller.updatePost(post!.id, { channels: ['instagram', 'bogus', 'tiktok'], productPrice: ' 199 บาท ' })
  assert.deepEqual(upd!.channels, ['tiktok', 'instagram'])
  assert.equal(upd!.productPrice, '199 บาท')
  assert.equal(await seller.updatePost(99999, {}), null)
})

test('AI copy per channel: hashtags cleaned + capped, link appended by backend, retry on bad JSON', async () => {
  const post = await seller.createPost({
    productName: 'เซรั่มวิตซี', productUrl: 'https://shopee.co.th/item/1', affiliateUrl: 'https://s.shopee.co.th/abc',
    productPrice: '299', channels: ['tiktok', 'instagram'],
  })
  replies.push('not json at all', '```json\n' + JSON.stringify({ channels: {
    tiktok: { caption: 'ผิวโกลว์ใน 7 วัน', hashtags: ['#เซรั่ม', 'skin care', 'a', 'b', 'c', 'd', 'e'], comment: 'สั่งเลยที่ลิงก์นี้' },
    instagram: { caption: 'ตัวโปรดประจำโต๊ะเครื่องแป้ง', hashtags: ['glow'], comment: 'ลิงก์อยู่ตรงนี้' },
    facebook: { caption: 'ไม่ได้ขอ', hashtags: [], comment: '' },
  } }) + '\n```')
  const out = await seller.generateCopy(post!.id, { tone: 'fun' })
  assert.equal(prompts.at(-1).tone, 'fun')
  assert.equal(prompts.at(-1).hasLink, true)
  assert.equal(prompts.at(-1).product.price, '299')
  assert.equal(out!.status, 'ready')
  assert.deepEqual(Object.keys(out!.content).sort(), ['instagram', 'tiktok'])
  assert.deepEqual(out!.content.tiktok!.hashtags, ['เซรั่ม', 'skincare', 'a', 'b', 'c'])
  // affiliate มาก่อนลิงก์สินค้า
  assert.equal(out!.ready.tiktok.comment, 'สั่งเลยที่ลิงก์นี้\nhttps://s.shopee.co.th/abc')
  assert.equal(out!.ready.tiktok.post, 'ผิวโกลว์ใน 7 วัน\n\n#เซรั่ม #skincare #a #b #c')
})

test('manual edits on other channels survive a regenerate; total failure → E_SELLER_COPY', async () => {
  const post = await seller.createPost({ productName: 'กระเป๋า', channels: ['facebook', 'shopee'] })
  await seller.updatePost(post!.id, { content: { shopee: { caption: 'แก้เอง', hashtags: ['bag'], comment: 'c' } } })
  replies.push(JSON.stringify({ channels: { facebook: { caption: 'ใหม่', hashtags: ['x'], comment: 'y' } } }))
  const out = await seller.generateCopy(post!.id, { channels: ['facebook'] })
  assert.equal(out!.content.facebook!.caption, 'ใหม่')
  assert.equal(out!.content.shopee!.caption, 'แก้เอง')
  assert.equal(out!.ready.facebook.comment, 'y') // ไม่มีลิงก์ → ไม่ต่อท้าย
  replies.push('{}', 'oops')
  await assert.rejects(() => seller.generateCopy(post!.id), (e: any) => e.errorCode === 'E_SELLER_COPY')
  assert.equal((await seller.getPost(post!.id))!.status, 'failed')
  await assert.rejects(() => seller.generateCopy(post!.id, { channels: [] }), (e: any) => e.errorCode === 'E_SELLER_NO_CHANNEL')
})

test('delete is soft and hides the post', async () => {
  const post = await seller.createPost({ productName: 'ลบได้' })
  assert.equal(await seller.deletePost(post!.id), true)
  assert.equal(await seller.getPost(post!.id), null)
  assert.ok(!(await seller.listPosts()).some(p => p.id === post!.id))
  assert.deepEqual(await seller.listStudioVideos(), [])
})
