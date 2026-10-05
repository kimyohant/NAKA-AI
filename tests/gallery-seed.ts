/**
 * Seed scratch DB สำหรับ smoke test gallery (รัน: npx tsx tests/gallery-seed.ts)
 * สร้าง campaign + creative (approved/in_production) เพื่อทดสอบ GET /gallery + PUT result
 */
process.env.SQLITE_PATH = process.env.SQLITE_PATH || 'data/gallery-smoke.sqlite3'

const { db, schema } = await import('../src/db/index.js')
const { eq } = await import('drizzle-orm')

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
})
const campaignId = Number(res.lastInsertRowid)

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

console.log(`seeded campaign ${campaignId} + 2 creatives at ${process.env.SQLITE_PATH}`)
process.exit(0)
