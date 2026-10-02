/**
 * Agent 请求上下文 — 通过 Mastra RequestContext 按请求注入
 * 路由层 build → generate({ requestContext }) → 工具 execute 内读取
 */
import { RequestContext } from '@mastra/core/request-context'
import { getContentLanguage, type ContentLanguage } from '../services/app-settings.js'

export interface AgentRequestContextValues {
  episodeId: number
  dramaId: number
  modelOverride?: string
  textConfigId?: number
  /** AI 内容语言；缺省时读全局设置（app_settings.content_language） */
  language?: ContentLanguage
}

export function buildAgentRequestContext(values: AgentRequestContextValues): RequestContext<AgentRequestContextValues> {
  const rc = new RequestContext<AgentRequestContextValues>()
  rc.set('episodeId', values.episodeId)
  rc.set('dramaId', values.dramaId)
  if (values.modelOverride) rc.set('modelOverride', values.modelOverride)
  if (values.textConfigId) rc.set('textConfigId', values.textConfigId)
  // 语言在构建处统一解析：4 条链路（chat/提取/图片提示词/视频提示词）都经过这里，
  // 全局设置一处生效；显式传入 values.language 可按请求覆盖
  rc.set('language', values.language ?? getContentLanguage())
  return rc
}

export function getEpisodeId(requestContext: RequestContext | undefined): number | null {
  const v = requestContext?.get('episodeId' as never)
  return typeof v === 'number' ? v : null
}

export function getDramaId(requestContext: RequestContext | undefined): number | null {
  const v = requestContext?.get('dramaId' as never)
  return typeof v === 'number' ? v : null
}

/** 读取请求上下文中的内容语言；未设置返回 null（调用方按 zh 处理） */
export function getContentLanguageFromRC(requestContext: RequestContext | undefined): ContentLanguage | null {
  const v = requestContext?.get('language' as never)
  return typeof v === 'string' && v ? (v as ContentLanguage) : null
}

/**
 * AI Marketer Agent 上下文（market_researcher / strategist / ad_scriptwriter）
 * 与剧集链路不同：按 campaignId 定位；docKinds 限定本次允许写入的文档类型（revise 时只放行目标文档），
 * creativeQuota 限定本次最多新增的 creative 数量（工具内计数，超出即拒绝）
 */
export interface CampaignRequestContextValues {
  campaignId: number
  docKinds?: string[]
  creativeQuota?: number
  /** 'replace'（默认）：覆盖旧 draft；'append'：追加，保留全部已有 creative */
  creativeMode?: 'replace' | 'append'
  /** Phase 3 recreate mode：本次 analyze/save_reference_analysis 作用的 reference，或 creatives/generate 依据的 reference */
  referenceId?: number
  language?: ContentLanguage
}

export function buildCampaignRequestContext(values: CampaignRequestContextValues): RequestContext {
  const rc = new RequestContext()
  rc.set('campaignId', values.campaignId)
  if (values.docKinds) rc.set('docKinds', values.docKinds)
  if (values.creativeQuota !== undefined) {
    rc.set('creativeQuota', values.creativeQuota)
    rc.set('creativesSaved', 0)
  }
  if (values.creativeMode) rc.set('creativeMode', values.creativeMode)
  if (values.referenceId !== undefined) rc.set('referenceId', values.referenceId)
  rc.set('language', values.language ?? getContentLanguage())
  return rc
}

export function getCampaignId(requestContext: RequestContext | undefined): number | null {
  const v = requestContext?.get('campaignId' as never)
  return typeof v === 'number' ? v : null
}
