import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('gallery route: GET / + PUT/DELETE result + mount (docs/ai-marketer/GALLERY.md §3)', () => {
  const route = read('src/modules/marketer/routes/gallery.ts')
  assert.match(route, /app\.get\('\/'/)
  assert.match(route, /app\.put\('\/creatives\/:cid\/result'/)
  assert.match(route, /app\.delete\('\/creatives\/:cid\/result'/)
  assert.match(route, /E_INVALID_FIELD|err\?\.errorCode/)

  const index = ['src/index.ts', 'src/modules.ts', ...['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live'].map(m => `src/modules/${m}/index.ts`)].map(read).join('\n')
  assert.match(index, /import gallery from '\.\/routes\/gallery\.js'/)
  assert.match(index, /api\.route\('\/gallery', gallery\)/)
})

test('gallery service: manual analytics เท่านั้น — ห้ามมี fetch แพลตฟอร์ม + research evidence block', () => {
  const service = read('src/modules/marketer/services/gallery.ts')
  assert.doesNotMatch(service, /fetch\(|axios|tiktok\.com|playwright|puppeteer/)
  assert.match(service, /E_INVALID_FIELD/)
  assert.match(service, /performanceEvidenceBlock/)
  assert.match(service, /engagementRate/)

  // วงจรเรียนรู้: startResearch ต้องแนบ evidence (และคง message เดิมไว้เมื่อไม่มีผล)
  const marketer = read('src/modules/marketer/services/marketer.ts')
  assert.match(marketer, /performanceEvidenceBlock\(campaignId\)/)
  // deleteCreative ต้องเก็บกวาด creative_results ด้วย
  assert.match(marketer, /db\.delete\(schema\.creativeResults\)/)
})

test('schema: creativeResults ผูก creative_id UNIQUE + gallery กรอง campaign ที่ soft-delete', () => {
  const schema = read('src/core/db/schema.ts')
  assert.match(schema, /creativeResults = sqliteTable\('creative_results'/)
  assert.match(schema, /creativeId: integer\('creative_id'\)\.notNull\(\)\.unique\(\)/)
  const service = read('src/modules/marketer/services/gallery.ts')
  assert.match(service, /isNull\(schema\.campaigns\.deletedAt\)/)
  assert.match(service, /inArray\(schema\.campaignCreatives\.status, GALLERY_STATUSES\)/)
})
