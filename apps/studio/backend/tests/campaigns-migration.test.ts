import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isBlockedAddress, assertPublicHttpUrl, SafeFetchError } from '../src/core/utils/safe-fetch.js'
import { ingestProductUrl } from '../src/core/product/product-ingest.js'
import { AppError } from '../src/core/http/response.js'

process.env.DATABASE_URL = 'pglite://memory'
const { rawQuery } = await import('../src/core/db/index.js')
const { sqlite } = await import('./_sql.js')

test('campaign + studio tables exist in the PostgreSQL schema with their constraints', async () => {
  const migrations = (await rawQuery('SELECT name FROM schema_migrations ORDER BY name')).map(r => r.name)
  assert.ok(migrations.includes('0001_baseline.sql'), 'baseline migration not recorded')

  const expect = async (table: string, cols: string[]) => {
    const have = await sqlite.columns(table)
    assert.ok(have.length > 0, `${table} table missing`)
    for (const col of cols) assert.ok(have.includes(col), `${table} missing column ${col}`)
  }
  await expect('campaigns', ['product_url', 'product_name', 'product_images', 'brand_notes', 'market', 'platforms',
    'audience', 'goal', 'style', 'aspect_ratio', 'status', 'error_msg', 'drama_id', 'deleted_at',
    'research_notes', 'budget_thb'])
  await expect('campaign_docs', ['campaign_id', 'kind', 'content', 'status', 'version'])
  await expect('campaign_creatives', ['campaign_id', 'angle', 'hook', 'format', 'platform', 'duration_sec', 'cta', 'script',
    'status', 'episode_id', 'episode_number', 'reference_id'])
  // 每活动每 kind 一份文档（upsert 依赖唯一约束）
  assert.ok((await sqlite.uniques('campaign_docs')).includes('campaign_id,kind'), 'campaign_docs UNIQUE (campaign_id, kind) missing')
  await expect('campaign_doc_revisions', ['doc_id', 'version', 'content', 'source', 'created_at'])
  await expect('campaign_ad_references', ['campaign_id', 'title', 'source_url', 'transcript', 'notes', 'analysis'])
  await expect('campaign_visuals', ['campaign_id', 'kind', 'source_image', 'instruction', 'prompt', 'task_id'])
  // Product Studio
  await expect('studio_projects', ['template_id', 'language', 'market', 'platform', 'aspect_ratio', 'duration_sec', 'avatar_id',
    'ai_disclosure', 'drama_id', 'episode_id', 'deleted_at'])
  await expect('studio_shots', ['storyboard_id', 'project_id', 'role', 'dialogue', 'on_screen_text'])
  await expect('studio_avatars', [])
  await expect('studio_images', [])

  // 约束可用：插入/更新/JSON 数组存取
  const ts = '2026-01-01T00:00:00.000Z'
  const res = await sqlite.prepare(`INSERT INTO campaigns (title, product_name, product_images, platforms, status, created_at, updated_at)
    VALUES ('t', 'p', '["/static/products/a.png"]', '["tiktok"]', 'draft', ?, ?)`).run(ts, ts)
  const campaignId = Number(res.lastInsertRowid)
  await sqlite.prepare(`INSERT INTO campaign_docs (campaign_id, kind, content, status, version, created_at, updated_at)
    VALUES (?, 'market_research', '# r', 'draft', 1, ?, ?)`).run(campaignId, ts, ts)
  await sqlite.prepare(`INSERT INTO campaign_creatives (campaign_id, angle, hook, format, platform, duration_sec, script, status, created_at, updated_at)
    VALUES (?, 'a', 'h', 'ugc', 'tiktok', 30, '## S1', 'draft', ?, ?)`).run(campaignId, ts, ts)
  const row = await sqlite.prepare('SELECT product_images, platforms FROM campaigns WHERE id = ?').get(campaignId)
  assert.deepEqual(JSON.parse(row.product_images), ['/static/products/a.png'])
  assert.deepEqual(JSON.parse(row.platforms), ['tiktok'])
  // UNIQUE(campaign_id, kind) 生效
  await assert.rejects(sqlite.prepare(`INSERT INTO campaign_docs (campaign_id, kind, content, status, version, created_at, updated_at)
    VALUES (?, 'market_research', '# dup', 'draft', 1, ?, ?)`).run(campaignId, ts, ts), (err: any) => err.code === '23505')
})

test('isBlockedAddress blocks private/loopback/link-local ranges', () => {
  const privateIps = [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '127.0.0.1', '169.254.1.1',
    '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '198.18.0.1',
    '224.0.0.1', '240.0.0.1', '::', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1',
  ]
  for (const ip of privateIps) assert.equal(isBlockedAddress(ip), true, `${ip} should be private`)
  const publicIps = ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111']
  for (const ip of publicIps) assert.equal(isBlockedAddress(ip), false, `${ip} should be public`)
  assert.equal(isBlockedAddress('not-an-ip'), true)
})

test('assertPublicHttpUrl rejects non-http protocols and private hosts; accepts public IP literals', () => {
  for (const url of ['ftp://example.com/a', 'file:///etc/passwd', 'http://127.0.0.1/x', 'http://[::1]/x',
    'http://192.168.1.5/x', 'http://169.254.169.254/latest/meta-data/', 'http://user:pass@example.com/x']) {
    assert.throws(() => assertPublicHttpUrl(url), SafeFetchError, `${url} should be rejected`)
  }
  const ok = assertPublicHttpUrl('https://8.8.8.8/x') // IP 字面量直接校验，无需网络
  assert.equal(ok.protocol, 'https:')
})

test('ingestProductUrl refuses loopback targets with E_INGEST_FAILED', async () => {
  await assert.rejects(
    ingestProductUrl('http://127.0.0.1:5679/api/v1/health'),
    (err: any) => err instanceof AppError && err.errorCode === 'E_INGEST_FAILED',
  )
})
