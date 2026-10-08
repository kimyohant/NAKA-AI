/**
 * Seed scratch DB สำหรับ smoke test gallery (รัน: npx tsx tests/gallery-seed.ts)
 * สร้าง campaign + creative (approved/in_production) เพื่อทดสอบ GET /gallery + PUT result
 */
export {}

process.env.DATABASE_URL = process.env.DATABASE_URL || 'pglite://data/gallery-smoke'

const { db, schema, insertedId, closeDb } = await import('../src/core/db/index.js')

const ts = new Date().toISOString()
const res = await db.insert(schema.campaigns).values({
  title: 'แคมเปญโทนเนอร์สมุนไพร (smoke)',
  productName: 'โทนเนอร์สมุนไพร 100 มล.',
  productImages: JSON.stringify([]),
  market: 'TH',
  platforms: JSON.stringify(['tiktok']),
  style: 'clean',
  aspectRatio: '9:16',
  status: 'creatives_ready',
  dramaId: 1,
  createdAt: ts,
  updatedAt: ts,
}).returning({ id: schema.campaigns.id })
const campaignId = insertedId(res)

for (const c of [
  { angle: 'POV วัยรุ่นรีวิวโทนเนอร์', hook: 'หน้ามันทั้งวัน?', status: 'in_production', episodeId: 7, episodeNumber: 1 },
  { angle: 'ก่อนหลังใช้ 7 วัน', hook: 'เห็นผลในสัปดาห์เดียว', status: 'approved', episodeId: null, episodeNumber: null },
]) {
  await db.insert(schema.campaignCreatives).values({
    campaignId,
    angle: c.angle,
    hook: c.hook,
    format: c.angle.includes('ก่อน') ? 'before_after' : 'ugc',
    platform: 'tiktok',
    durationSec: 30,
    script: '## S1 | 内景 · 卧室 | 白天',
    status: c.status,
    episodeId: c.episodeId,
    episodeNumber: c.episodeNumber,
    createdAt: ts,
    updatedAt: ts,
  })
}

console.log(`seeded campaign ${campaignId} + 2 creatives at ${process.env.DATABASE_URL}`)
await closeDb()
process.exit(0)
