// AI Marketer 流程状态（纯函数，workspace 与测试共用）
// 流程参考 Topview AI Marketer：Brief → Research → Strategy(4 docs) → Creatives → Production

export const MARKETER_STEPS = ['brief', 'research', 'strategy', 'creatives', 'production']

export const RESEARCH_DOC_KINDS = ['product_brief', 'market_research']
export const STRATEGY_DOC_KINDS = ['audience_insight', 'message_map', 'campaign_plan', 'content_brief']

export const PLATFORMS = ['tiktok', 'reels', 'youtube_shorts', 'facebook', 'shopee', 'lazada']
export const CREATIVE_FORMATS = ['ugc', 'product_demo', 'problem_solution', 'before_after', 'testimonial', 'unboxing']
export const MARKETS = ['TH', 'SG', 'MY', 'ID', 'VN', 'PH', 'US', 'GLOBAL']
export const CAMPAIGN_RATIOS = ['9:16', '1:1', '16:9']

export const POLL_INTERVAL_MS = 2000

/** 异步任务进行中：status 以 -ing 结尾（researching / strategizing / writing） */
export function isBusyStatus(status) {
  return typeof status === 'string' && /ing$/.test(status)
}

/** 进行中的 status → 对应步骤 */
export function busyStep(status) {
  if (status === 'researching') return 'research'
  if (status === 'strategizing') return 'strategy'
  if (status === 'writing') return 'creatives'
  return null
}

/** 每种文档取最新一份（同 kind 多行时按 version → id 取最大） */
export function latestDocs(docs) {
  const map = {}
  for (const d of docs || []) {
    const cur = map[d.kind]
    if (!cur || (d.version || 0) > (cur.version || 0) || ((d.version || 0) === (cur.version || 0) && d.id > cur.id)) map[d.kind] = d
  }
  return map
}

export function hasDocs(docs, kinds) {
  const map = latestDocs(docs)
  return kinds.every(k => !!map[k]?.content?.trim())
}

export function stepDone(step, detail) {
  if (!detail) return false
  const docs = detail.docs || []
  const creatives = detail.creatives || []
  switch (step) {
    case 'brief': return !!(detail.productName || detail.productUrl)
    case 'research': return hasDocs(docs, ['market_research'])
    case 'strategy': return hasDocs(docs, STRATEGY_DOC_KINDS)
    case 'creatives': return creatives.length > 0
    case 'production': return creatives.some(c => c.status === 'in_production')
    default: return false
  }
}

/** 打开 workspace 时默认落在哪一步：进行中的任务优先，否则第一个未完成步骤 */
export function suggestedStep(detail) {
  const busy = busyStep(detail?.status)
  if (busy) return busy
  if (!detail) return 'brief'
  const creatives = detail.creatives || []
  if (creatives.some(c => c.status === 'approved' || c.status === 'in_production')) return 'production'
  for (const step of MARKETER_STEPS.slice(1)) {
    if (!stepDone(step, detail)) return step
  }
  return 'production'
}

/** status=failed 时的重试目标：契约未返回失败阶段，按已有产物推断 */
export function retryTarget(detail, lastAction) {
  if (lastAction) return lastAction
  const docs = detail?.docs || []
  if (!hasDocs(docs, ['market_research'])) return 'research'
  if (!hasDocs(docs, ['content_brief'])) return 'strategy'
  return 'creatives'
}

/** 从 errorMsg 中提取稳定错误码（如 E_NO_TEXT_MODEL） */
export function errorCodeOf(text) {
  const m = String(text || '').match(/\bE_[A-Z0-9_]+\b/)
  return m ? m[0] : ''
}

/** 生成数量收敛到契约范围 1–10 */
export function clampCount(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return 3
  return Math.min(10, Math.max(1, v))
}
