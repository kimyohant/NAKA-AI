import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('campaigns route implements the full API contract', () => {
  const route = read('src/routes/campaigns.ts')

  // CRUD
  assert.match(route, /app\.get\('\/'/)
  assert.match(route, /app\.post\('\/'/)
  assert.match(route, /app\.get\('\/:id'/)
  assert.match(route, /app\.put\('\/:id'/)
  assert.match(route, /app\.delete\('\/:id'/)
  // URL ingest + 异步任务 + docs + creatives
  assert.match(route, /app\.post\('\/ingest-url'/)
  assert.match(route, /app\.post\('\/:id\/research'/)
  assert.match(route, /app\.post\('\/:id\/strategy'/)
  assert.match(route, /app\.put\('\/:id\/docs\/:docId'/)
  assert.match(route, /app\.post\('\/:id\/docs\/:docId\/revise'/)
  assert.match(route, /app\.get\('\/:id\/docs\/:docId\/revisions'/)
  assert.match(route, /revisions\/:revId\/restore'/)
  assert.match(route, /app\.post\('\/:id\/creatives\/generate'/)
  assert.match(route, /app\.put\('\/:id\/creatives\/:cid'/)
  assert.match(route, /app\.delete\('\/:id\/creatives\/:cid'/)
  assert.match(route, /app\.post\('\/:id\/creatives\/:cid\/produce'/)
  // 202 受理 + 契约错误码 + append/replace mode
  assert.match(route, /202/)
  assert.match(route, /E_INGEST_FAILED/)
  assert.match(route, /mode 只支持 replace \/ append/)
  // 挂载
  assert.match(read('src/index.ts'), /api\.route\('\/campaigns', campaigns\)/)
  assert.match(read('src/index.ts'), /failStaleCampaigns/)
})

test('product-ingest enforces SSRF guards via safe-fetch', () => {
  const service = read('src/services/product-ingest.ts')
  assert.match(service, /safeFetch\(/)
  assert.match(service, /MAX_PAGE_BYTES/)
  assert.match(service, /MAX_IMAGE_BYTES/)
  assert.match(service, /E_INGEST_FAILED/)

  // SSRF 原语在 utils/safe-fetch.ts：协议白名单 + 建连时 DNS 复检 + 手动重定向 + 体积上限
  const safeFetch = read('src/utils/safe-fetch.ts')
  assert.match(safeFetch, /assertPublicHttpUrl/)
  assert.match(safeFetch, /isBlockedAddress/)
  assert.match(safeFetch, /Only http\/https URLs are allowed/)
  assert.match(safeFetch, /lookup: safeLookup/) // 建连时用同一次 DNS 解析做校验（防 rebinding）
  assert.match(safeFetch, /maxRedirects/)
  assert.match(safeFetch, /maxBytes/)
  assert.match(safeFetch, /setTimeout\(/)
})

test('marketer service guards async jobs and reuses pipeline tasks', () => {
  const service = read('src/services/marketer.ts')
  assert.match(service, /E_CAMPAIGN_BUSY/)
  assert.match(service, /E_STRATEGY_NEEDS_RESEARCH/)
  assert.match(service, /E_CREATIVES_NEED_STRATEGY/)
  assert.match(service, /getTextConfig/) // 无文本模型 → E_NO_TEXT_MODEL（ai.ts 抛出）
  assert.match(service, /startTask/)
  assert.match(service, /failStaleCampaigns/)
  assert.match(service, /in_production/)
  // research_notes เก็บ Evidence ของผู้ใช้ / doc revisions เก็บเนื้อหาเก่าก่อนทับ / append mode
  assert.match(service, /researchNotes/)
  assert.match(service, /snapshotDocRevision/)
  assert.match(service, /listDocRevisions/)
  assert.match(service, /creativeMode: mode/)
  assert.match(service, /Existing creatives/)
  // budgetThb (v8) → produce ส่งต่อให้ dramas.budget_thb, list กรองตาม status/dramaId ได้
  assert.match(service, /parseBudgetThb/)
  assert.match(service, /budgetThb: campaign\.budgetThb/)
  assert.match(service, /opts\.status/)
  // produce 复用 dramas/episodes 创建方式
  assert.match(service, /db\.insert\(schema\.dramas\)/)
  assert.match(service, /db\.insert\(schema\.episodes\)/)
  assert.match(service, /scriptContent: creative\.script/)
  // 真实商品 → prop 参考素材（ingest 的商品图挂到道具，prop 生图作参考）
  assert.match(service, /ensureProductProp/)
  assert.match(service, /db\.insert\(schema\.props\)/)
  assert.match(service, /referenceImages: JSON\.stringify\(images\)/)
  assert.match(service, /db\.insert\(schema\.episodeProps\)/)
  // prop 生图路由把参考图传给生成任务
  assert.match(read('src/routes/props.ts'), /referenceImages/)
})

test('marketer agents are registered with tools, prompts and skills', () => {
  const agents = read('src/agents/index.ts')
  for (const type of ['market_researcher', 'strategist', 'ad_scriptwriter']) {
    assert.match(agents, new RegExp(`${type}: \\{`), `${type} missing in DEFAULT_PROMPTS`)
  }
  assert.match(agents, /marketerTools\.readCampaign/)
  assert.match(agents, /marketerTools\.saveCampaignDoc/)
  assert.match(agents, /marketerTools\.saveCreatives/)

  const skills = read('src/agents/skills.ts')
  assert.match(skills, /market_researcher: \['market-researcher'\]/)
  assert.match(skills, /strategist: \['strategist'\]/)
  assert.match(skills, /ad_scriptwriter: \['ad-scriptwriter'\]/)

  for (const type of ['market_researcher', 'strategist', 'ad_scriptwriter']) {
    assert.ok(existsSync(new URL(`workspace/prompts/${type}.md`, root)), `prompts/${type}.md missing`)
    assert.ok(existsSync(new URL(`workspace/prompts/${type}.en.md`, root)), `prompts/${type}.en.md missing`)
  }
  for (const dir of ['market-researcher', 'strategist', 'ad-scriptwriter']) {
    assert.ok(existsSync(new URL(`workspace/skills/${dir}/SKILL.md`, root)), `skills/${dir}/SKILL.md missing`)
    assert.ok(existsSync(new URL(`workspace/skills/${dir}/SKILL.en.md`, root)), `skills/${dir}/SKILL.en.md missing`)
  }
})

test('campaign schema and pipeline task kinds are wired', () => {
  const sqliteSchema = read('src/db/sqlite-schema.ts')
  assert.match(sqliteSchema, /version: 6/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS campaigns/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS campaign_docs/)
  assert.match(sqliteSchema, /CREATE TABLE IF NOT EXISTS campaign_creatives/)

  const drizzle = read('src/db/schema.ts')
  assert.match(drizzle, /export const campaigns = sqliteTable\('campaigns'/)
  assert.match(drizzle, /export const campaignDocs = sqliteTable\('campaign_docs'/)
  assert.match(drizzle, /export const campaignCreatives = sqliteTable\('campaign_creatives'/)

  const pipeline = read('src/services/pipeline-tasks.ts')
  assert.match(pipeline, /campaign_research/)
  assert.match(pipeline, /campaign_strategy/)
  assert.match(pipeline, /campaign_creatives/)
})
