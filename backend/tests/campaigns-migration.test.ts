import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import Database from 'better-sqlite3'
import { initSqliteSchema } from '../src/db/sqlite-schema.js'
import { isBlockedAddress, assertPublicHttpUrl, SafeFetchError } from '../src/utils/safe-fetch.js'
import { ingestProductUrl } from '../src/services/product-ingest.js'
import { AppError } from '../src/utils/response.js'

test('migration v6 creates campaign tables and stays idempotent', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'naka-campaign-test-'))
  const dbFile = path.join(directory, 'test.sqlite3')
  let sqlite: Database.Database | undefined
  try {
    sqlite = new Database(dbFile)
    sqlite.pragma('journal_mode = WAL')
    initSqliteSchema(sqlite)
    initSqliteSchema(sqlite) // 幂等重放
    const versions = sqlite.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>
    assert.deepEqual(versions.map(row => row.version), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13])

    const campaignCols = (sqlite.pragma('table_info(campaigns)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['product_url', 'product_name', 'product_images', 'brand_notes', 'market', 'platforms',
      'audience', 'goal', 'style', 'aspect_ratio', 'status', 'error_msg', 'drama_id', 'deleted_at']) {
      assert.ok(campaignCols.includes(col), `campaigns missing column ${col}`)
    }
    const docCols = (sqlite.pragma('table_info(campaign_docs)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['campaign_id', 'kind', 'content', 'status', 'version']) {
      assert.ok(docCols.includes(col), `campaign_docs missing column ${col}`)
    }
    const creativeCols = (sqlite.pragma('table_info(campaign_creatives)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['campaign_id', 'angle', 'hook', 'format', 'platform', 'duration_sec', 'cta', 'script',
      'status', 'episode_id', 'episode_number']) {
      assert.ok(creativeCols.includes(col), `campaign_creatives missing column ${col}`)
    }
    // 每活动每 kind 一份文档（upsert 依赖唯一约束）
    const docSql = sqlite.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'campaign_docs'").get() as { sql: string }
    assert.match(docSql.sql, /UNIQUE \(campaign_id, kind\)/)

    // v7: research_notes + ประวัติเอกสาร, v8: budget_thb
    assert.ok(campaignCols.includes('research_notes'), 'campaigns missing column research_notes')
    assert.ok(campaignCols.includes('budget_thb'), 'campaigns missing column budget_thb')
    const revCols = (sqlite.pragma('table_info(campaign_doc_revisions)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['doc_id', 'version', 'content', 'source', 'created_at']) {
      assert.ok(revCols.includes(col), `campaign_doc_revisions missing column ${col}`)
    }

    // v9 (Phase 3): campaign_ad_references + campaign_visuals + campaign_creatives.reference_id
    const refCols = (sqlite.pragma('table_info(campaign_ad_references)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['campaign_id', 'title', 'source_url', 'transcript', 'notes', 'analysis']) {
      assert.ok(refCols.includes(col), `campaign_ad_references missing column ${col}`)
    }
    const visCols = (sqlite.pragma('table_info(campaign_visuals)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['campaign_id', 'kind', 'source_image', 'instruction', 'prompt', 'task_id']) {
      assert.ok(visCols.includes(col), `campaign_visuals missing column ${col}`)
    }
    const creativeCols2 = (sqlite.pragma('table_info(campaign_creatives)') as Array<{ name: string }>).map(r => r.name)
    assert.ok(creativeCols2.includes('reference_id'), 'campaign_creatives missing column reference_id')

    // v10 (Product Studio)
    for (const table of ['studio_projects', 'studio_shots', 'studio_avatars', 'studio_images']) {
      const cols = (sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>).map(r => r.name)
      assert.ok(cols.length > 0, `${table} table missing`)
    }
    const spCols = (sqlite.pragma('table_info(studio_projects)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['template_id', 'language', 'market', 'platform', 'aspect_ratio', 'duration_sec', 'avatar_id', 'ai_disclosure', 'drama_id', 'episode_id', 'deleted_at']) {
      assert.ok(spCols.includes(col), `studio_projects missing column ${col}`)
    }
    const ssCols = (sqlite.pragma('table_info(studio_shots)') as Array<{ name: string }>).map(r => r.name)
    for (const col of ['storyboard_id', 'project_id', 'role', 'dialogue', 'on_screen_text']) {
      assert.ok(ssCols.includes(col), `studio_shots missing column ${col}`)
    }

    // 约束可用：插入/更新/JSON 数组存取
    const ts = '2026-01-01T00:00:00.000Z'
    const res = sqlite.prepare(`INSERT INTO campaigns (title, product_name, product_images, platforms, status, created_at, updated_at)
      VALUES ('t', 'p', '["/static/products/a.png"]', '["tiktok"]', 'draft', ?, ?)`).run(ts, ts)
    const campaignId = Number(res.lastInsertRowid)
    sqlite.prepare(`INSERT INTO campaign_docs (campaign_id, kind, content, status, version, created_at, updated_at)
      VALUES (?, 'market_research', '# r', 'draft', 1, ?, ?)`).run(campaignId, ts, ts)
    sqlite.prepare(`INSERT INTO campaign_creatives (campaign_id, angle, hook, format, platform, duration_sec, script, status, created_at, updated_at)
      VALUES (?, 'a', 'h', 'ugc', 'tiktok', 30, '## S1', 'draft', ?, ?)`).run(campaignId, ts, ts)
    const row = sqlite.prepare('SELECT product_images, platforms FROM campaigns WHERE id = ?').get(campaignId) as any
    assert.deepEqual(JSON.parse(row.product_images), ['/static/products/a.png'])
    assert.deepEqual(JSON.parse(row.platforms), ['tiktok'])
    // UNIQUE(campaign_id, kind) 生效
    assert.throws(() => sqlite!.prepare(`INSERT INTO campaign_docs (campaign_id, kind, content, status, version, created_at, updated_at)
      VALUES (?, 'market_research', '# dup', 'draft', 1, ?, ?)`).run(campaignId, ts, ts), /UNIQUE/)
  } finally {
    sqlite?.close()
    rmSync(directory, { recursive: true, force: true })
  }
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
