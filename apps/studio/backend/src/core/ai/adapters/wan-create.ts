/**
 * Wan Create（create.wan.video 创作平台）图片 + 视频 Adapter
 *
 * 与阿里云百炼（aliyun, sk- 密钥）不同：这里用的是 Wan 账号「API Key 管理」生成的
 * AccessKey（wan-sk.<keyId>.<secret>），消耗的是 Wan 账号的积分。
 * 协议取自官方 CLI（npm @wan-ai/cli）：
 * - 提交：POST {base}/wanx/api/common/imageGen            → { success, data: taskId }
 * - 轮询：POST {base}/wanx/api/common/v2/taskResult {taskId} → data.status: -1/0 排队, 1 生成中, 2 成功, >2 失败
 * - 结果：data.taskResult[].downloadUrl（无水印）
 * - 参考素材必须先传到 Wan 的 OSS：getPolicy → 表单直传 → generateOssUrl
 * 站点：国际 https://create.wan.video（默认），国内 https://wanx.biz.aliyun.com
 */
import { randomUUID } from 'node:crypto'
import type {
  AIConfig,
  ImageGenerationRecord,
  ImageGenResponse,
  ImagePollResponse,
  ImageProviderAdapter,
  ProviderRequest,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
  VideoProviderAdapter,
} from './types'

const DEFAULT_BASE_URL = 'https://create.wan.video'
const RATIOS: Array<[string, number]> = [['16:9', 16 / 9], ['4:3', 4 / 3], ['1:1', 1], ['3:4', 3 / 4], ['9:16', 9 / 16]]
const MAX_REFERENCE_IMAGES = 9

/** 上传到 Wan OSS 后的素材，作为 elements/baseImage 使用 */
export interface WanUploadedAsset {
  key: string
  url: string
  fileName: string
}

function baseUrl(config: AIConfig): string {
  return (config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, '') || DEFAULT_BASE_URL
}

function headers(config: AIConfig): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${config.apiKey.trim()}`,
    'x-platform': 'cli',
    'User-Agent': 'wan-cli/0.0.3',
  }
}

async function wanCall<T = any>(config: AIConfig, path: string, body: unknown): Promise<T> {
  const resp = await fetch(baseUrl(config) + path, {
    method: 'POST',
    headers: headers(config),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  })
  const json = await resp.json().catch(() => ({})) as any
  if (!resp.ok || json?.success === false) throw new Error(`Wan ${path} 失败：${wanError(json, `HTTP ${resp.status}`)}`)
  return json?.data as T
}

function wanError(json: any, fallback: string): string {
  const code = json?.errorCode || json?.code
  const msg = json?.errorMsg || json?.message || json?.msg
  return [code, msg].filter(Boolean).join(' ') || fallback
}

/** 模型名归一化为 Wan 的 modelVersion（与 CLI 的 N() 一致的常用写法） */
export function wanModelVersion(model: string | null | undefined, fallback: string): string {
  const raw = String(model || '').trim().toLowerCase()
  if (!raw) return fallback
  const v = raw.replace(/^wan[-_]?/, '').replace(/-image/, '').replace(/[-.]/g, '_')
  if (/^3_0/.test(v)) return '3_0'
  if (/^2_7_?flash/.test(v)) return '2_7_flash'
  if (/^2_7/.test(v)) return '2_7'
  if (/^2_6/.test(v)) return '2_6'
  if (/^2_5/.test(v)) return '2_5'
  if (/^2_2_?turbo/.test(v)) return '2_2_turbo'
  if (/^2_2/.test(v)) return '2_2'
  if (/^2_1_?max/.test(v)) return '2_1_max'
  if (/^2_1/.test(v)) return '2_1'
  return fallback
}

/** 1920x1080 / 16:9 → 最接近的 Wan 画幅 */
function nearestRatio(value: string | null | undefined, fallback: string): string {
  const raw = String(value || '').trim().toLowerCase()
  if (!raw) return fallback
  if (raw === 'adaptive') return 'adaptive'
  const m = /^(\d+(?:\.\d+)?)\s*[x*:]\s*(\d+(?:\.\d+)?)$/.exec(raw)
  if (!m) return fallback
  const r = Number(m[1]) / Number(m[2])
  return RATIOS.reduce((best, cur) => (Math.abs(cur[1] - r) < Math.abs(best[1] - r) ? cur : best))[0]
}

function parseList(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()) : []
  } catch {
    return []
  }
}

function promptMeta(prompt: string) {
  return { originPrompt: prompt, orderedKeys: [] as string[], refs: {} as Record<string, unknown> }
}

const EXT_BY_MIME: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp', 'image/bmp': 'bmp' }

/** 读取 dataURL / http(s) 图片为二进制 */
async function loadImage(source: string): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const data = /^data:([^;,]+);base64,(.+)$/s.exec(source)
  if (data) return { mime: data[1], bytes: new Uint8Array(Buffer.from(data[2], 'base64')) }
  if (/^https?:\/\//i.test(source)) {
    const resp = await fetch(source, { signal: AbortSignal.timeout(60_000) })
    if (!resp.ok) throw new Error(`下载参考图失败：HTTP ${resp.status}`)
    const mime = (resp.headers.get('content-type') || 'image/png').split(';')[0].trim()
    return { mime, bytes: new Uint8Array(await resp.arrayBuffer()) }
  }
  throw new Error('Wan Create 参考图需要 dataURL 或 HTTP(S) 地址')
}

/** 上传一张参考图到 Wan OSS：getPolicy → 表单直传 → generateOssUrl */
export async function uploadToWan(config: AIConfig, source: string, taskType: string): Promise<WanUploadedAsset> {
  const { bytes, mime } = await loadImage(source)
  const ext = EXT_BY_MIME[mime] || 'png'
  const fileName = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
  const policy = await wanCall<any>(config, '/wanx/api/oss/getPolicy', { fileName, taskType })
  if (!policy?.host || !policy?.key || !policy?.policy || !policy?.signature) throw new Error('Wan 返回的上传策略不完整')

  const form = new FormData()
  form.append('OSSAccessKeyId', policy.accessid || policy.accessId || '')
  form.append('policy', policy.policy)
  form.append('signature', policy.signature)
  form.append('key', policy.key)
  form.append('dir', policy.dir || '')
  form.append('success_action_status', '200')
  form.append('file', new Blob([bytes], { type: mime }), fileName)
  const up = await fetch(policy.host, { method: 'POST', headers: { 'X-Requested-With': 'XMLHttpRequest' }, body: form, signal: AbortSignal.timeout(120_000) })
  if (!up.ok) throw new Error(`上传参考图到 Wan OSS 失败：HTTP ${up.status}`)

  const url = await wanCall<string>(config, '/wanx/api/oss/generateOssUrl', { key: policy.key, taskType })
  if (!url) throw new Error('Wan generateOssUrl 未返回地址')
  return { key: randomUUID().replace(/-/g, ''), url: String(url), fileName }
}

function imageElement(asset: WanUploadedAsset, title?: string) {
  return {
    type: 'image',
    payload: { key: asset.key, originImage: asset.url, resultImage: asset.url, objOrBg: 'obj', name: asset.fileName, ...(title ? { title } : {}) },
  }
}

/**
 * Wan 账号有同时生成的任务数上限，超出时提交返回 errorCode "blocked"（"Please wait a moment…"）。
 * 这不是内容审核拒绝（同一提示词单独提交可成功），交给任务队列等待后重提。
 */
export function isWanBusy(result: any): boolean {
  if (result?.success !== false) return false
  const code = String(result?.errorCode || result?.code || '').toLowerCase()
  const msg = String(result?.errorMsg || result?.message || '').toLowerCase()
  return code === 'blocked' || /wait a moment|too many|concurren|排队|稍后/.test(msg)
}

function submitRequest(config: AIConfig, body: unknown): ProviderRequest {
  return { url: `${baseUrl(config)}/wanx/api/common/imageGen`, method: 'POST', headers: headers(config), body }
}

function pollRequest(config: AIConfig, taskId: string): ProviderRequest {
  return { url: `${baseUrl(config)}/wanx/api/common/v2/taskResult`, method: 'POST', headers: headers(config), body: { taskId } }
}

function parseSubmit(result: any): { isAsync: true; taskId: string } {
  if (result?.success === false) throw new Error(`Wan 提交失败：${wanError(result, '未知错误')}`)
  const taskId = typeof result?.data === 'string' ? result.data : result?.data?.taskId
  if (!taskId) throw new Error(`Wan 响应缺少 taskId：${wanError(result, JSON.stringify(result).slice(0, 200))}`)
  return { isAsync: true, taskId: String(taskId) }
}

/** 通用轮询解析：返回状态 + 第一个产物地址（优先无水印） */
function parsePoll(result: any, media: 'image' | 'video'): { status: 'pending' | 'processing' | 'completed' | 'failed'; url?: string; error?: string } {
  if (result?.success === false) return { status: 'failed', error: wanError(result, '查询失败') }
  const task = result?.data || {}
  const status = task.status ?? task.taskStatus
  if (status === 2 || status === 'completed') {
    const items = Array.isArray(task.taskResult) ? task.taskResult : task.taskResult ? [task.taskResult] : []
    const first = items[0] || {}
    let url = first.downloadUrl || first.urlWithoutLogo || first.url || first.videoUrl || first.resultUrl
    if (!url) {
      const pattern = media === 'video' ? /https?:\/\/[^"\\]+?\.mp4[^"\\]*/i : /https?:\/\/[^"\\]+?\.(?:png|jpe?g|webp)[^"\\]*/i
      url = JSON.stringify(task).match(pattern)?.[0]
    }
    return url ? { status: 'completed', url: String(url) } : { status: 'failed', error: 'Wan 任务成功但未返回产物地址' }
  }
  if (typeof status === 'number' && status > 2) return { status: 'failed', error: task.errorMsg || task.statusDesc || `Wan 任务失败（status ${status}）` }
  if (status === 'failed') return { status: 'failed', error: task.errorMsg || 'Wan 任务失败' }
  return { status: status === 1 ? 'processing' : 'pending' }
}

// ==================== 图片 ====================

type WanImageRecord = ImageGenerationRecord & { wanUploads?: WanUploadedAsset[] }

export class WanCreateImageAdapter implements ImageProviderAdapter {
  provider = 'wancreate'

  /** 有参考图时先上传到 Wan OSS（图生图保持角色/场景一致） */
  async prepareRecord(config: AIConfig, record: ImageGenerationRecord): Promise<WanImageRecord> {
    const refs = parseList(record.referenceImages).slice(0, MAX_REFERENCE_IMAGES)
    if (!refs.length) return record
    const wanUploads = await Promise.all(refs.map(ref => uploadToWan(config, ref, 'image_to_image')))
    return { ...record, wanUploads }
  }

  buildGenerateRequest(config: AIConfig, record: WanImageRecord): ProviderRequest {
    const prompt = String(record.prompt || '').trim()
    if (!prompt) throw new Error('Wan Create 图片生成需要 prompt')
    const modelVersion = wanModelVersion(record.model || config.model, '2_7_flash')
    const ratio = nearestRatio(record.size, '1:1')
    const uploads = record.wanUploads || []

    if (uploads.length) {
      const elements: Record<string, unknown> = {}
      for (const a of uploads) elements[a.key] = imageElement(a)
      return submitRequest(config, {
        deductMode: 'credit_mode',
        taskType: 'image_to_image',
        taskInput: {
          subType: 'basic',
          modelVersion,
          prompt,
          promptMeta: promptMeta(prompt),
          selectedResolution: '2K',
          generationMode: modelVersion === '2_5' ? 'plain' : 'imaginative',
          reference: { type: 'ref-element', refElementIds: uploads.map(a => a.key) },
          elements,
          ratio,
        },
      })
    }

    return submitRequest(config, {
      deductMode: 'credit_mode',
      taskType: 'text_to_image',
      taskInput: { subType: 'basic', modelVersion, generationMode: 'imaginative', prompt, selectedResolution: '2K', ratio },
    })
  }

  parseGenerateResponse(result: any): ImageGenResponse { return parseSubmit(result) }
  isRetryableSubmit(result: any): boolean { return isWanBusy(result) }
  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest { return pollRequest(config, taskId) }

  parsePollResponse(result: any): ImagePollResponse {
    const r = parsePoll(result, 'image')
    return { status: r.status, imageUrl: r.url, error: r.error }
  }

  extractImageUrl(result: any): string | null { return parsePoll(result, 'image').url || null }
  extractImageBase64(): { data: string; mimeType: string } | null { return null }
}

// ==================== 视频 ====================

type WanVideoRecord = VideoGenerationRecord & {
  wanRefs?: WanUploadedAsset[]
  wanFirst?: WanUploadedAsset
  wanLast?: WanUploadedAsset
}

function clampDuration(value: number | null | undefined, modelVersion: string): number {
  const max = modelVersion === '3_0' ? 30 : 15
  const n = Math.round(Number(value) || 5)
  return Math.min(max, Math.max(2, n))
}

function wanResolution(value: string | null | undefined): string {
  const v = String(value || '').trim().toUpperCase()
  return ['480P', '720P', '1080P'].includes(v) ? v : '720P'
}

export class WanCreateVideoAdapter implements VideoProviderAdapter {
  provider = 'wancreate'

  /** 上传首尾帧 / 参考图到 Wan OSS */
  async prepareRecord(config: AIConfig, record: VideoGenerationRecord): Promise<WanVideoRecord> {
    const refs = parseList(record.referenceImageUrls).slice(0, MAX_REFERENCE_IMAGES)
    if (refs.length) {
      const wanRefs = await Promise.all(refs.map(ref => uploadToWan(config, ref, 'omni_video_generate')))
      return { ...record, wanRefs }
    }
    const first = record.firstFrameUrl || record.imageUrl
    if (first) {
      const [wanFirst, wanLast] = await Promise.all([
        uploadToWan(config, first, 'image_to_video'),
        record.lastFrameUrl ? uploadToWan(config, record.lastFrameUrl, 'image_to_video') : Promise.resolve(undefined),
      ])
      return { ...record, wanFirst, wanLast }
    }
    return record
  }

  buildGenerateRequest(config: AIConfig, record: WanVideoRecord): ProviderRequest {
    const prompt = String(record.prompt || '').trim()
    if (!prompt) throw new Error('Wan Create 视频生成需要 prompt')
    const resolution = wanResolution(record.resolution)
    const audio = record.generateAudio === null || record.generateAudio === undefined ? true : record.generateAudio !== false && record.generateAudio !== 0

    // 多参考图 → Wan 3.0 Omni；提示词里的 @图片N 对应第 N 张参考图（与项目内 @引用约定一致）
    if (record.wanRefs?.length) {
      const titled = record.wanRefs.map((a, i) => ({ ...a, title: `图片${i + 1}` }))
      const elements: Record<string, unknown> = {}
      for (const a of titled) elements[a.key] = imageElement(a, a.title)
      let origin = prompt
      const ordered: Array<{ index: number; key: string }> = []
      for (const a of [...titled].sort((x, y) => y.title.length - x.title.length)) {
        const tag = new RegExp(`@${a.title}(?!\\d)`, 'g')
        for (const m of prompt.matchAll(tag)) if (m.index !== undefined) ordered.push({ index: m.index, key: a.key })
        origin = origin.replace(tag, `@{${a.key}}`)
      }
      ordered.sort((x, y) => x.index - y.index)
      const orderedKeys = ordered.map(o => o.key)
      return submitRequest(config, {
        deductMode: 'credit_mode',
        taskType: 'omni_video_generate',
        taskInput: {
          subType: 'basic',
          modelVersion: '3_0',
          prompt,
          promptMeta: { originPrompt: origin, orderedKeys, refs: Object.fromEntries(orderedKeys.map(k => [k, { type: 'ref-element', payload: { id: k } }])) },
          selectedResolution: resolution,
          ratio: nearestRatio(record.aspectRatio, 'adaptive'),
          duration: clampDuration(record.duration, '3_0'),
          audio,
          reference: { type: 'ref-element', refElementIds: titled.map(a => a.key) },
          elements,
        },
      })
    }

    const modelVersion = wanModelVersion(record.model || config.model, '3_0')
    const isV3 = modelVersion === '3_0'
    const common = {
      modelVersion,
      prompt,
      promptMeta: promptMeta(prompt),
      duration: clampDuration(record.duration, modelVersion),
      selectedResolution: resolution,
      ...(isV3 ? { smartDuration: false, audio } : { generationMode: 'plain' }),
    }

    if (record.wanFirst) {
      const hasTail = !!record.wanLast
      return submitRequest(config, {
        deductMode: 'credit_mode',
        taskType: 'image_to_video',
        taskInput: {
          ...common,
          subType: hasTail && ['2_1', '2_2'].includes(modelVersion) ? 'headtail' : 'basic',
          assistInfo: '{}',
          ratio: nearestRatio(record.aspectRatio, 'adaptive'),
          baseImage: record.wanFirst.url,
          ...(record.wanLast ? { tailImage: record.wanLast.url } : {}),
          ...(!isV3 && !hasTail && ['2_7', '2_6'].includes(modelVersion) ? { multiShots: 'single' } : {}),
        },
      })
    }

    return submitRequest(config, {
      deductMode: 'credit_mode',
      taskType: 'text_to_video',
      taskInput: {
        ...common,
        subType: 'basic',
        ratio: nearestRatio(record.aspectRatio, isV3 ? 'adaptive' : '16:9'),
        ...(['2_7', '2_6'].includes(modelVersion) ? { multiShots: 'single' } : {}),
        modelIds: [],
      },
    })
  }

  parseGenerateResponse(result: any): VideoGenResponse { return parseSubmit(result) }
  isRetryableSubmit(result: any): boolean { return isWanBusy(result) }
  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest { return pollRequest(config, taskId) }

  parsePollResponse(result: any): VideoPollResponse {
    const r = parsePoll(result, 'video')
    return { status: r.status, videoUrl: r.url, error: r.error }
  }

  extractVideoUrl(result: any): string | null { return parsePoll(result, 'video').url || null }
}
