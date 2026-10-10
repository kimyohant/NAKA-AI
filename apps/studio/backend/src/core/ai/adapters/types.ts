/**
 * 图片生成 Provider Adapter 接口
 */
export interface ImageProviderAdapter {
  /** 厂商标识 */
  provider: string

  /**
   * 构建图片生成请求
   * @param config AI 配置 { baseUrl, apiKey, model }
   * @param record 图片生成记录
   */
  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest

  /**
   * 解析生成响应，判断是同步还是异步
   */
  parseGenerateResponse(result: any): ImageGenResponse

  /**
   * 构建轮询请求
   * @param config AI 配置
   * @param taskId 任务 ID
   */
  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest

  /**
   * 解析轮询响应
   */
  parsePollResponse(result: any): ImagePollResponse

  /**
   * 从响应中提取图片 URL（用于直接下载）
   * 返回 null 表示图片数据是 base64 格式，需要用 extractImageBase64 处理
   */
  extractImageUrl(result: any): string | null

  /**
   * 从响应中提取 base64 图片数据
   * 仅用于 Gemini 等只返回 base64 的厂商
   */
  extractImageBase64(result: any): { data: string; mimeType: string } | null

  /**
   * 可选：发起请求前的异步准备（如先把参考图上传到厂商存储）。
   * 返回的 record 会传给 buildGenerateRequest。
   */
  prepareRecord?(config: AIConfig, record: ImageGenerationRecord): Promise<ImageGenerationRecord>

  /** 可选：提交响应是否属于「厂商忙，稍后重试」（如账号并发上限），是则由任务队列等待后重新提交 */
  isRetryableSubmit?(result: any): boolean
}

/**
 * 视频生成 Provider Adapter 接口
 */

/** 供应商能力声明（additive——未声明的字段视为无限制，行为与旧 provider 完全一致） */
export interface VideoCapabilities {
  /** 单个任务的最短成片秒数（如 H3: 124/24 ≈ 5.17s） */
  minDurationSec?: number
  /** 时长取整步长秒数（如 H3: 17/24 ≈ 0.708s 的 temporal lattice） */
  durationStepSec?: number
  /** 单个任务的最长成片秒数（如 H3: 345/24 ≈ 14.4s） */
  maxDurationSec?: number
  /** 该供应商同一 config 同时进行的提交上限（声明后超出任务在队列中等待） */
  maxConcurrent?: number
  /** 模型自带音频（无需另行配音/TTS） */
  nativeAudio?: boolean
  /** true = 需要公网可访问 URL（PUBLIC_BASE_URL）；false = 适配器自行内联 base64 */
  needsPublicUrls?: boolean
  /** 单个片段的预计渲染秒数（实测参考值，供 UI 估算） */
  estimatedSecondsPerClip?: number
}

/** parsePollResponse 的可选上下文：generation.ts 传入，便于需要 config/taskId 的适配器校验归属 */
export interface VideoPollContext {
  config: AIConfig
  taskId?: string | null
  /** 1-based attempt of the current polling run (generation.ts pollTask) */
  attempt?: number
}

/** parseGenerateResponse 的可选上下文：需要 record（如以 seed 作为轮询标识）的适配器使用 */
export interface VideoSubmitContext {
  config: AIConfig
  record: VideoGenerationRecord
}

export interface VideoProviderAdapter {
  provider: string

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest

  parseGenerateResponse(result: any, ctx?: VideoSubmitContext): VideoGenResponse

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest

  parsePollResponse(result: any, ctx?: VideoPollContext): VideoPollResponse

  extractVideoUrl(result: any): string | null

  /** 可选：能力声明（maxConcurrent 触发 generation.ts 的每 config 队列） */
  capabilities?: VideoCapabilities

  /** 可选：发起请求前的异步准备（如上传首尾帧/参考图），返回的 record 会传给 buildGenerateRequest */
  prepareRecord?(config: AIConfig, record: VideoGenerationRecord): Promise<VideoGenerationRecord>

  /** 可选：提交响应是否属于「厂商忙，稍后重试」，是则由任务队列等待后重新提交 */
  isRetryableSubmit?(result: any): boolean
}

// ============ 通用类型 ============

export interface ProviderRequest {
  url: string
  method: string
  headers: Record<string, string>
  /**
   * 普通请求为可 JSON 序列化的对象（generation.ts 统一 JSON.stringify）；
   * multipart 上传（如 OpenAI /v1/images/edits）直接返回 FormData，
   * 此时 headers 不要设置 Content-Type，边界由 fetch 自动生成。
   */
  body: any
}

export interface AIConfig {
  id?: number
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  /** ai_service_configs.settings JSON 解析结果（provider 专属设置，如 unsloth 的 steps/quality/max_concurrent） */
  settings?: Record<string, any>
}

export interface ImageGenerationRecord {
  id: number
  model?: string | null
  prompt?: string | null
  size?: string | null
  frameType?: string | null
  referenceImages?: string | null
  // ... 其他字段
}

export interface VideoGenerationRecord {
  id: number
  model?: string | null
  prompt?: string | null
  referenceMode?: string | null
  imageUrl?: string | null
  firstFrameUrl?: string | null
  lastFrameUrl?: string | null
  referenceImageUrls?: string | null
  referenceVideoUrls?: string | null
  referenceAudioUrls?: string | null
  referenceFileUrl?: string | null
  referenceLinkUrl?: string | null
  generateAudio?: number | boolean | null
  duration?: number | null
  aspectRatio?: string | null
  resolution?: string | null
  seed?: number | null
  promptExtend?: number | boolean | null
  watermark?: number | boolean | null
  // ... 其他字段
}

export interface ImageGenResponse {
  isAsync: boolean
  taskId?: string
  /** 同步模式下直接返回的图片 URL */
  imageUrl?: string
}

export interface ImagePollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  imageUrl?: string
  error?: string
}

export interface VideoGenResponse {
  isAsync: boolean
  taskId?: string
  videoUrl?: string
}

export interface VideoPollResponse {
  status: 'pending' | 'processing' | 'completed' | 'failed'
  videoUrl?: string
  duration?: number
  error?: string
}
