const BASE = '/api/v1'

/**
 * naka-ai single sign-on: the Studio engine answers 401 E_AUTH_REQUIRED when the member session is missing or
 * expired → sign in at naka-ai.com (backend /auth/naka/login) and come back to the same page.
 */
export function redirectToLogin() {
  if (typeof window === 'undefined' || (window as any).__nakaLoginRedirect) return
  ;(window as any).__nakaLoginRedirect = true
  const next = window.location.pathname + window.location.search
  window.location.href = `${BASE}/auth/naka/login?next=${encodeURIComponent(next)}`
}

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
      if (resp.status === 401 && json.errorCode === 'E_AUTH_REQUIRED') redirectToLogin()
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
    if (resp.status === 401 && json.errorCode === 'E_AUTH_REQUIRED') redirectToLogin()
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
  // Style Gallery — นำเข้าคลังสไตล์เลขที่ 305 แบบ (idempotent — ข้ามสิ่งที่มีอยู่แล้ว)
  importBuiltin: () => api.post<{ imported: number; skipped: number }>('/style-presets/import-builtin', {}),
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
  revising?: boolean              // Phase Unsloth: revise แบบ async กำลังวิ่ง
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
  analyzing?: boolean             // Phase Unsloth: analyze แบบ async กำลังวิ่ง
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
  // Phase Unsloth: { async: true } ⇒ 202 + สถานะผ่าน doc.revising (GET เดิม) — กัน proxy timeout เมื่อโมเดล local บน CPU
  reviseDoc: (id: number, docId: number, instruction: string, asyncMode = true) => api.post<CampaignDoc>(`/campaigns/${id}/docs/${docId}/revise`, { instruction, async: asyncMode }),
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
  analyzeReference: (id: number, refId: number, asyncMode = true) => api.post<AdReference>(`/campaigns/${id}/references/${refId}/analyze`, { async: asyncMode }),
  // ===== Phase 3 — 产品视觉：不改 campaign.status，也不触发 E_CAMPAIGN_BUSY；前端 poll GET /:id =====
  generateVisuals: (id: number, data: { kind: VisualKind; sourceImage: string; count?: number; instruction?: string }) =>
    api.post<CampaignVisual[]>(`/campaigns/${id}/visuals/generate`, data),
  deleteVisual: (id: number, vid: number) => api.del(`/campaigns/${id}/visuals/${vid}`),
  promoteVisual: (id: number, vid: number) => api.post<Campaign>(`/campaigns/${id}/visuals/${vid}/promote`, {}),
}

// ===== Trending Videos (Thailand) — docs/ai-marketer/TRENDING.md §4 (คลัง curated อ่านอย่างเดียว) =====
export type TrendIndustry = 'beauty' | 'food' | 'fashion' | 'gadgets' | 'home' | 'health' | 'pets' | 'other'
export type TrendSort = 'views' | 'revenue' | 'engagement'
export interface TrendBeat { role: 'hook' | 'demo' | 'proof' | 'offer' | 'cta'; line: string; durationSec: number }
export interface TrendVideo {
  id: string; title: string
  industry: TrendIndustry; platform: Platform; hookType: string
  views: number                        // ข้อมูลอ้างอิง ณ curatedAt (ไม่ใช่ real-time)
  estRevenueThb: number | null
  engagementRate: number | null        // 0-1
  durationSec: number
  hashtags: string[]                   // ไม่มี # นำหน้า
  summary: string                      // "ทำไมมันเวิร์ก"
  pattern: { hook: string; beats: TrendBeat[]; cta: string }
  sourceUrl: string | null
}
export interface TrendListResult { entries: TrendVideo[]; industries: TrendIndustry[]; curatedAt: string }

export const trendingAPI = {
  list: (params?: { industry?: TrendIndustry; sort?: TrendSort; q?: string }) => {
    const query = new URLSearchParams()
    if (params?.industry) query.set('industry', params.industry)
    if (params?.sort) query.set('sort', params.sort)
    if (params?.q) query.set('q', params.q)
    const qs = query.toString()
    return api.get<TrendListResult>(`/trending-videos${qs ? `?${qs}` : ''}`)
  },
}

// ===== Creative Gallery & Ad Analytics — docs/ai-marketer/GALLERY.md §3 (manual analytics — ผู้ใช้กรอกเอง) =====
export type CreativeResultStatus = 'approved' | 'in_production'
export interface CreativeResult {
  views: number | null; likes: number | null; comments: number | null; shares: number | null
  salesThb: number | null; postedUrl: string | null; postedAt: string | null
  note: string | null
  engagementRate: number | null     // backend คำนวณ = (likes+comments+shares)/views เมื่อ views > 0
  updatedAt: string
}
export interface GalleryEntry {
  creativeId: number; campaignId: number; campaignTitle: string
  productName: string; productImage: string | null
  dramaId: number | null             // drama ของแคมเปญ — ใช้เข้าหน้า episode ตรง ๆ
  angle: string; hook: string; format: CreativeFormat; platform: Platform
  durationSec: number
  status: CreativeResultStatus
  episodeId: number | null; episodeNumber: number | null
  result: CreativeResult | null
  createdAt: string; updatedAt: string
}
export interface GallerySummary {
  total: number; produced: number; withResults: number
  totalViews: number; totalLikes: number; totalSalesThb: number
}
export type CreativeResultInput = Partial<Omit<CreativeResult, 'engagementRate' | 'updatedAt'>>

export const galleryAPI = {
  list: () => api.get<{ entries: GalleryEntry[]; summary: GallerySummary }>('/gallery'),
  saveResult: (creativeId: number, data: CreativeResultInput) =>
    api.put<CreativeResult>(`/gallery/creatives/${creativeId}/result`, data),
  deleteResult: (creativeId: number) => api.del(`/gallery/creatives/${creativeId}/result`),
}

// ===== Product Studio（สตูดิโอสินค้า）— 契约见 docs/product-studio/PLAN.md §4，JSON 为 camelCase =====
export type StudioLanguage = 'th' | 'en' | 'id' | 'vi' | 'ms' | 'fil' | 'zh' | 'ja' | 'ko' | 'es' | 'pt' | 'ar'
export type StudioMarket = 'TH' | 'SG' | 'MY' | 'ID' | 'VN' | 'PH' | 'US' | 'UK' | 'EU' | 'JP' | 'KR' | 'CN' | 'LATAM' | 'MENA' | 'GLOBAL'
export type StudioPlatform = 'tiktok' | 'tiktok_shop' | 'shopee' | 'lazada' | 'facebook' | 'instagram_reels' | 'youtube_shorts' | 'amazon'
export type StudioAspectRatio = '9:16' | '1:1' | '16:9'
export type StudioStatus = 'draft' | 'scripting' | 'script_ready' | 'failed'
export type MediaStatus = 'none' | 'processing' | 'completed' | 'failed'

export interface StudioVideoProviderInfo {
  provider: string
  minDurationSec?: number
  maxConcurrent?: number
  nativeAudio?: boolean
  estimatedSecondsPerClip?: number
}
export interface StudioOptions {
  languages: StudioLanguage[]
  markets: { id: StudioMarket; currency: string; defaultLanguage: StudioLanguage }[]
  platforms: { id: StudioPlatform; defaultAspect: StudioAspectRatio; maxDurationSec: number }[]
  // Phase Unsloth: ข้อมูลโมเดลวิดีโอที่ active (เช่น H3 local — มีได้ตั้งแต่ backend รองรับ)
  videoProvider?: StudioVideoProviderInfo | null
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
  // v14: AI Influencer — พรีเซนเตอร์ AI ที่ใช้แทน/คู่กับ avatar
  influencerId: number | null
  tone: string | null; notes: string | null
  budgetThb: number | null
  aiDisclosure: boolean
  // Phase 2 (docs/product-studio/PHASE2.md §2)
  captions: boolean
  captionStyle: 'clean' | 'bold' | 'boxed'
  aiLabelBurnIn: boolean
  autoRender: StudioAutoRender
  sourceCampaignId: number | null
  status: StudioStatus; errorMsg: string | null
  dramaId: number | null; episodeId: number | null
  createdAt: string; updatedAt: string
}
export type AutoRenderStage = 'idle' | 'keyframes' | 'videos' | 'merging' | 'done' | 'failed' | 'cancelled'
export interface StudioAutoRender {
  stage: AutoRenderStage
  total: number; done: number; failed: number   // นับช็อตของ stage ปัจจุบัน (merging: total=1)
  errorMsg: string | null                        // รูปแบบ "E_CODE: message"
  startedAt: string | null; finishedAt: string | null
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
  // Phase Unsloth: งานวิดีโอ local ที่รอคิว (provider ที่ประกาศ maxConcurrent)
  videoQueuePosition?: number | null
}
export interface StudioMerge {
  id: number; status: 'processing' | 'completed' | 'failed'; videoUrl: string | null; errorMsg: string | null; createdAt: string
  // Phase 2
  captioned: boolean
  subtitleUrl: string | null   // /static/... ไฟล์ .srt (เมื่อมีบทพูด/ข้อความอย่างน้อย 1 ช็อต)
}
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
  influencer: StudioInfluencer | null
}

// ===== AI Influencer (v14) — คลังพรีเซนเตอร์ AI สำหรับรีวิวสินค้า =====
export type InfluencerReviewScene = 'unboxing' | 'holding' | 'using' | 'closeup' | 'lifestyle'
export interface StudioInfluencer {
  id: number; name: string
  niche: string | null
  persona: string
  appearance: string
  locale: StudioMarket | null
  tone: string | null
  imageUrl: string | null; imageStatus: MediaStatus; imageError: string | null
  createdAt: string; updatedAt: string
}
export interface StudioInfluencerContent {
  id: number; influencerId: number
  kind: 'image' | 'script'
  productName: string
  productImage: string | null
  scene: InfluencerReviewScene | null
  instruction: string | null
  language: StudioLanguage | null
  platform: StudioPlatform | null
  durationSec: number | null
  prompt: string
  taskId: number | null
  script: string | null
  status: MediaStatus
  imageUrl: string | null; errorMsg: string | null
  createdAt: string; updatedAt: string
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
  // Phase 2 — merge: ไม่ส่ง captions = ใช้ค่า project.captions
  merge: (id: number, data: { captions?: boolean } = {}) => api.post<StudioMerge>(`/studio/projects/${id}/merge`, data),
  // Phase 2 — auto-render: server ทำ keyframes → videos → merge จนจบเอง (poll get ทุก 3s ระหว่าง stage วิ่ง)
  autoRender: (id: number, data: { force?: boolean } = {}) => api.post<StudioProject>(`/studio/projects/${id}/auto-render`, data),
  cancelAutoRender: (id: number) => api.post<StudioProject>(`/studio/projects/${id}/auto-render/cancel`, {}),
  // Phase 2 — สร้างโปรเจกต์จากแคมเปญ Marketer (+ creative ที่เลือก)
  fromCampaign: (data: { campaignId: number; creativeId?: number; templateId: string }) => api.post<StudioProject>('/studio/projects/from-campaign', data),
  generateImages: (id: number, data: { kind: StudioImageKind; sourceImage: string; count?: number; platform?: StudioPlatform; instruction?: string }) =>
    api.post<StudioImage[]>(`/studio/projects/${id}/images/generate`, data),
  deleteImage: (id: number, imageId: number) => api.del(`/studio/projects/${id}/images/${imageId}`),
  promoteImage: (id: number, imageId: number) => api.post<StudioProject>(`/studio/projects/${id}/images/${imageId}/promote`, {}),
  avatars: () => api.get<StudioAvatar[]>('/studio/avatars'),
  createAvatar: (data: { name: string; description: string; locale?: StudioMarket; imageUrl?: string }) => api.post<StudioAvatar>('/studio/avatars', data),
  updateAvatar: (id: number, data: Partial<Pick<StudioAvatar, 'name' | 'description' | 'locale' | 'imageUrl'>>) => api.put<StudioAvatar>(`/studio/avatars/${id}`, data),
  generateAvatarImage: (id: number, instruction?: string) => api.post<StudioAvatar>(`/studio/avatars/${id}/generate-image`, instruction ? { instruction } : {}),
  deleteAvatar: (id: number) => api.del(`/studio/avatars/${id}`),
  // AI Influencer (v14)
  influencers: () => api.get<StudioInfluencer[]>('/studio/influencers'),
  createInfluencer: (data: { name: string; niche?: string; persona?: string; appearance?: string; locale?: StudioMarket; tone?: string; imageUrl?: string }) =>
    api.post<StudioInfluencer>('/studio/influencers', data),
  updateInfluencer: (id: number, data: Partial<Pick<StudioInfluencer, 'name' | 'niche' | 'persona' | 'appearance' | 'locale' | 'tone' | 'imageUrl'>>) =>
    api.put<StudioInfluencer>(`/studio/influencers/${id}`, data),
  deleteInfluencer: (id: number) => api.del(`/studio/influencers/${id}`),
  generateInfluencerImage: (id: number, instruction?: string) => api.post<StudioInfluencer>(`/studio/influencers/${id}/generate-image`, instruction ? { instruction } : {}),
  influencerContents: (id: number) => api.get<StudioInfluencerContent[]>(`/studio/influencers/${id}/contents`),
  generateInfluencerReviewImages: (id: number, data: { productName: string; productImage: string; scenes?: InfluencerReviewScene[]; count?: number; aspectRatio?: string; instruction?: string }) =>
    api.post<StudioInfluencerContent[]>(`/studio/influencers/${id}/contents/images`, data),
  generateInfluencerScript: (id: number, data: { productName: string; productDescription?: string; language?: StudioLanguage; platform?: StudioPlatform; durationSec?: number; instruction?: string }) =>
    api.post<StudioInfluencerContent>(`/studio/influencers/${id}/contents/script`, data),
  deleteInfluencerContent: (id: number, contentId: number) => api.del(`/studio/influencers/${id}/contents/${contentId}`),
}

// ===== Viral Clone Studio (สตูดิโอโคลนไวรัล) — สัญญา docs/viral-clone/PLAN.md §3, JSON camelCase =====
export type CloneProjectStatus = 'draft' | 'analyzing' | 'ready' | 'error'
export type CloneVariantStatus = 'draft' | 'queued' | 'rendering' | 'completed' | 'failed'
export type CloneRenderEngine = 'naka' | 'hypit'   // naka = ffmpeg merge + ซับ ASS · hypit = Hypit/HyperFrames (study/hypit)
export type CloneBeatRole = 'hook' | 'demo' | 'proof' | 'offer' | 'cta'
export type CloneBeatVisual = 'product' | 'avatar' | 'broll' | 'text'

export interface CloneBeat {
  id: string
  role: CloneBeatRole
  line: string                  // ข้อความพูด/ซับ — beats ยึดกับคำพูด ไม่ใช่วินาที
  visual: CloneBeatVisual
  visualHint: string | null     // คำอธิบายภาพ (เช่น B-roll อะไร)
  durationSec: number
}
export interface CloneBlueprint {
  title?: string
  durationSec?: number
  beats: CloneBeat[]
  hooks?: string[]              // hook สำรอง — แทน line ของ beat แรก (role hook) เมื่อ variant เลือก hookIndex
  captionStyle?: Record<string, unknown>
}
export interface CloneVariantOverrides {
  hookIndex?: number | null     // ดัชนีใน blueprint.hooks (null = ใช้ hook เดิม)
  productId?: number | null     // StudioProject.id
  avatarId?: number | null      // StudioAvatar.id
  language?: StudioLanguage | null
}
export interface CloneVariant {
  id: number; projectId: number; label: string
  overrides: CloneVariantOverrides
  status: CloneVariantStatus
  outputPath: string | null     // /static/... เล่น/ดาวน์โหลดตรง ๆ
  durationSec: number | null
  errorCode: string | null
  errorMsg: string | null       // รูปแบบ "E_CODE: message"
  pipelineTaskId: number | null
  queuePosition?: number | null
  episodeId?: number | null      // drama/episode ที่ backend สร้างให้ตัวแปรนี้ (เผื่อเชื่อมภายหลัง)
  createdAt: string; updatedAt: string
}
export interface CloneProject {
  id: number; name: string
  status: CloneProjectStatus
  referencePath: string | null  // /static/... คลิปต้นแบบ (ผู้ใช้อัปโหลดเอง — ระบบไม่ดึงจากแพลตฟอร์ม)
  transcript: string
  language: StudioLanguage
  renderEngine: CloneRenderEngine
  blueprint: CloneBlueprint | null
  errorCode: string | null; errorMsg: string | null
  createdAt: string; updatedAt: string
}
export type CloneDetail = CloneProject & { variants: CloneVariant[] }
export interface CloneOverview {
  stats: { projects: number; variants: number; completed: number; busy: number; failed: number; renderedSec: number }
  perProject: Record<number, { total: number; completed: number; busy: number; failed: number; latestOutput: string | null }>
  recent: Array<{ id: number; projectId: number; projectName: string; label: string; outputPath: string | null; durationSec: number | null; updatedAt: string }>
  hypit: { available: boolean; reason: string | null }
}
export interface CloneMatrix { hookIndexes: number[]; productIds: number[]; avatarIds: number[]; languages: StudioLanguage[] }

export const cloneAPI = {
  list: () => api.get<CloneProject[]>('/clone/projects'),
  create: (data: { name: string; transcript: string; language?: StudioLanguage; referencePath?: string | null }) => api.post<CloneProject>('/clone/projects', data),
  get: (id: number) => api.get<CloneDetail>(`/clone/projects/${id}`),
  update: (id: number, data: Partial<Pick<CloneProject, 'name' | 'transcript' | 'language' | 'renderEngine'>>) => api.put<CloneProject>(`/clone/projects/${id}`, data),
  // async (202) — poll get จน status ไม่ใช่ analyzing
  analyze: (id: number, asyncMode = true) => api.post<CloneProject>(`/clone/projects/${id}/analyze`, { async: asyncMode }),
  saveBlueprint: (id: number, blueprint: CloneBlueprint) => api.put<CloneProject>(`/clone/projects/${id}/blueprint`, { blueprint }),
  createVariants: (id: number, matrix: CloneMatrix) => api.post<CloneVariant[]>(`/clone/projects/${id}/variants`, { matrix }),
  renderVariant: (variantId: number, asyncMode = true) => api.post<CloneVariant>(`/clone/variants/${variantId}/render`, { async: asyncMode }),
  renderAll: (id: number, asyncMode = true) => api.post<{ queued: number }>(`/clone/projects/${id}/render-all`, { async: asyncMode }),
  del: (id: number) => api.del(`/clone/projects/${id}`),
  delVariant: (variantId: number) => api.del(`/clone/variants/${variantId}`),
  hypitStatus: () => api.get<{ available: boolean; reason: string | null }>('/clone/hypit/status'),
  overview: () => api.get<CloneOverview>('/clone/overview'),
}

// ---------- AI Live (backend /api/v1/live → naka-live-agent on the GPU box; docs/ai-live/PLAN.md) ----------
export interface LiveConfig {
  agentUrl: string
  avatarId: string
  voice: string
  hasToken: boolean
  hasRtmpUrl: boolean
  rtmpHost: string
  configured: boolean
  tiktokUsername: string
  hasTiktokSignKey: boolean
}
export interface LiveAgentHealth {
  livetalking: { running: boolean; since: number | null; avatar: string | null; voice: string | null; model: string | null }
  push: { running: boolean; since: number | null }
  gpu: { name: string; used_mb: number; total_mb: number; free_mb: number; util: number } | null
  avatars: string[]
  models_ready: boolean
}
export interface LiveStatus { config: LiveConfig; online: boolean; agent: LiveAgentHealth | null; error?: string }
export interface LiveAvatarJob {
  avatarId: string
  source: 'photo' | 'video'
  stage: 'video' | 'upload' | 'building' | 'done' | 'failed'
  error: string | null
  videoTaskId: number | null
  startedAt: number
  finishedAt: number | null
}
export type TikTokEventKind ='chat' | 'gift' | 'follow' | 'share' | 'member' | 'system'
export interface TikTokEvent {
  id: number
  at: number
  kind: TikTokEventKind
  user?: { uniqueId: string; nickname: string }
  text?: string
  gift?: { name: string; count: number; diamonds: number }
}
export interface TikTokStatus {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'ended' | 'error'
  username: string
  error: string
  connectedAt: number | null
  viewers: number
  totalLikes: number
  lastEventId: number
}
export interface LiveProductInput { name: string; details?: string; price?: string; promo?: string; shop?: string }

export const liveAPI = {
  config: () => api.get<LiveConfig>('/live/config'),
  // token / rtmpUrl: '' keeps the stored value, null clears it (they are never sent back)
  saveConfig: (data: { agentUrl?: string; token?: string | null; avatarId?: string; voice?: string; rtmpUrl?: string | null; tiktokUsername?: string; tiktokSignApiKey?: string | null }) => api.put<LiveConfig>('/live/config', data),
  status: () => api.get<LiveStatus>('/live/status'),
  start: (data: { avatarId?: string; voice?: string } = {}) => api.post<{ ready: boolean }>('/live/start', data),
  stop: () => api.post('/live/stop', {}),
  say: (text: string, interrupt = false) => api.post('/live/say', { text, interrupt }),
  interrupt: () => api.post('/live/interrupt', {}),
  speaking: () => api.get<{ speaking: boolean }>('/live/speaking'),
  pushStart: () => api.post('/live/push/start', {}),
  pushStop: () => api.post('/live/push/stop', {}),
  freeGpu: () => api.post<Array<{ server: string; image: number | string; video: number | string }>>('/live/free-gpu', {}),
  script: (product: LiveProductInput, opts: { tone?: string; minutes?: number } = {}) => api.post<{ lines: string[] }>('/live/script', { product, ...opts }),
  answer: (data: { comment: string; viewer?: string; product: LiveProductInput; faq?: string }) =>
    api.post<{ reply: string | null; handoff: boolean; reason: string }>('/live/answer', data),
  // new avatar from the user's own photo (AI idle video first) or video; upload with uploadAPI first
  createAvatar: (data: { name: string; source: 'photo' | 'video'; path: string; consent: boolean }) => api.post<LiveAvatarJob>('/live/avatars', data),
  avatarJobs: () => api.get<LiveAvatarJob[]>('/live/avatars/jobs'),
  // TikTok LIVE comments (unofficial tiktok-live-connector on the backend)
  tiktokConnect: (username?: string) => api.post<TikTokStatus>('/live/tiktok/connect', username ? { username } : {}),
  tiktokDisconnect: () => api.post<TikTokStatus>('/live/tiktok/disconnect', {}),
  tiktokEvents: (after: number) => api.get<TikTokStatus & { events: TikTokEvent[] }>(`/live/tiktok/events?after=${after}`),
  /** WHEP preview: raw SDP in, raw SDP out (not the JSON envelope) */
  async whep(offer: string): Promise<string> {
    const resp = await fetch(`${BASE}/live/whep`, { method: 'POST', headers: { 'Content-Type': 'application/sdp' }, body: offer })
    const text = await resp.text()
    if (!resp.ok) {
      let msg = text
      try { msg = JSON.parse(text).message || text } catch { /* raw */ }
      throw Object.assign(new Error(msg), { status: resp.status })
    }
    return text
  },
}

// ===== AI นักขาย (docs/ai-seller/PLAN.md) =====
export type SellerChannel = 'tiktok' | 'shopee' | 'facebook' | 'instagram'
export type SellerTone = 'casual' | 'fun' | 'pro' | 'urgent'
export interface SellerChannelContent { caption: string; hashtags: string[]; comment: string }
export interface SellerPost {
  id: number; title: string
  productName: string; productUrl: string | null; productPrice: string | null; productDescription: string | null
  productImages: string[]
  affiliateUrl: string | null
  videoUrl: string | null; studioProjectId: number | null
  channels: SellerChannel[]; language: 'th' | 'en'; tone: SellerTone; notes: string | null
  content: Partial<Record<SellerChannel, SellerChannelContent>>
  /** ข้อความพร้อมคัดลอก: post = แคปชั่น + แฮชแท็ก, comment = คอมเมนต์ + ลิงก์ (backend ประกอบ) */
  ready: Partial<Record<SellerChannel, { post: string; comment: string }>>
  status: 'draft' | 'ready' | 'failed'; errorMsg: string | null
  generatedAt: string | null; createdAt: string; updatedAt: string
  /** v19: วิดีโอที่ทำจากคลังสกิล (null = ไม่ได้ทำจากสกิล) */
  videoJob: SellerVideoJob | null
}
export type SellerVideoStage = 'scripting' | 'keyframes' | 'videos' | 'merging' | 'done' | 'failed' | 'cancelled'
export interface SellerVideoJob {
  projectId: number; templateId: string
  running: boolean; stage: SellerVideoStage
  done: number; failed: number; total: number
  /** "E_CODE: message" เมื่อไม่สำเร็จ */
  error: string | null
}
export interface SellerStudioVideo {
  projectId: number; title: string; productName: string; productUrl: string | null; productDescription: string | null
  productImages: string[]; videoUrl: string; createdAt: string
}
export interface SellerOptions { channels: SellerChannel[]; tones: SellerTone[]; languages: string[]; hashtagLimits: Record<SellerChannel, number> }

export const sellerAPI = {
  options: () => api.get<SellerOptions>('/seller/options'),
  list: () => api.get<SellerPost[]>('/seller/posts'),
  create: (data: Partial<SellerPost>) => api.post<SellerPost>('/seller/posts', data),
  get: (id: number) => api.get<SellerPost>(`/seller/posts/${id}`),
  update: (id: number, data: Partial<SellerPost>) => api.put<SellerPost>(`/seller/posts/${id}`, data),
  del: (id: number) => api.del(`/seller/posts/${id}`),
  generate: (id: number, data: { channels?: SellerChannel[]; tone?: SellerTone; language?: string; notes?: string | null } = {}) =>
    api.post<SellerPost>(`/seller/posts/${id}/generate`, data),
  // คลังสกิล → วิดีโอ (202): ระบบเขียนบท → สร้างภาพ/วิดีโอ → รวมคลิป แล้วแนบเข้าโพสต์เอง — poll get ระหว่าง videoJob.running
  makeVideo: (id: number, data: { templateId: string; avatarId?: number | null; influencerId?: number | null }) =>
    api.post<SellerPost>(`/seller/posts/${id}/video`, data),
  stopVideo: (id: number) => api.post<SellerPost>(`/seller/posts/${id}/video/stop`, {}),
  ingestUrl: (url: string) => api.post<IngestResult>('/seller/ingest-url', { url }),
  studioVideos: () => api.get<SellerStudioVideo[]>('/seller/studio-videos'),
}

// ===== บัญชีผู้ใช้ (naka-ai SSO) =====
export interface StudioUser { id: string; name: string; email: string | null; admin: boolean }
export interface StudioFeature { key: string; label: string; quotaUnit: string | null; enabled: boolean; monthlyLimit: number | null; used: number }
/** features: the studio menus/quotas of the member's plan; null = everything (admin, single-user mode) */
export interface StudioSession { user: StudioUser; sso: boolean; accountUrl: string | null; features: StudioFeature[] | null }
export const authAPI = {
  me: () => api.get<StudioSession>('/auth/naka/me'),
  logout: () => api.post<{ loggedOut: boolean; accountUrl: string | null }>('/auth/naka/logout', {}),
}
