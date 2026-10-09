/**
 * AI Marketer quick start (ported from naka-drama-studio feat/marketer-topview): templates / experts / categories,
 * quick analysis (marketer_insights, migrations/pg/0003) on PGlite with a fake agent, autopilot research → strategy → creatives
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

process.env.DATABASE_URL = 'pglite://memory'
const { db, schema, rawQuery } = await import('../src/core/db/index.js')
const { now } = await import('../src/core/http/response.js')
const { runAsOwner } = await import('../src/core/auth/owner-context.js')
const { mastra } = await import('../src/core/mastra/index.js')
const { sqlite } = await import('./_sql.js')
const quick = await import('../src/modules/marketer/services/marketer-quick.js')
const { TREND_INDUSTRIES } = await import('../src/modules/marketer/services/trending.js')
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const reports: string[] = []
const realGetAgent = mastra.getAgent.bind(mastra)
;(mastra as any).getAgent = (type: string) => type === 'marketing_insight'
  ? { generate: async () => ({ text: reports.shift() ?? '' }) }
  : realGetAgent(type)
const waitFor = async (fn: () => Promise<boolean>, ms = 3000) => {
  const end = Date.now() + ms
  while (Date.now() < end) { if (await fn()) return; await new Promise(r => setTimeout(r, 20)) }
  throw new Error('waitFor timeout')
}

test('catalog: 12 unique templates in 4 groups, 6 experts, 14 categories mapped to real trend industries', () => {
  const ids = quick.QUICK_TEMPLATES.map(t => t.id)
  assert.equal(ids.length, 12)
  assert.equal(new Set(ids).size, 12)
  for (const group of quick.QUICK_GROUPS) assert.ok(quick.QUICK_TEMPLATES.filter(t => t.group === group).length >= 2, group)
  for (const t of quick.QUICK_TEMPLATES) assert.match(t.prompt, /\[[^\]]+\]/, `${t.id} needs a [placeholder]`)
  assert.deepEqual(Object.keys(quick.QUICK_EXPERTS), ['general', 'tiktok_shop', 'shopee', 'lazada', 'facebook', 'line_oa'])
  assert.equal(Object.keys(quick.QUICK_CATEGORIES).length, 14)
  for (const industry of Object.values(quick.QUICK_CATEGORIES)) assert.ok(TREND_INDUSTRIES.includes(industry), industry)
  const catalog = quick.quickCatalog()
  assert.equal(catalog.templates.length, 12)
  assert.deepEqual(catalog.groups, ['market', 'listing', 'content', 'ads'])
})

test('insight input: prompt required and capped, unknown template/expert/category fall back safely', () => {
  assert.throws(() => quick.parseInsightBody({ prompt: '   ' }), /prompt/)
  assert.throws(() => quick.parseInsightBody({ prompt: 'x'.repeat(4001) }), /4000/)
  assert.throws(() => quick.parseInsightBody({ prompt: 'ok', productName: 5 }), /productName/)
  const parsed = quick.parseInsightBody({ prompt: '  วิเคราะห์หมวดความงาม  ', templateId: 'nope', expert: 'hacker', category: 'beauty', productName: ' เซรั่ม ' })
  assert.deepEqual(parsed, { templateId: null, prompt: 'วิเคราะห์หมวดความงาม', expert: 'general', category: 'beauty', productName: 'เซรั่ม' })
  assert.equal(quick.parseInsightBody({ prompt: 'x', templateId: 'pricing_strategy', expert: 'shopee' }).expert, 'shopee')
})

test('insight message: expert role, Thai market rules, curated trending evidence for the category, the seller task', () => {
  const message = quick.buildInsightMessage(quick.parseInsightBody({ prompt: 'สินค้ามาแรงในหมวดความงาม', expert: 'tiktok_shop', category: 'beauty', productName: 'คลีนเซอร์' }))
  assert.match(message, /TikTok Shop Thailand expert/)
  assert.match(message, /11\.11/)
  assert.match(message, /Thai FDA/)
  assert.match(message, /Trending evidence/)
  assert.match(message, /\[beauty\//) // evidence filtered to the beauty industry
  assert.match(message, /คลีนเซอร์/)
  assert.match(message, /สินค้ามาแรงในหมวดความงาม/)
  assert.doesNotMatch(quick.trendingEvidence('kitchen'), /\[beauty\//) // kitchen → home industry only
})

test('migration 0003 creates marketer_insights with an owner index', async () => {
  const migrations = (await rawQuery('SELECT name FROM schema_migrations ORDER BY name')).map(r => r.name)
  assert.ok(migrations.includes('0003_marketer_insights.sql'), 'migration not recorded')
  const cols = await sqlite.columns('marketer_insights')
  for (const col of ['owner_user_id', 'template_id', 'prompt', 'expert', 'category', 'product_name', 'status', 'result', 'error_msg']) assert.ok(cols.includes(col), col)
  const indexes = (await rawQuery("SELECT indexname FROM pg_indexes WHERE tablename = 'marketer_insights'")).map(r => r.indexname)
  assert.ok(indexes.includes('idx_marketer_insights_owner'))
})

test('no text model → E_NO_TEXT_MODEL before a row is written', async () => {
  await assert.rejects(() => quick.createInsight({ prompt: 'วิเคราะห์' }), (e: any) => e.errorCode === 'E_NO_TEXT_MODEL')
  assert.equal((await quick.listInsights()).length, 0)
})

test('an analysis runs in the background: processing → completed with the report, failed on an empty report', async () => {
  await db.insert(schema.aiServiceConfigs).values({
    serviceType: 'text', provider: 'openai', name: 'test', baseUrl: 'http://127.0.0.1:1', apiKey: 'k', model: JSON.stringify(['m']),
    isActive: true, priority: 1, createdAt: now(), updatedAt: now(),
  } as any)
  reports.push('# รายงาน\nสรุปสั้น')
  const created = await quick.createInsight({ prompt: 'วิเคราะห์หมวดความงาม', templateId: 'category_opportunity', category: 'beauty' })
  assert.equal(created.status, 'processing')
  assert.equal(created.templateId, 'category_opportunity')
  await waitFor(async () => (await quick.getInsight(created.id))?.status === 'completed')
  assert.equal((await quick.getInsight(created.id))?.result, '# รายงาน\nสรุปสั้น')

  reports.push('   ')
  const empty = await quick.createInsight({ prompt: 'อีกงาน' })
  await waitFor(async () => (await quick.getInsight(empty.id))?.status === 'failed')
  assert.match((await quick.getInsight(empty.id))?.errorMsg || '', /empty report/)

  assert.equal(await quick.deleteInsight(empty.id), true)
  assert.equal(await quick.deleteInsight(empty.id), false)
})

test('restart: analyses left processing are closed as failed', async () => {
  const t = now()
  await db.insert(schema.marketerInsights).values({ prompt: 'ค้าง', status: 'processing', createdAt: t, updatedAt: t })
  assert.ok(await quick.failStaleInsights() >= 1)
  const [row] = (await rawQuery("SELECT status, error_msg FROM marketer_insights WHERE prompt = 'ค้าง'"))
  assert.equal(row.status, 'failed')
  assert.match(String(row.error_msg), /^E_TASK_INTERRUPTED/)
})

test('insights belong to the member who asked: lists are scoped, ids are checked by auth/ownership.ts', async () => {
  const t = now()
  await db.insert(schema.marketerInsights).values([
    { ownerUserId: 'member-a', prompt: 'prompt of A', status: 'completed', createdAt: t, updatedAt: t },
    { ownerUserId: 'member-b', prompt: 'prompt of B', status: 'completed', createdAt: t, updatedAt: t },
  ])
  const seen = async (ownerId: string, admin = false) =>
    (await runAsOwner({ ownerId, admin }, () => quick.listInsights())).map((i: any) => i.prompt).filter((p: string) => p.startsWith('prompt of'))
  assert.deepEqual(await seen('member-a'), ['prompt of A'])
  assert.deepEqual(await seen('member-b'), ['prompt of B'])
  const ownership = read('src/core/auth/ownership.ts')
  assert.match(ownership, /insight: own\('marketer_insights'\)/)
  assert.match(ownership, /marketer: \{ insights: 'insight' \}/)
})

test('wiring: menu mounts /marketer, stale insights closed on boot, agent has no tools, autopilot chains the steps, plan gate', () => {
  const index = read('src/modules/marketer/index.ts')
  assert.match(index, /api\.route\('\/marketer', marketerQuick\)/)
  assert.match(index, /failStaleInsights\(\)/)
  const routes = read('src/modules/marketer/routes/marketer-quick.ts')
  for (const r of [/app\.get\('\/catalog'/, /app\.post\('\/insights'/, /app\.get\('\/insights\/:id'/, /app\.delete\('\/insights\/:id'/]) assert.match(routes, r)
  assert.match(read('src/modules/marketer/routes/campaigns.ts'), /app\.post\('\/:id\/autopilot'/)
  const marketer = read('src/modules/marketer/services/marketer.ts')
  assert.match(marketer, /export async function startAutopilot/)
  assert.match(marketer, /startResearch\(campaignId, opts\.notes, \(\) => startStrategy\(campaignId, creatives\)\)/)
  assert.match(marketer, /if \(!reference\.analysis\) await analyzeAdReference/)
  assert.match(marketer, /if \(opts\.next\) \{/)
  const agents = read('src/core/agents/index.ts')
  assert.match(agents, /marketing_insight: \{/)
  assert.doesNotMatch(agents.split('const AGENT_TOOLS')[1] ?? '', /marketing_insight: /)
  assert.match(read('src/core/tasks/pipeline-tasks.ts'), /'marketer_insight'/)
  assert.match(read('src/core/auth/entitlements.ts'), /\['\/api\/v1\/marketer', \['studio\.marketer'\]\]/)
})
