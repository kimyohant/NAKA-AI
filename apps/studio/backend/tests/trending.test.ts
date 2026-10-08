/**
 * Trending Videos (Thailand) unit tests — data integrity + filter/sort (docs/ai-marketer/TRENDING.md)
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  listTrendVideos,
  TREND_INDUSTRIES,
  TRENDING_CURATED_AT,
  type TrendVideo,
} from '../src/modules/marketer/services/trending.js'

const all = listTrendVideos().entries

test('trend library: TH-only, unique ids, required fields present', () => {
  assert.ok(all.length >= 12, `คลังต้องมีอย่างน้อย 12 รายการ (ได้ ${all.length})`)
  const ids = new Set<string>()
  for (const e of all) {
    assert.ok(!ids.has(e.id), `id ซ้ำ: ${e.id}`)
    ids.add(e.id)
    assert.ok(e.title.trim().length >= 10, `title สั้นเกิน: ${e.id}`)
    assert.ok((TREND_INDUSTRIES as string[]).includes(e.industry), `industry ไม่รู้จัก: ${e.id}`)
    assert.ok(['tiktok', 'reels', 'youtube_shorts'].includes(e.platform), `platform ผิด: ${e.id}`)
    assert.ok(e.hookType.trim(), `hookType ว่าง: ${e.id}`)
    assert.ok(e.views > 0, `views ต้อง > 0: ${e.id}`)
    assert.ok(e.durationSec > 0 && e.durationSec <= 180, `durationSec ผิดช่วง: ${e.id}`)
    assert.ok(e.hashtags.length >= 1 && e.hashtags.every(h => !h.startsWith('#')), `hashtags ต้องไม่มี # นำหน้า: ${e.id}`)
    assert.ok(e.summary.trim().length >= 30, `summary สั้นเกิน: ${e.id}`)
    assert.ok(e.sourceUrl === null || /^https?:\/\//.test(e.sourceUrl), `sourceUrl ต้องเป็น http/https หรือ null: ${e.id}`)
  }
})

test('trend library: pattern brief ครบ (hook + beats + cta) — ใช้เป็น transcript ของ AdReference ได้', () => {
  for (const e of all) {
    assert.ok(e.pattern.hook.trim(), `pattern.hook ว่าง: ${e.id}`)
    assert.ok(e.pattern.cta.trim(), `pattern.cta ว่าง: ${e.id}`)
    assert.ok(e.pattern.beats.length >= 3 && e.pattern.beats.length <= 6, `beats ผิดจำนวน: ${e.id}`)
    const total = e.pattern.beats.reduce((s, b) => s + b.durationSec, 0)
    assert.ok(total <= e.durationSec, `beats รวมยาวกว่า durationSec: ${e.id} (${total} > ${e.durationSec})`)
    for (const b of e.pattern.beats) {
      assert.ok(['hook', 'demo', 'proof', 'offer', 'cta'].includes(b.role), `beat role ไม่รู้จัก: ${e.id}`)
      assert.ok(b.line.trim() && b.durationSec > 0, `beat ว่าง/เวลาผิด: ${e.id}`)
    }
  }
})

test('filter: industry ตรงตัว, industry ไม่รู้จัก → E_INVALID_FIELD', () => {
  const beauty = listTrendVideos({ industry: 'beauty' })
  assert.ok(beauty.entries.length >= 2)
  assert.ok(beauty.entries.every(e => e.industry === 'beauty'))
  assert.ok(beauty.industries.length >= 5, 'industries ต้องรายงานทุกกลุ่มที่มีจริงในคลัง')
  assert.equal(beauty.curatedAt, TRENDING_CURATED_AT)

  assert.throws(() => listTrendVideos({ industry: 'crypto' }), (err: any) => err?.errorCode === 'E_INVALID_FIELD')
})

test('sort: views default / revenue (null ไปท้าย) / engagement, ผิดค่า → E_INVALID_FIELD', () => {
  const byViews = listTrendVideos()
  const viewsArr = byViews.entries.map(e => e.views)
  assert.deepEqual([...viewsArr].sort((a, b) => b - a), viewsArr, 'default ต้องเรียง views มาก→น้อย')

  const byRevenue = listTrendVideos({ sort: 'revenue' })
  const rev = byRevenue.entries.map(e => e.estRevenueThb)
  const known = rev.filter((v): v is number => v !== null)
  assert.deepEqual([...known].sort((a, b) => b - a), known)
  // null ต้องอยู่ท้ายสุดเท่านั้น
  const firstNull = rev.indexOf(null)
  assert.ok(rev.slice(firstNull === -1 ? rev.length : firstNull).every(v => v === null), 'null ต้องไปท้าย')

  const byEng = listTrendVideos({ sort: 'engagement' })
  const eng = byEng.entries.map(e => e.engagementRate ?? -1)
  assert.deepEqual([...eng].sort((a, b) => b - a), eng)

  assert.throws(() => listTrendVideos({ sort: 'likes' }), (err: any) => err?.errorCode === 'E_INVALID_FIELD')
  // sort เว้นว่าง = default views (frontend ส่งมาเป็น '' ได้)
  assert.equal(listTrendVideos({ sort: '' }).entries[0].id, byViews.entries[0].id)
})

test('search q: ค้น title + hashtags แบบไม่สนตัวพิมพ์', () => {
  const hitHashtag = listTrendVideos({ q: 'กางเกงกีฬา' })
  assert.ok(hitHashtag.entries.length >= 1)
  assert.ok(hitHashtag.entries.every(e =>
    e.title.toLowerCase().includes('กางเกงกีฬา') || e.hashtags.some(h => h.toLowerCase().includes('กางเกงกีฬา'))))
  assert.equal(listTrendVideos({ q: 'ไม่มีคำนี้แน่นอน 000' }).entries.length, 0)
  // q ว่าง = ไม่กรอง
  assert.equal(listTrendVideos({ q: '' }).entries.length, all.length)
})

test('ทุกเทรนด์ประกาศ platform ให้ตรงกับ Platform enum ของ marketer (ใช้สร้าง campaign ต่อได้)', () => {
  // Platform เดิม: tiktok/reels/youtube_shorts/facebook/shopee/lazada — คลังไทยใช้ subset 3 ค่าแรก
  const valid = new Set(['tiktok', 'reels', 'youtube_shorts'])
  assert.ok(all.every((e: TrendVideo) => valid.has(e.platform)))
})
