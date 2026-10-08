/**
 * Creative Gallery & Ad Analytics — unit tests (docs/ai-marketer/GALLERY.md)
 * env ก่อน import services (pattern เดียวกับ clone-pipeline) — SQLITE_PATH ชี้ DB ชั่วคราว
 */
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'

const dir = mkdtempSync(path.join(tmpdir(), 'naka-gallery-test-'))
process.env.DATABASE_URL = 'pglite://memory'

const { db, schema } = await import('../src/core/db/index.js')
const gallery = await import('../src/modules/marketer/services/gallery.js')
const marketer = await import('../src/modules/marketer/services/marketer.js')
const { eq } = await import('drizzle-orm')

const ts = () => new Date().toISOString()

async function seedCampaign(overrides: Record<string, unknown> = {}) {
  const res = await db.insert(schema.campaigns).values({
    title: 'แคมเปญทดสอบ',
    productName: 'โทนเนอร์ทดสอบ',
    productImages: JSON.stringify(['/static/products/a.png', '/static/products/b.png']),
    market: 'TH',
    platforms: JSON.stringify(['tiktok']),
    style: 'clean',
    aspectRatio: '9:16',
    status: 'draft',
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  })
  const [row] = await db.select().from(schema.campaigns).where(eq(schema.campaigns.id, Number(res.lastInsertRowid)))
  return row
}

async function seedCreative(campaignId: number, overrides: Record<string, unknown> = {}) {
  const res = await db.insert(schema.campaignCreatives).values({
    campaignId,
    angle: 'มุมรีวิวจริง',
    hook: 'หน้ามันทั้งวัน?',
    format: 'ugc',
    platform: 'tiktok',
    durationSec: 30,
    script: '## S1',
    status: 'approved',
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  })
  const [row] = await db.select().from(schema.campaignCreatives).where(eq(schema.campaignCreatives.id, Number(res.lastInsertRowid)))
  return row
}

test('migration v16: ตาราง creative_results มี UNIQUE(creative_id) และ init ซ้ำได้', async () => {
    const sqlite = new Database(path.join(dir, 'test.sqlite3'))
  initSqliteSchema(sqlite) // รีเพลย์ต้องเงียบ ๆ ผ่าน
  const ddl = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'creative_results'").get() as { sql: string }
  assert.match(ddl.sql, /creative_id INTEGER NOT NULL UNIQUE/)
  sqlite.close()
})

test('listGalleryEntries: เอาเฉพาะ approved/in_production ของ campaign ที่ยังไม่ลบ + สรุปถูกต้อง', async () => {
  const c1 = await seedCampaign()
  await seedCreative(c1.id, { status: 'in_production', episodeId: 7, episodeNumber: 1 })
  await seedCreative(c1.id, { status: 'approved' })
  await seedCreative(c1.id, { status: 'draft', hook: 'ไม่ควรโผล่' })
  const cDeleted = await seedCampaign({ title: 'ลบแล้ว', deletedAt: ts() })
  await seedCreative(cDeleted.id, { hook: 'ไม่ควรโผล่เช่นกัน' })

  const { entries, summary } = await gallery.listGalleryEntries()
  assert.ok(!entries.some(e => e.hook.includes('ไม่ควรโผล่')), 'draft/แคมเปญที่ลบแล้วต้องไม่โผล่')
  const mine = entries.filter(e => e.campaignId === c1.id)
  assert.equal(mine.length, 2)
  assert.equal(mine[0].productImage, '/static/products/a.png', 'productImage = รูปแรกของแคมเปญ')
  assert.ok(mine[0].result === null)
  assert.equal(summary.produced, entries.filter(e => e.status === 'in_production').length)
  assert.equal(summary.withResults, 0)
})

test('upsert: สร้าง → แก้บางช่อง (คงค่าเดิม) → engagementRate ถูกต้อง', async () => {
  const c = await seedCampaign()
  const creative = await seedCreative(c.id, { status: 'in_production', episodeId: 7, episodeNumber: 1 })

  const created = await gallery.upsertCreativeResult(creative.id, {
    views: 100_000, likes: 4_000, comments: 800, shares: 1_200, salesThb: 8900.555,
    postedUrl: 'https://www.tiktok.com/@shop/video/1', postedAt: '2026-09-28', note: 'ยอดดีมาก',
  })
  assert.equal(created.views, 100_000)
  assert.equal(created.salesThb, 8900.56, 'salesThb ปัด 2 ตำแหน่ง')
  assert.equal(created.postedAt, new Date('2026-09-28').toISOString())
  // (4000+800+1200)/100000 = 0.06
  assert.ok(Math.abs((created.engagementRate ?? 0) - 0.06) < 1e-9)

  const updated = await gallery.upsertCreativeResult(creative.id, { views: 200_000 })
  assert.equal(updated.views, 200_000)
  assert.equal(updated.likes, 4_000, 'ช่องที่ไม่ส่งมาคงค่าเดิม')
  assert.equal(updated.note, 'ยอดดีมาก')
})

test('upsert: validation — เลขติดลบ/URL มั่ว/วันที่มั่ว/โน้ตยาวเกิน/creative ไม่มีจริง', async () => {
  const c = await seedCampaign()
  const creative = await seedCreative(c.id)
  const bad = (fn: () => Promise<unknown>) => assert.rejects(fn, (err: any) => err?.errorCode === 'E_INVALID_FIELD')

  await bad(() => gallery.upsertCreativeResult(creative.id, { views: -1 }))
  await bad(() => gallery.upsertCreativeResult(creative.id, { views: 1.5 }))
  await bad(() => gallery.upsertCreativeResult(creative.id, { salesThb: -5 }))
  await bad(() => gallery.upsertCreativeResult(creative.id, { salesThb: 100_000_001 }))
  await bad(() => gallery.upsertCreativeResult(creative.id, { postedUrl: 'ftp://x' }))
  await bad(() => gallery.upsertCreativeResult(creative.id, { postedAt: 'ไม่ใช่วันที่' }))
  await bad(() => gallery.upsertCreativeResult(creative.id, { note: 'x'.repeat(2001) }))
  await bad(() => gallery.upsertCreativeResult(999_999, { views: 10 }))
})

test('delete: ลบผลตอบรับ + deleteCreative เก็บกวาด result ค้างด้วย', async () => {
  const c = await seedCampaign()
  const a = await seedCreative(c.id, { status: 'in_production', episodeId: 7, episodeNumber: 1 })
  const b = await seedCreative(c.id, { status: 'in_production', episodeId: 8, episodeNumber: 2 })
  await gallery.upsertCreativeResult(a.id, { views: 1_000 })
  await gallery.upsertCreativeResult(b.id, { views: 2_000 })

  assert.equal(await gallery.deleteCreativeResult(a.id), true)
  assert.equal(await gallery.deleteCreativeResult(a.id), false)

  // marketer.deleteCreative (approved เท่านั้น — in_production ห้ามลบ) ต้องลบ result ค้างด้วย
  const draft = await seedCreative(c.id, { status: 'draft' })
  await gallery.upsertCreativeResult(draft.id, { views: 500 })
  assert.equal(await marketer.deleteCreative(c.id, draft.id), true)
  const remaining = await db.select().from(schema.creativeResults)
  assert.ok(!remaining.some(r => r.creativeId === draft.id), 'ลบ creative แล้ว result ต้องหายไปด้วย')
  // b ยังอยู่
  assert.ok(remaining.some(r => r.creativeId === b.id))
})

test('performanceEvidenceBlock: ไม่มีผล → null (message เดิมไม่เปลี่ยน) · มีผล → บล็อก Evidence ครบ', async () => {
  const c = await seedCampaign()
  assert.equal(await gallery.performanceEvidenceBlock(c.id), null)

  const creative = await seedCreative(c.id, { status: 'in_production', episodeId: 7, episodeNumber: 1, format: 'ugc', platform: 'tiktok' })
  await gallery.upsertCreativeResult(creative.id, { views: 125_000, likes: 6_000, comments: 1_000, shares: 1_000, salesThb: 8_900, postedAt: '2026-09-28' })

  const block = await gallery.performanceEvidenceBlock(c.id)
  assert.ok(block, 'ต้องมีบล็อกเมื่อมีผลตอบรับ')
  assert.match(block!, /ผลตอบรับจริงจากคลิปที่โพสต์แล้ว/)
  assert.match(block!, /Evidence/)
  assert.match(block!, /creative #\d+ \(ugc \/ tiktok\)/)
  assert.match(block!, /125,000 views/)
  assert.match(block!, /engagement 6\.4%/)
  assert.match(block!, /ยอดขาย 8,900 THB/)
  assert.match(block!, /โพสต์ 2026-09-28/)
})
