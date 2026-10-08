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

const { initSqliteSchema } = await import('../src/core/db/sqlite-schema.js')
const { db, schema } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const seller = await import('../src/modules/seller/services/seller.js')
const { mastra } = await import('../src/core/mastra/index.js')
{
  const { default: Database } = await import('better-sqlite3')
  const sqlite = new Database(process.env.SQLITE_PATH)
  sqlite.pragma('journal_mode = WAL')
  initSqliteSchema(sqlite)
  sqlite.close()
}

const replies: string[] = []
const { eq } = await import('drizzle-orm')
const studio = await import('../src/modules/product-studio/services/studio.js')
const waitFor = async (fn: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 20)) }
  throw new Error('waitFor timeout')
}
const prompts: any[] = []
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => type === 'seller_copywriter'
  ? { generate: async (msgs: any[]) => { prompts.push(JSON.parse(msgs[0].content)); return { text: replies.shift() ?? '' } } }
  // review_director ปลอม: จบทันทีโดยไม่บันทึกช็อต → โปรเจกต์เป็น script_ready ที่ไม่มีช็อต
  : type === 'review_director' ? { generate: async (msgs: any[]) => { scriptPrompts.push(msgs[0].content); await scriptGate; return { text: '', toolCalls: [] } } }
  : realGetAgent(type)
const scriptPrompts: string[] = []
// เปิด/ปิดประตูให้ review_director ปลอมจบ — คุมลำดับเหตุการณ์ใน test
let scriptGate: Promise<void> = Promise.resolve()
let openGate = () => {}
const closeGate = () => { scriptGate = new Promise<void>(r => { openGate = r }) }

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

test('skill video: guards before spending (models, skill, presenter)', async () => {
  const post = await seller.createPost({ productName: 'แก้วเก็บความเย็น', channels: ['instagram'] })
  // ยังไม่มีโมเดลรูป/วิดีโอ (มีแค่ข้อความจาก test แรก)
  await assert.rejects(() => seller.makeVideo(post!.id, { templateId: 'unboxing' }), (e: any) => /^E_NO_(IMAGE|VIDEO)_MODEL$/.test(e.errorCode))
  for (const [serviceType, provider] of [['image', 'openai'], ['video', 'minimax']]) {
    db.insert(schema.aiServiceConfigs).values({
      serviceType, provider, name: serviceType, baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: JSON.stringify(['m']),
      isActive: true, priority: 1, createdAt: now(), updatedAt: now(),
    } as any).run()
  }
  await assert.rejects(() => seller.makeVideo(post!.id, { templateId: 'nope' }), (e: any) => e.errorCode === 'E_TEMPLATE_UNKNOWN')
  const before = (await studio.listProjects()).length
  // ugc_review ต้องมี presenter → ไม่มี avatar/influencer = E_AVATAR_REQUIRED และไม่ทิ้งโปรเจกต์ค้าง
  await assert.rejects(() => seller.makeVideo(post!.id, { templateId: 'ugc_review' }), (e: any) => e.errorCode === 'E_AVATAR_REQUIRED')
  assert.equal((await studio.listProjects()).length, before)
  assert.equal((await seller.getPost(post!.id))!.videoJob, null)
})

test('skill video: product goes to Studio, finished merge is attached to the post', async () => {
  const post = await seller.createPost({
    productName: 'แก้วเก็บความเย็น', productPrice: '390 บาท', productDescription: 'เย็นนาน 24 ชม.',
    productImages: ['/static/products/cup.png'], channels: ['instagram', 'tiktok'], language: 'th',
  })
  closeGate()
  const started = await seller.makeVideo(post!.id, { templateId: 'unboxing' })
  assert.equal(started!.videoJob!.stage, 'scripting')
  assert.equal(started!.videoJob!.running, true)
  await assert.rejects(() => seller.makeVideo(post!.id, { templateId: 'unboxing' }), (e: any) => e.errorCode === 'E_SELLER_VIDEO_BUSY')
  const project = (await studio.getProjectRow(started!.studioProjectId!))!
  assert.equal(project.templateId, 'unboxing')
  assert.equal(project.platform, 'tiktok') // ช่องทางแรกตามลำดับมาตรฐาน (tiktok มาก่อน instagram)
  assert.equal(project.productName, 'แก้วเก็บความเย็น')
  assert.match(project.productDescription || '', /Price: 390 บาท/)
  assert.match(scriptPrompts.at(-1)!, /แก้วเก็บความเย็น/)
  assert.equal((await seller.getPost(post!.id))!.videoJob!.stage, 'scripting')

  // จำลอง auto-render จบ + merge เสร็จ แล้ว getPost ต้องแนบวิดีโอเอง
  const fresh = (await studio.getProjectRow(project.id))!
  db.update(schema.studioProjects).set({ autoRender: JSON.stringify({ stage: 'done', total: 1, done: 1, failed: 0 }) })
    .where(eq(schema.studioProjects.id, project.id)).run()
  db.insert(schema.videoMerges).values({ episodeId: fresh.episodeId, dramaId: fresh.dramaId, provider: 'ffmpeg', model: 'concat', status: 'completed', mergedUrl: 'static/merged/cup.mp4', createdAt: now() } as any).run()
  openGate()
  await waitFor(async () => (await studio.getProjectRow(project.id))!.status === 'script_ready')
  const done = await seller.getPost(post!.id)
  assert.equal(done!.videoUrl, '/static/merged/cup.mp4')
  assert.equal(done!.videoJob!.stage, 'done')
  assert.equal(done!.videoJob!.running, false)
})

test('skill video: script ready without shots → auto-render refuses → job failed with code; stop + manual video', async () => {
  const post = await seller.createPost({ productName: 'ร่มพับ', channels: ['tiktok'] })
  const started = await seller.makeVideo(post!.id, { templateId: 'unboxing' })
  await waitFor(async () => (await studio.getProjectRow(started!.studioProjectId!))!.status === 'script_ready')
  const failed = await seller.getPost(post!.id)
  assert.equal(failed!.videoJob!.stage, 'failed')
  assert.match(failed!.videoJob!.error || '', /^E_STUDIO_NEEDS_SCRIPT/)

  // ลองใหม่แล้วหยุด → cancelled; อัปโหลดวิดีโอเองหลังจากนั้นได้
  closeGate()
  const again = await seller.makeVideo(post!.id, { templateId: 'lifestyle_showcase' })
  assert.equal(again!.videoJob!.running, true)
  const stopped = await seller.stopVideo(again!.id)
  assert.equal(stopped!.videoJob!.stage, 'cancelled')
  assert.equal(stopped!.videoJob!.running, false)
  openGate()
  // บทเขียนเสร็จหลังหยุด → ต้องไม่เริ่ม render/แนบอะไรอีก
  await waitFor(async () => (await studio.getProjectRow(again!.studioProjectId!))!.status === 'script_ready')
  assert.equal((await seller.getPost(post!.id))!.videoJob!.stage, 'cancelled')
  const manual = await seller.updatePost(post!.id, { videoUrl: '/static/uploads/mine.mp4' })
  assert.equal(manual!.videoUrl, '/static/uploads/mine.mp4')
})
