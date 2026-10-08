#!/usr/bin/env node
/**
 * AI Marketer — API contract smoke test (PLAN.md §4)
 *
 *   node docs/ai-marketer/e2e-smoke.mjs                 # BASE_URL 默认 http://127.0.0.1:5680
 *   BASE_URL=http://127.0.0.1:5679 node docs/ai-marketer/e2e-smoke.mjs
 *   FULL=1 node docs/ai-marketer/e2e-smoke.mjs          # 需已配置文本模型：research → strategy → creatives → produce
 *   KEEP=1 ...                                          # 不删除测试 campaign
 *
 * 无文本模型时，异步接口应返回 E_NO_TEXT_MODEL（或 202 后 status=failed），视为通过。
 */
const BASE = (process.env.BASE_URL || 'http://127.0.0.1:5680').replace(/\/$/, '')
const FULL = process.env.FULL === '1'
const AUTH = process.env.NAKA_AUTH_PASSWORD
  ? 'Basic ' + Buffer.from(`${process.env.NAKA_AUTH_USER || 'admin'}:${process.env.NAKA_AUTH_PASSWORD}`).toString('base64')
  : null

let passed = 0
let failed = 0
const results = []

async function call(method, path, body) {
  const headers = { 'Content-Type': 'application/json' }
  if (AUTH) headers.Authorization = AUTH
  const res = await fetch(BASE + '/api/v1' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null
  try { json = await res.json() } catch {}
  return { status: res.status, json, data: json?.data, errorCode: json?.errorCode }
}

async function step(name, fn) {
  try {
    const note = await fn()
    passed++
    results.push(`  ✔ ${name}${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failed++
    results.push(`  ✘ ${name} — ${err.message}`)
  }
}

function expect(cond, msg) { if (!cond) throw new Error(msg) }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const CAMPAIGN_KEYS = ['id', 'title', 'productUrl', 'productName', 'productDescription', 'productImages', 'brandNotes',
  'market', 'platforms', 'audience', 'goal', 'style', 'aspectRatio', 'status', 'errorMsg', 'dramaId', 'createdAt', 'updatedAt']
const DOC_KINDS = ['product_brief', 'market_research', 'audience_insight', 'message_map', 'campaign_plan', 'content_brief']

/** 异步接口：202 → 轮询直到非 *ing；无模型 → E_NO_TEXT_MODEL 也算通过 */
async function runAsync(path, body, readyStatus, id) {
  const r = await call('POST', path, body)
  if (r.errorCode === 'E_NO_TEXT_MODEL') return { noModel: true }
  expect(r.status === 202, `expected 202, got ${r.status} ${JSON.stringify(r.json)}`)
  const deadline = Date.now() + 10 * 60_000
  for (;;) {
    const g = await call('GET', `/campaigns/${id}`)
    const s = g.data?.status
    if (s && !s.endsWith('ing')) {
      if (s === 'failed' && /E_NO_TEXT_MODEL|模型|model/i.test(g.data.errorMsg || '')) return { noModel: true }
      expect(s === readyStatus, `expected ${readyStatus}, got ${s} (${g.data.errorMsg})`)
      return { campaign: g.data }
    }
    expect(Date.now() < deadline, `timeout waiting for ${readyStatus} (still ${s})`)
    await sleep(2000)
  }
}

let id = null
let noModel = false

await step('health', async () => {
  const r = await call('GET', '/health')
  expect(r.status === 200, `status ${r.status}`)
})

await step('POST /campaigns requires productName or productUrl', async () => {
  const r = await call('POST', '/campaigns', { title: 'x' })
  expect(r.status === 400, `expected 400, got ${r.status}`)
})

await step('POST /campaigns', async () => {
  const r = await call('POST', '/campaigns', {
    title: 'E2E Smoke — เซรั่มวิตามินซี',
    productName: 'Vit C Glow Serum 30ml',
    productDescription: 'เซรั่มวิตามินซี 15% ผิวกระจ่างใสใน 14 วัน ไม่เหนียวเหนอะหนะ',
    brandNotes: 'โทนสดใส เป็นกันเอง ห้ามเคลมรักษาโรค',
    platforms: ['tiktok', 'shopee'],
    audience: 'ผู้หญิง 20-35 ทำงานออฟฟิศ',
    goal: 'เพิ่มยอดขาย TikTok Shop',
    aspectRatio: '9:16',
  })
  expect(r.status === 201 || r.status === 200, `status ${r.status} ${JSON.stringify(r.json)}`)
  id = r.data?.id
  expect(id, 'no id')
  const missing = CAMPAIGN_KEYS.filter((k) => !(k in r.data))
  expect(!missing.length, `missing keys: ${missing.join(', ')}`)
  expect(Array.isArray(r.data.productImages) && Array.isArray(r.data.platforms), 'productImages/platforms must be arrays')
  expect(r.data.market === 'TH', `market default should be TH, got ${r.data.market}`)
  expect(r.data.status === 'draft', `status should be draft, got ${r.data.status}`)
  return `id=${id}`
})

await step('GET /campaigns lists it', async () => {
  const r = await call('GET', '/campaigns')
  expect(Array.isArray(r.data), 'data not array')
  expect(r.data.some((c) => c.id === id), 'campaign not in list')
})

await step('GET /campaigns/:id includes docs + creatives', async () => {
  const r = await call('GET', `/campaigns/${id}`)
  expect(Array.isArray(r.data?.docs) && Array.isArray(r.data?.creatives), 'docs/creatives arrays missing')
})

await step('PUT /campaigns/:id', async () => {
  const r = await call('PUT', `/campaigns/${id}`, { goal: 'เปิดตัวสินค้าใหม่', platforms: ['tiktok', 'reels'] })
  expect(r.status === 200, `status ${r.status}`)
  expect(r.data.goal === 'เปิดตัวสินค้าใหม่' && r.data.platforms.includes('reels'), 'update not applied')
})

await step('GET /campaigns/999999999 → 404', async () => {
  const r = await call('GET', '/campaigns/999999999')
  expect(r.status === 404, `expected 404, got ${r.status}`)
})

await step('strategy before research → E_STRATEGY_NEEDS_RESEARCH', async () => {
  const r = await call('POST', `/campaigns/${id}/strategy`)
  expect(r.errorCode === 'E_STRATEGY_NEEDS_RESEARCH', `got ${r.status} ${r.errorCode}`)
})

await step('creatives before strategy → E_CREATIVES_NEED_STRATEGY', async () => {
  const r = await call('POST', `/campaigns/${id}/creatives/generate`, { count: 2 })
  expect(r.errorCode === 'E_CREATIVES_NEED_STRATEGY', `got ${r.status} ${r.errorCode}`)
})

for (const url of ['http://127.0.0.1:5679/', 'http://localhost/', 'http://169.254.169.254/latest/meta-data/', 'http://10.0.0.1/', 'file:///etc/passwd']) {
  await step(`ingest-url blocks ${url}`, async () => {
    const r = await call('POST', '/campaigns/ingest-url', { url })
    expect(r.status >= 400 && r.errorCode === 'E_INGEST_FAILED', `got ${r.status} ${r.errorCode}`)
  })
}

await step('research (async)', async () => {
  const out = await runAsync(`/campaigns/${id}/research`, { notes: 'คู่แข่ง: เซรั่ม A 299฿ รีวิวบ่นว่าเหนียว; เซรั่ม B 590฿ ขายดีใน TikTok' }, 'research_ready', id)
  if (out.noModel) { noModel = true; return 'no text model configured (E_NO_TEXT_MODEL) — LLM steps skipped' }
  const kinds = out.campaign.docs.map((d) => d.kind)
  expect(kinds.includes('market_research') && kinds.includes('product_brief'), `docs: ${kinds}`)
})

if (FULL && !noModel) {
  let creatives = []
  await step('strategy → 4 docs', async () => {
    const out = await runAsync(`/campaigns/${id}/strategy`, undefined, 'strategy_ready', id)
    const kinds = new Set(out.campaign.docs.map((d) => d.kind))
    const missing = DOC_KINDS.filter((k) => !kinds.has(k))
    expect(!missing.length, `missing docs: ${missing}`)
  })
  await step('PUT doc → version+1, approve', async () => {
    const doc = (await call('GET', `/campaigns/${id}`)).data.docs.find((d) => d.kind === 'message_map')
    const r = await call('PUT', `/campaigns/${id}/docs/${doc.id}`, { content: doc.content + '\n\n- e2e edit', status: 'approved' })
    expect(r.data.version === doc.version + 1 && r.data.status === 'approved', JSON.stringify(r.data))
  })
  await step('revise doc', async () => {
    const doc = (await call('GET', `/campaigns/${id}`)).data.docs.find((d) => d.kind === 'content_brief')
    const r = await call('POST', `/campaigns/${id}/docs/${doc.id}/revise`, { instruction: 'เพิ่ม hook แนวตลกอีก 2 แบบ' })
    expect(r.status === 200 && r.data.version > doc.version, `status ${r.status}`)
  })
  await step('creatives/generate count=2', async () => {
    const out = await runAsync(`/campaigns/${id}/creatives/generate`, { count: 2, formats: ['ugc', 'problem_solution'], platforms: ['tiktok'] }, 'creatives_ready', id)
    creatives = out.campaign.creatives
    expect(creatives.length >= 2, `got ${creatives.length}`)
    expect(creatives.every((c) => c.hook && c.script && c.format && c.platform), 'creative missing fields')
  })
  await step('approve + produce creative → drama/episode', async () => {
    const c = creatives[0]
    await call('PUT', `/campaigns/${id}/creatives/${c.id}`, { status: 'approved' })
    const r = await call('POST', `/campaigns/${id}/creatives/${c.id}/produce`)
    expect(r.data?.dramaId && r.data?.episodeNumber, JSON.stringify(r.json))
    const g = (await call('GET', `/campaigns/${id}`)).data
    const pc = g.creatives.find((x) => x.id === c.id)
    expect(g.dramaId === r.data.dramaId && pc.status === 'in_production' && pc.episodeId, 'campaign/creative not linked')
    return `→ /drama/${r.data.dramaId}/episode/${r.data.episodeNumber}`
  })
  await step('delete un-produced creative', async () => {
    const r = await call('DELETE', `/campaigns/${id}/creatives/${creatives[1].id}`)
    expect(r.status === 200, `status ${r.status}`)
  })
}

if (id && process.env.KEEP !== '1') {
  await step('DELETE /campaigns/:id (soft)', async () => {
    const r = await call('DELETE', `/campaigns/${id}`)
    expect(r.status === 200, `status ${r.status}`)
    const l = await call('GET', '/campaigns')
    expect(!l.data.some((c) => c.id === id), 'still listed after delete')
  })
}

console.log(`\nAI Marketer smoke @ ${BASE}${FULL ? ' (FULL)' : ''}\n${results.join('\n')}\n\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
