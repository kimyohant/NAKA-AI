const BASE = '/api/v1'

async function req<T = any>(method: string, path: string, body?: any): Promise<T> {
  const opts: RequestInit = { method, headers: { 'Content-Type': 'application/json' } }
  if (body) opts.body = JSON.stringify(body)

  const start = performance.now()
  console.log(`%c[API] %c${method} %c${path}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', body || '')

  try {
    const resp = await fetch(`${BASE}${path}`, opts)
    const json = await resp.json()
    const ms = Math.round(performance.now() - start)

    if (!resp.ok || (json.code && json.code >= 400)) {
      console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', json.message || '')
      // errorCode: รหัสเสถียรจาก backend (เช่น E_NO_TEXT_MODEL) → toastError แปลเป็นภาษา UI
      throw Object.assign(new Error(json.message || `${resp.status}`), { errorCode: json.errorCode || undefined, status: resp.status })
    }

    console.log(`%c[API] %c${method} ${path} %c${resp.status} %c${ms}ms`, 'color:#888', 'color:#66bb6a', 'color:#66bb6a;font-weight:bold', 'color:#888')
    return json.data ?? json
  } catch (err: any) {
    if (!err.message?.match(/^\d{3}$/)) {
      const ms = Math.round(performance.now() - start)
      console.log(`%c[API] %c${method} ${path} %cERROR %c${ms}ms`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold', 'color:#888', err.message)
    }
    throw err
  }
}

export const api = {
  get: <T = any>(p: string) => req<T>('GET', p),
  post: <T = any>(p: string, b?: any) => req<T>('POST', p, b),
  put: <T = any>(p: string, b?: any) => req<T>('PUT', p, b),
  del: <T = any>(p: string) => req<T>('DELETE', p),
}

export const dramaAPI = {
  list: () => api.get<{ items: any[] }>('/dramas'),
  get: (id: number) => api.get(`/dramas/${id}`),
  create: (data: any) => api.post('/dramas', data),
  update: (id: number, data: any) => api.put(`/dramas/${id}`, data),
  budget: (id: number) => api.get(`/dramas/${id}/budget`),
  del: (id: number) => api.del(`/dramas/${id}`),
}

export const episodeAPI = {
  create: (data: any) => api.post('/episodes', data),
  update: (id: number, data: any) => api.put(`/episodes/${id}`, data),
  del: (id: number) => api.del(`/episodes/${id}`),
  characters: (id: number) => api.get(`/episodes/${id}/characters`),
  scenes: (id: number) => api.get(`/episodes/${id}/scenes`),
  props: (id: number) => api.get(`/episodes/${id}/props`),
  storyboards: (id: number) => api.get(`/episodes/${id}/storyboards`),
  characterLooks: (id: number) => api.get(`/episodes/${id}/character-looks`),
  pipelineStatus: (id: number) => api.get(`/episodes/${id}/pipeline-status`),
  extract: (id: number, target: string, model?: string, configId?: number) => api.post(`/episodes/${id}/extract`, { target, model: model || undefined, config_id: configId || undefined }),
  extractStatus: (id: number) => api.get(`/episodes/${id}/extract-status`),
  generateVideoPrompts: (id: number, model?: string, configId?: number, storyboardIds?: number[]) => api.post(`/episodes/${id}/generate-video-prompts`, { model: model || undefined, config_id: configId || undefined, storyboard_ids: storyboardIds?.length ? storyboardIds : undefined }),
  videoPromptsStatus: (id: number) => api.get(`/episodes/${id}/video-prompts-status`),
  suggestHook: (id: number) => api.post(`/episodes/${id}/suggest-hook`, {}),
  reviewScript: (id: number, model?: string, configId?: number) => api.post(`/episodes/${id}/review-script`, { model: model || undefined, config_id: configId || undefined }),
  cancelExtract: (id: number, target: string) => api.post(`/episodes/${id}/extract/${target}/cancel`, {}),
  cancelVideoPrompts: (id: number) => api.post(`/episodes/${id}/generate-video-prompts/cancel`, {}),
}

export const storyboardAPI = {
  create: (data: any) => api.post('/storyboards', data),
  update: (id: number, data: any) => api.put(`/storyboards/${id}`, data),
  del: (id: number) => api.del(`/storyboards/${id}`),
  readiness: (id: number) => api.get(`/storyboards/${id}/readiness`),
  selectMedia: (id: number, taskId: number, slot: string) => api.post(`/storyboards/${id}/select-media`, { task_id: taskId, slot }),
  assignLook: (id: number, characterId: number, lookId: number | null) => api.put(`/storyboards/${id}/character-looks/${characterId}`, { look_id: lookId }),
}

export const characterAPI = {
  create: (data: any) => api.post('/characters', data),
  update: (id: number, data: any) => api.put(`/characters/${id}`, data),
  del: (id: number) => api.del(`/characters/${id}`),
  looks: (dramaId: number) => api.get(`/characters/looks?drama_id=${dramaId}`),
  createLook: (id: number, data: { name: string; image_url?: string }) => api.post(`/characters/${id}/looks`, data),
  deleteLook: (id: number, lookId: number) => api.del(`/characters/${id}/looks/${lookId}`),
  generatePrompt: (id: number, episodeId: number, force = false, textModel?: string, textConfigId?: number) => api.post(`/characters/${id}/generate-prompt`, { episode_id: episodeId, force, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  generateImage: (id: number, episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post(`/characters/${id}/generate-image`, { episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  batchImages: (ids: number[], episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post('/characters/batch-generate-images', { character_ids: ids, episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
}

export const sceneAPI = {
  create: (data: any) => api.post('/scenes', data),
  update: (id: number, data: any) => api.put(`/scenes/${id}`, data),
  del: (id: number) => api.del(`/scenes/${id}`),
  generatePrompt: (id: number, episodeId: number, force = false, textModel?: string, textConfigId?: number) => api.post(`/scenes/${id}/generate-prompt`, { episode_id: episodeId, force, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  generateImage: (id: number, episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post(`/scenes/${id}/generate-image`, { episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
}

export const propAPI = {
  create: (data: any) => api.post('/props', data),
  update: (id: number, data: any) => api.put(`/props/${id}`, data),
  del: (id: number) => api.del(`/props/${id}`),
  generatePrompt: (id: number, episodeId: number, force = false, textModel?: string, textConfigId?: number) => api.post(`/props/${id}/generate-prompt`, { episode_id: episodeId, force, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
  generateImage: (id: number, episodeId: number, model?: string, configId?: number, textModel?: string, textConfigId?: number) => api.post(`/props/${id}/generate-image`, { episode_id: episodeId, model: model || undefined, config_id: configId || undefined, text_model: textModel || undefined, text_config_id: textConfigId || undefined }),
}

// 统一生成任务（图片/视频）：POST 带 type 字段，列表按 type 过滤
export const taskAPI = {
  generate: (d: any) => api.post('/tasks', d),
  preflight: (d: any) => api.post('/tasks/preflight', d),
  get: (id: number) => api.get(`/tasks/${id}`),
  recover: (id: number) => api.post(`/tasks/${id}/recover`, {}),
  del: (id: number) => api.del(`/tasks/${id}`),
  list: (params?: { type?: 'image' | 'video'; drama_id?: number; storyboard_id?: number }) => {
    const query = new URLSearchParams()
    if (params?.type) query.set('type', params.type)
    if (params?.drama_id) query.set('drama_id', String(params.drama_id))
    if (params?.storyboard_id) query.set('storyboard_id', String(params.storyboard_id))
    return api.get(`/tasks${query.size ? `?${query.toString()}` : ''}`)
  },
  // 按集聚合生成任务（sys_task + video_merges）
  listByEpisode: (episodeId: number) => api.get<{ tasks: any[]; merges: any[] }>(`/episodes/${episodeId}/generation-tasks`),
}

async function uploadReq<T = any>(path: string, file: File): Promise<T> {
  const fd = new FormData()
  fd.append('file', file)
  console.log(`%c[API] %cPOST %c${path} %c${file.name}`, 'color:#888', 'color:#4fc3f7;font-weight:bold', 'color:#ccc', 'color:#888')
  const resp = await fetch(`${BASE}${path}`, { method: 'POST', body: fd })
  const json = await resp.json()
  if (!resp.ok || (json.code && json.code >= 400)) {
    console.log(`%c[API] %cPOST ${path} %c${resp.status}`, 'color:#888', 'color:#ef5350', 'color:#ef5350;font-weight:bold')
    throw new Error(json.message || `${resp.status}`)
  }
  return json.data ?? json
}

export const uploadAPI = {
  image: (f: File) => uploadReq<{ url: string; path: string }>('/upload/image', f),
  video: (f: File) => uploadReq<{ url: string; path: string }>('/upload/video', f),
  audio: (f: File) => uploadReq<{ url: string; path: string }>('/upload/audio', f),
}
export const mergeAPI = {
  health: (epId: number, storyboardIds?: number[]) => api.get(`/merge/episodes/${epId}/health${storyboardIds?.length ? `?storyboard_ids=${storyboardIds.join(',')}` : ''}`),
  merge: (epId: number, storyboardIds?: number[]) => api.post(`/merge/episodes/${epId}/merge`, storyboardIds?.length ? { storyboard_ids: storyboardIds } : {}),
  status: (epId: number) => api.get(`/merge/episodes/${epId}/merge`),
  list: (epId: number) => api.get<any[]>(`/merge/episodes/${epId}/merges`),
}
export const aiConfigAPI = {
  list: (t?: string) => api.get(`/ai-configs${t ? `?service_type=${t}` : ''}`),
  create: (d: any) => api.post('/ai-configs', d),
  update: (id: number, d: any) => api.put(`/ai-configs/${id}`, d),
  del: (id: number) => api.del(`/ai-configs/${id}`),
  test: (d: any) => api.post('/ai-configs/test', d),
}

// lang 缺省/为 zh 时读写基础版（不带 query，保持原请求形态）
const langQ = (lang?: string) => (lang && lang !== 'zh' ? `?lang=${lang}` : '')

export const promptAPI = {
  list: () => api.get('/prompts'),
  get: (type: string, lang?: string) => api.get(`/prompts/${type}${langQ(lang)}`),
  update: (type: string, d: any, lang?: string) => api.put(`/prompts/${type}${langQ(lang)}`, d),
  reset: (type: string, lang?: string) => api.post(`/prompts/${type}/reset${langQ(lang)}`),
}

export const skillsAPI = {
  list: (lang?: string) => api.get(`/skills${langQ(lang)}`),
  library: (lang?: string) => api.get(`/skills/library${langQ(lang)}`),
  install: (id: string) => api.post(`/skills/library/${id}`, {}),
  get: (id: string, lang?: string) => api.get(`/skills/${id}${langQ(lang)}`),
  create: (data: { id: string; name: string; description?: string }) => api.post('/skills', data),
  update: (id: string, content: string, lang?: string) => api.put(`/skills/${id}${langQ(lang)}`, { content }),
  del: (id: string) => api.del(`/skills/${id}`),
}

export const stylePresetAPI = {
  list: (all = false) => api.get(`/style-presets${all ? '?all=1' : ''}`),
  create: (d: any) => api.post('/style-presets', d),
  update: (id: number, d: any) => api.put(`/style-presets/${id}`, d),
  del: (id: number) => api.del(`/style-presets/${id}`),
}

export const storageAPI = {
  info: () => api.get('/storage'),
}

export const settingsAPI = {
  contentLanguage: () => api.get<{ language: string }>('/settings/content-language'),
  setContentLanguage: (language: string) => api.put('/settings/content-language', { language }),
}

// 服务器/Docker 部署的版本检查与更新（桌面版走 useDesktopBridge，不用此 API）
export const serverUpdateAPI = {
  state: () => api.get('/server-update/state'),
  check: () => api.post('/server-update/check'),
  apply: () => api.post('/server-update/apply'),
}

// ===== AI Marketer（campaigns）— 契约见 docs/ai-marketer/PLAN.md §4，JSON 为 camelCase =====
export type CampaignStatus = 'draft' | 'researching' | 'research_ready' | 'strategizing' | 'strategy_ready'
  | 'writing' | 'creatives_ready' | 'failed'
export type DocKind = 'product_brief' | 'market_research' | 'audience_insight' | 'message_map' | 'campaign_plan' | 'content_brief'
export type Platform = 'tiktok' | 'reels' | 'youtube_shorts' | 'facebook' | 'shopee' | 'lazada'
export type CreativeFormat = 'ugc' | 'product_demo' | 'problem_solution' | 'before_after' | 'testimonial' | 'unboxing'
export type CampaignAspectRatio = '9:16' | '16:9' | '1:1'

export interface Campaign {
  id: number; title: string
  productUrl: string | null; productName: string; productDescription: string | null
  productImages: string[]
  brandNotes: string | null
  market: string
  platforms: Platform[]; audience: string | null; goal: string | null
  style: string; aspectRatio: CampaignAspectRatio
  status: CampaignStatus; errorMsg: string | null
  dramaId: number | null
  researchNotes: string | null
  budgetThb: number | null
  createdAt: string; updatedAt: string
}
export interface CampaignDoc {
  id: number; campaignId: number; kind: DocKind
  content: string
  status: 'draft' | 'approved'; version: number
  createdAt: string; updatedAt: string
}
export interface Creative {
  id: number; campaignId: number
  angle: string; hook: string; format: CreativeFormat; platform: Platform
  durationSec: number; cta: string | null
  script: string
  status: 'draft' | 'approved' | 'in_production'
  episodeId: number | null; episodeNumber: number | null
  referenceId: number | null
  createdAt: string; updatedAt: string
}
// Phase 3（docs/ai-marketer/PHASE3.md §2）：GET /:id 追加返回 references（新→旧）与 visuals（新→旧）
export type CampaignDetail = Campaign & {
  docs: CampaignDoc[]; creatives: Creative[]
  references: AdReference[]; visuals: CampaignVisual[]
}
export interface CampaignDocRevision { id: number; docId: number; version: number; content: string; source: 'agent' | 'manual'; createdAt: string }
export interface IngestResult { productName: string; productDescription: string; price: string | null; brand: string | null; images: string[] }

// ===== Phase 3 — Recreate Viral Ad + Product Visuals =====
export type AdReferenceStatus = 'draft' | 'analyzed'
export interface AdReference {
  id: number; campaignId: number
  title: string
  sourceUrl: string | null        // 仅存引用，backend 不抓取视频内容
  transcript: string              // 用户粘贴的口播/旁白（必填，≤ 20,000 字符）
  notes: string | null
  analysis: string | null         // agent 产出的 markdown
  status: AdReferenceStatus       // analysis 非空即 analyzed
  createdAt: string; updatedAt: string
}
export type VisualKind = 'packshot' | 'on_model' | 'lifestyle'
export type VisualStatus = 'processing' | 'completed' | 'failed'
export interface CampaignVisual {
  id: number; campaignId: number
  kind: VisualKind
  sourceImage: string             // /static/...，下单时必须是 campaign.productImages 之一
  instruction: string | null
  prompt: string                  // 实际发给模型的 prompt（可展示）
  taskId: number                  // sys_task.id — status/imageUrl/errorMsg 从 sys_task 现读
  status: VisualStatus
  imageUrl: string | null
  errorMsg: string | null
  promoted: boolean               // imageUrl 已进入 campaign.productImages
  createdAt: string; updatedAt: string
}

export const marketerAPI = {
  list: (params?: { status?: CampaignStatus; dramaId?: number }) => {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.dramaId) query.set('drama_id', String(params.dramaId))
    const qs = query.toString()
    return api.get<Campaign[]>(`/campaigns${qs ? `?${qs}` : ''}`)
  },
  create: (data: Partial<Campaign>) => api.post<Campaign>('/campaigns', data),
  get: (id: number) => api.get<CampaignDetail>(`/campaigns/${id}`),
  update: (id: number, data: Partial<Campaign>) => api.put<Campaign>(`/campaigns/${id}`, data),
  del: (id: number) => api.del(`/campaigns/${id}`),
  ingestUrl: (url: string) => api.post<IngestResult>('/campaigns/ingest-url', { url }),
  // 以下三个为异步任务（202），前端轮询 get 直到 status 不再以 -ing 结尾
  research: (id: number, notes?: string) => api.post<{ status: CampaignStatus }>(`/campaigns/${id}/research`, notes ? { notes } : {}),
  strategy: (id: number) => api.post<{ status: CampaignStatus }>(`/campaigns/${id}/strategy`, {}),
  updateDoc: (id: number, docId: number, data: { content?: string; status?: CampaignDoc['status'] }) => api.put<CampaignDoc>(`/campaigns/${id}/docs/${docId}`, data),
  reviseDoc: (id: number, docId: number, instruction: string) => api.post<CampaignDoc>(`/campaigns/${id}/docs/${docId}/revise`, { instruction }),
  docRevisions: (id: number, docId: number) => api.get<CampaignDocRevision[]>(`/campaigns/${id}/docs/${docId}/revisions`),
  restoreDocRevision: (id: number, docId: number, revId: number) => api.post<CampaignDoc>(`/campaigns/${id}/docs/${docId}/revisions/${revId}/restore`, {}),
  // mode: replace（默认，覆盖仍为 draft 的创意）/ append（保留全部，追加 N 条新角度）
  // referenceId: 传了则 ad_scriptwriter 按该 reference 的分析结构写每条 creative，并回填 creative.referenceId
  generateCreatives: (id: number, data: { count: number; formats?: CreativeFormat[]; platforms?: Platform[]; mode?: 'replace' | 'append'; referenceId?: number }) => api.post<{ status: CampaignStatus }>(`/campaigns/${id}/creatives/generate`, data),
  updateCreative: (id: number, cid: number, data: Partial<Creative>) => api.put<Creative>(`/campaigns/${id}/creatives/${cid}`, data),
  deleteCreative: (id: number, cid: number) => api.del(`/campaigns/${id}/creatives/${cid}`),
  produceCreative: (id: number, cid: number) => api.post<{ dramaId: number; episodeNumber: number }>(`/campaigns/${id}/creatives/${cid}/produce`, {}),
  // ===== Phase 3 — 广告参考（Recreate Viral Ad）：analyze 为同步调用 =====
  addReference: (id: number, data: { transcript: string; sourceUrl?: string; title?: string; notes?: string }) =>
    api.post<AdReference>(`/campaigns/${id}/references`, data),
  updateReference: (id: number, refId: number, data: Partial<Pick<AdReference, 'title' | 'sourceUrl' | 'transcript' | 'notes' | 'analysis'>>) =>
    api.put<AdReference>(`/campaigns/${id}/references/${refId}`, data),
  deleteReference: (id: number, refId: number) => api.del(`/campaigns/${id}/references/${refId}`),
  analyzeReference: (id: number, refId: number) => api.post<AdReference>(`/campaigns/${id}/references/${refId}/analyze`, {}),
  // ===== Phase 3 — 产品视觉：不改 campaign.status，也不触发 E_CAMPAIGN_BUSY；前端 poll GET /:id =====
  generateVisuals: (id: number, data: { kind: VisualKind; sourceImage: string; count?: number; instruction?: string }) =>
    api.post<CampaignVisual[]>(`/campaigns/${id}/visuals/generate`, data),
  deleteVisual: (id: number, vid: number) => api.del(`/campaigns/${id}/visuals/${vid}`),
  promoteVisual: (id: number, vid: number) => api.post<Campaign>(`/campaigns/${id}/visuals/${vid}/promote`, {}),
}

// ===== Product Studio（สตูดิโอสินค้า）— 契约见 docs/product-studio/PLAN.md §4，JSON 为 camelCase =====
export type StudioLanguage = 'th' | 'en' | 'id' | 'vi' | 'ms' | 'fil' | 'zh' | 'ja' | 'ko' | 'es' | 'pt' | 'ar'
export type StudioMarket = 'TH' | 'SG' | 'MY' | 'ID' | 'VN' | 'PH' | 'US' | 'UK' | 'EU' | 'JP' | 'KR' | 'CN' | 'LATAM' | 'MENA' | 'GLOBAL'
export type StudioPlatform = 'tiktok' | 'tiktok_shop' | 'shopee' | 'lazada' | 'facebook' | 'instagram_reels' | 'youtube_shorts' | 'amazon'
export type StudioAspectRatio = '9:16' | '1:1' | '16:9'
export type StudioStatus = 'draft' | 'scripting' | 'script_ready' | 'failed'
export type MediaStatus = 'none' | 'processing' | 'completed' | 'failed'

export interface StudioOptions {
  languages: StudioLanguage[]
  markets: { id: StudioMarket; currency: string; defaultLanguage: StudioLanguage }[]
  platforms: { id: StudioPlatform; defaultAspect: StudioAspectRatio; maxDurationSec: number }[]
}
export interface StudioTemplateBeat { role: string; seconds: number }
export interface StudioTemplate {
  id: string
  category: string
  avatarMode: 'required' | 'optional' | 'hands' | 'none'
  hasDialogue: boolean
  defaultDurationSec: number
  platforms: StudioPlatform[]
  beats: StudioTemplateBeat[]
}
export interface StudioProject {
  id: number; title: string
  productName: string; productUrl: string | null; productDescription: string | null
  productImages: string[]
  templateId: string
  language: StudioLanguage; market: StudioMarket; platform: StudioPlatform; aspectRatio: StudioAspectRatio
  durationSec: number
  avatarId: number | null
  tone: string | null; notes: string | null
  budgetThb: number | null
  aiDisclosure: boolean
  status: StudioStatus; errorMsg: string | null
  dramaId: number | null; episodeId: number | null
  createdAt: string; updatedAt: string
}
export interface StudioShot {
  id: number                    // = storyboard id
  number: number; role: string  // role จาก beats ของเทมเพลต
  durationSec: number
  dialogue: string | null       // ภาษา = project.language; null = ไม่มีเสียงพูด
  visual: string
  onScreenText: string | null
  keyframeUrl: string | null; keyframeStatus: MediaStatus; keyframeError: string | null
  videoUrl: string | null; videoStatus: MediaStatus; videoError: string | null
}
export interface StudioMerge { id: number; status: 'processing' | 'completed' | 'failed'; videoUrl: string | null; errorMsg: string | null; createdAt: string }
export interface StudioAvatar {
  id: number; name: string
  description: string
  locale: StudioMarket | null
  imageUrl: string | null; imageStatus: MediaStatus; imageError: string | null
  createdAt: string; updatedAt: string
}
export type StudioImageKind = 'packshot' | 'lifestyle' | 'on_model' | 'banner'
export interface StudioImage {
  id: number; projectId: number; kind: StudioImageKind; platform: StudioPlatform | null
  sourceImage: string; instruction: string | null; prompt: string
  taskId: number; status: 'processing' | 'completed' | 'failed'
  imageUrl: string | null; errorMsg: string | null; promoted: boolean
  createdAt: string; updatedAt: string
}
export type StudioDetail = StudioProject & {
  shots: StudioShot[]; images: StudioImage[]
  latestMerge: StudioMerge | null; avatar: StudioAvatar | null
}

export const studioAPI = {
  options: () => api.get<StudioOptions>('/studio/options'),
  templates: () => api.get<StudioTemplate[]>('/studio/templates'),
  list: () => api.get<StudioProject[]>('/studio/projects'),
  create: (data: Partial<StudioProject>) => api.post<StudioProject>('/studio/projects', data),
  ingestUrl: (url: string) => api.post<IngestResult>('/studio/ingest-url', { url }),
  get: (id: number) => api.get<StudioDetail>(`/studio/projects/${id}`),
  update: (id: number, data: Partial<StudioProject>) => api.put<StudioProject>(`/studio/projects/${id}`, data),
  del: (id: number) => api.del(`/studio/projects/${id}`),
  // 异步（202）— 前端轮询 get 直到 status 不再是 scripting
  script: (id: number, instruction?: string) => api.post<{ status: StudioStatus }>(`/studio/projects/${id}/script`, instruction ? { instruction } : {}),
  updateShot: (id: number, shotId: number, data: { dialogue?: string | null; visual?: string; onScreenText?: string | null; durationSec?: number }) =>
    api.put<StudioShot>(`/studio/projects/${id}/shots/${shotId}`, data),
  render: (id: number, data: { stage: 'keyframes' | 'videos'; shotIds?: number[] }) => api.post<{ queued: number }>(`/studio/projects/${id}/render`, data),
  merge: (id: number) => api.post<StudioMerge>(`/studio/projects/${id}/merge`, {}),
  generateImages: (id: number, data: { kind: StudioImageKind; sourceImage: string; count?: number; platform?: StudioPlatform; instruction?: string }) =>
    api.post<StudioImage[]>(`/studio/projects/${id}/images/generate`, data),
  deleteImage: (id: number, imageId: number) => api.del(`/studio/projects/${id}/images/${imageId}`),
  promoteImage: (id: number, imageId: number) => api.post<StudioProject>(`/studio/projects/${id}/images/${imageId}/promote`, {}),
  avatars: () => api.get<StudioAvatar[]>('/studio/avatars'),
  createAvatar: (data: { name: string; description: string; locale?: StudioMarket; imageUrl?: string }) => api.post<StudioAvatar>('/studio/avatars', data),
  updateAvatar: (id: number, data: Partial<Pick<StudioAvatar, 'name' | 'description' | 'locale' | 'imageUrl'>>) => api.put<StudioAvatar>(`/studio/avatars/${id}`, data),
  generateAvatarImage: (id: number, instruction?: string) => api.post<StudioAvatar>(`/studio/avatars/${id}/generate-image`, instruction ? { instruction } : {}),
  deleteAvatar: (id: number) => api.del(`/studio/avatars/${id}`),
}
