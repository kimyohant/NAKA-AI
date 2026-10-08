import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('trending route: GET / + validate error + mount (docs/ai-marketer/TRENDING.md §4)', () => {
  const route = read('src/modules/marketer/routes/trending.ts')
  assert.match(route, /app\.get\('\/'/)
  assert.match(route, /listTrendVideos/)
  assert.match(route, /E_INVALID_FIELD|err\?\.errorCode/) // service โยน AppError → route แปลง 400 + errorCode

  const index = ['src/index.ts', 'src/modules.ts', ...['drama', 'marketer', 'product-studio', 'seller', 'viral-clone', 'live'].map(m => `src/modules/${m}/index.ts`)].map(read).join('\n')
  assert.match(index, /import trending from '\.\/routes\/trending\.js'/)
  assert.match(index, /api\.route\('\/trending-videos', trending\)/)
})

test('trending service: คลัง curated TH — ไม่มี scraper และประกาศ curatedAt ชัด', () => {
  const service = read('src/modules/marketer/services/trending.ts')
  // กฎ ToS: ห้าม fetch แพลตฟอร์ม — service นี้ต้องเป็น static seed ล้วน
  assert.doesNotMatch(service, /fetch\(|axios|http\.get/)
  assert.match(service, /TRENDING_CURATED_AT/) // ป้าย "ข้อมูลอ้างอิง ณ วันคัดเข้าระบบ"
  assert.match(service, /E_INVALID_FIELD/)
})
