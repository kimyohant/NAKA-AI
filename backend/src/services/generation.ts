/**
 * 统一生成任务服务 — 图片/视频生成共用 sys_task 表与同一条生命周期：
 * 创建(processing) → 适配器构建请求 → 同步完成或异步轮询 → 下载落盘 → 回写业务表
 */
import { db, getInsertId, schema } from '../db/index.js'
import { and, asc, eq } from 'drizzle-orm'
import { getActiveConfig, getConfigById, getConfigForRecovery } from './ai.js'
import { now, AppError } from '../utils/response.js'
import { downloadFile, fetchImageAsCompressedDataUrl, generateImageThumb, readImageAsCompressedDataUrl, saveBase64Image } from '../utils/storage.js'
import { extractVideoPoster } from '../utils/video-poster.js'
import { getImageAdapter, getVideoAdapter, videoAdapters } from './adapters/registry'
import type { AIConfig, ImageGenerationRecord, VideoCapabilities, VideoGenerationRecord } from './adapters/types'
import { logTaskError, logTaskPayload, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn, redactUrl } from '../utils/task-logger.js'
import { taskMediaSlot } from './storyboard-readiness.js'
import { estimateCostThb } from './generation-cost.js'
import { sourceSnapshotForShot } from './source-freshness.js'

type TaskType = 'image' | 'video'

const taskLabel = (type: TaskType) => (type === 'image' ? 'ImageTask' : 'VideoTask')
const activeTasks = new Set<number>()

// ─── 每Config任务队列（仅对声明 capabilities.maxConcurrent 的 provider 生效，如 unsloth = 1） ───
/** taskId → configId：process 已认领的槽位（先于 DB status 变更登记，防止 startTask 期间的竞态多算） */
const slotClaims = new Map<number, number>()
const QUEUE_SWEEP_INTERVAL_MS = 60_000
const DEFAULT_QUEUE_TIMEOUT_MINUTES = 240

function videoCapabilitiesOf(config: AIConfig): VideoCapabilities | null {
  const adapter = videoAdapters[config.provider.toLowerCase()]
  return adapter?.capabilities ?? null
}

/** maxConcurrent：config settings.max_concurrent 优先，回退 capabilities 声明；0 = 不限（旧 provider 行为不变） */
function maxConcurrentFor(config: AIConfig): number {
  const caps = videoCapabilitiesOf(config)
  if (!caps?.maxConcurrent) return 0
  const fromSettings = Number(config.settings?.max_concurrent)
  if (Number.isFinite(fromSettings) && fromSettings >= 1) return Math.floor(fromSettings)
  return caps.maxConcurrent
}

function queueTimeoutMinutesFor(config: AIConfig): number {
  const raw = Number(config.settings?.queue_timeout_minutes)
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_QUEUE_TIMEOUT_MINUTES
}

/** 同一 config 正在占用 provider 的任务数（submitting/processing/unknown + 已认领未落库的槽位） */
function videoSlotsInUse(configId: number): number {
  const rows = db.select({ id: schema.sysTask.id, status: schema.sysTask.status })
    .from(schema.sysTask)
    .where(and(eq(schema.sysTask.type, 'video'), eq(schema.sysTask.configId, configId)))
    .all()
  const ids = new Set<number>()
  for (const row of rows) {
    if (['submitting', 'processing', 'unknown'].includes(row.status || '')) ids.add(row.id)
  }
  for (const [taskId, cfgId] of slotClaims) {
    if (cfgId === configId) ids.add(taskId)
  }
  return ids.size
}

// 轮询节奏：图片 5s×120（上限 10 分钟）；视频 10s×300
/** 提交被厂商以「忙/稍后再试」拒绝时的排队重试：每 15s 一次，最多约 10 分钟 */
const SUBMIT_RETRY_DELAY_MS = 15_000
const SUBMIT_RETRY_MAX = 40

const POLL_PROFILES: Record<TaskType, { attempts: number; intervalMs: number; maxDurationMs: number | null }> = {
  image: { attempts: 120, intervalMs: 5000, maxDurationMs: 600_000 },
  video: { attempts: 300, intervalMs: 10_000, maxDurationMs: null },
}

interface GenerateImageParams {
  storyboardId?: number
  dramaId?: number
  sceneId?: number
  characterId?: number
  propId?: number
  prompt: string
  model?: string
  size?: string
  referenceImages?: string[]
  frameType?: string
  configId?: number
}

interface GenerateVideoParams {
  storyboardId?: number
  dramaId?: number
  prompt: string
  model?: string
  referenceMode?: string
  imageUrl?: string
  firstFrameUrl?: string
  lastFrameUrl?: string
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  referenceFileUrl?: string
  referenceLinkUrl?: string
  generateAudio?: boolean
  duration?: number
  aspectRatio?: string
  resolution?: string
  seed?: number
  promptExtend?: boolean
  watermark?: boolean
  configId?: number
}

export async function generateImage(params: GenerateImageParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置，避免生成被旧引用卡死
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('image')
    : await getActiveConfig('image')
  if (!config) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')

  const id = await createTask('image', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    propId: params.propId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    size: params.size || '1920x1080',
    frameType: params.frameType,
    referenceImages: params.referenceImages,
  })

  logTaskStart('ImageTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    sceneId: params.sceneId,
    characterId: params.characterId,
    frameType: params.frameType,
    model: params.model || config.model,
  })
  logTaskPayload('ImageTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

export async function generateVideo(params: GenerateVideoParams): Promise<number> {
  // 指定配置（集锁定）可能已停用/删除/厂商收敛，失效时回退到当前启用配置
  const config = params.configId
    ? (await getConfigById(params.configId)) ?? await getActiveConfig('video')
    : await getActiveConfig('video')
  if (!config) throw new AppError('未配置视频模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_VIDEO_MODEL')

  const id = await createTask('video', config, {
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    prompt: params.prompt,
    model: params.model || config.model,
  }, {
    referenceMode: params.referenceMode || 'reference',
    imageUrl: params.imageUrl,
    firstFrameUrl: params.firstFrameUrl,
    lastFrameUrl: params.lastFrameUrl,
    referenceImageUrls: params.referenceImageUrls,
    referenceVideoUrls: params.referenceVideoUrls,
    referenceAudioUrls: params.referenceAudioUrls,
    referenceFileUrl: params.referenceFileUrl,
    referenceLinkUrl: params.referenceLinkUrl,
    generateAudio: params.generateAudio === false ? 0 : 1,
    duration: params.duration,
    aspectRatio: params.aspectRatio,
    // 统一存为项目内部格式，各适配器再转换为官方大小写与枚举。
    resolution: normalizeStoredVideoResolution(params.resolution),
    seed: params.seed,
    promptExtend: params.promptExtend,
    watermark: params.watermark,
  })

  logTaskStart('VideoTask', 'enqueue', {
    id,
    provider: config.provider,
    storyboardId: params.storyboardId,
    dramaId: params.dramaId,
    referenceMode: params.referenceMode || 'reference',
    duration: params.duration || 5,
  })
  logTaskPayload('VideoTask', 'enqueue params', {
    id,
    config: { provider: config.provider, model: config.model, baseUrl: config.baseUrl },
    params,
  })
  return id
}

async function createTask(
  type: TaskType,
  config: AIConfig,
  fields: {
    storyboardId?: number
    dramaId?: number
    sceneId?: number
    characterId?: number
    propId?: number
    prompt: string
    model?: string | null
  },
  params: Record<string, unknown>,
): Promise<number> {
  const ts = now()
  const snapshot = type === 'video' && fields.storyboardId ? sourceSnapshotForShot(fields.storyboardId) : null
  const id = db.transaction(tx => {
    const shot = fields.storyboardId
      ? tx.select().from(schema.storyboards).where(eq(schema.storyboards.id, fields.storyboardId)).get()
      : null
    if (fields.storyboardId && !shot) throw new Error('Storyboard not found')
    const episode = shot ? tx.select().from(schema.episodes).where(eq(schema.episodes.id, shot.episodeId)).get() : null
    const character = fields.characterId ? tx.select().from(schema.characters).where(eq(schema.characters.id, fields.characterId)).get() : null
    const scene = fields.sceneId ? tx.select().from(schema.scenes).where(eq(schema.scenes.id, fields.sceneId)).get() : null
    const prop = fields.propId ? tx.select().from(schema.props).where(eq(schema.props.id, fields.propId)).get() : null
    const dramaId = episode?.dramaId || character?.dramaId || scene?.dramaId || prop?.dramaId || fields.dramaId || undefined
    const drama = dramaId ? tx.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId)).get() : null
    const configRow = config.id ? tx.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, config.id)).get() : null
    const estimatedCostThb = estimateCostThb(configRow?.settings || null, type, Number(params.duration))
    if (drama?.budgetThb != null) {
      if (estimatedCostThb === null) throw new Error('Set a price for this AI configuration before generating within a project budget')
      const existing = tx.select().from(schema.sysTask).where(eq(schema.sysTask.dramaId, drama.id)).all()
      const allocated = existing.reduce((sum, task) => sum + (task.estimatedCostThb || 0), 0)
      if (allocated + estimatedCostThb > drama.budgetThb + 0.00001) {
        throw new Error(`Project budget exceeded. Remaining estimate: ฿${Math.max(0, drama.budgetThb - allocated).toFixed(2)}`)
      }
    }
    const res = tx.insert(schema.sysTask).values({
      type,
      ...fields,
      dramaId,
      provider: config.provider,
      configId: config.id,
      params: JSON.stringify(params),
      estimatedCostThb,
      sourceSnapshot: snapshot ? JSON.stringify(snapshot) : null,
      status: 'queued',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    return getInsertId(res)
  })
  startTask(id, config, false)
  return id
}

function startTask(id: number, config: AIConfig, resumePolling: boolean, taskType?: TaskType): boolean {
  if (activeTasks.has(id)) return false
  // 队列门槛：仅 video 且 provider 声明 maxConcurrent 时生效——超出槽位的任务保持 queued（不 submit，不占 poll 时间）
  const maxConcurrent = maxConcurrentFor(config)
  if (maxConcurrent > 0 && !resumePolling) {
    let type = taskType
    if (!type) {
      const [row] = db.select({ type: schema.sysTask.type }).from(schema.sysTask).where(eq(schema.sysTask.id, id)).all()
      type = row?.type as TaskType | undefined
    }
    if (type === 'video' && videoSlotsInUse(config.id ?? 0) >= maxConcurrent) return false
  }
  activeTasks.add(id)
  if (maxConcurrent > 0) slotClaims.set(id, config.id ?? -1)
  const work = resumePolling ? resumePollingTask(id, config) : processTask(id, config)
  void work.catch(async err => {
    logTaskError('SysTask', 'worker-error', { id, error: err?.message })
    console.error(`Generation task ${id} worker failed:`, err)
    try {
      await markUnknown(id, 'Worker stopped unexpectedly; check the provider task before retrying')
    } catch (persistError) {
      console.error(`Could not persist generation task ${id} failure:`, persistError)
    }
  }).finally(() => {
    activeTasks.delete(id)
    slotClaims.delete(id)
  })
  return true
}

async function recoveryConfig(record: SysTaskRecord): Promise<AIConfig | null> {
  if (record.configId) {
    const config = await getConfigForRecovery(record.configId)
    return config?.provider === record.provider ? config : null
  }
  // Older tasks did not persist a config ID. Resume only when the provider match is unique.
  const rows = await db.select().from(schema.aiServiceConfigs)
  const matches = rows.filter(r => r.serviceType === record.type && r.provider === record.provider)
  return matches.length === 1 ? getConfigForRecovery(matches[0].id) : null
}

async function resumePollingTask(id: number, config: AIConfig) {
  const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (record?.taskId) await pollTask(record, config, record.taskId)
}

export async function recoverGenerationTasks(): Promise<{ resumed: number; queued: number; unknown: number }> {
  const rows = await db.select().from(schema.sysTask)
  const counts = { resumed: 0, queued: 0, unknown: 0 }
  for (const record of rows) {
    if (!['queued', 'submitting', 'processing'].includes(record.status || '')) continue
    const config = await recoveryConfig(record)
    if (record.taskId && config) {
      if (startTask(record.id, config, true)) counts.resumed++
    } else if (record.status === 'queued' && config) {
      // งาน queued กลับเข้าคิวเดิม — startTask เริ่มทันทีเมื่อมีสล็อตว่าง ไม่งั้นคงสถานะ queued รอ pump
      counts.queued++
      startTask(record.id, config, false)
    } else {
      await markUnknown(record.id, config ? 'Submission state is uncertain after restart; check provider history before creating a new task' : 'Original provider configuration unavailable; check provider history')
      counts.unknown++
    }
  }
  await pumpVideoQueue()
  return counts
}

let pumpRunning = false

/**
 * คิวต่อ config (provider ที่ประกาศ maxConcurrent): ส่งงาน queued เก่าสุดก่อนเมื่อมีสล็อตว่าง,
 * งานรอเกิน queue_timeout_minutes → failed (E_VIDEO_QUEUE_TIMEOUT)
 */
export async function pumpVideoQueue(): Promise<void> {
  if (pumpRunning) return
  pumpRunning = true
  try {
    const queued = db.select().from(schema.sysTask)
      .where(and(eq(schema.sysTask.type, 'video'), eq(schema.sysTask.status, 'queued')))
      .orderBy(asc(schema.sysTask.createdAt))
      .all()
    for (const record of queued) {
      const config = await recoveryConfig(record)
      if (!config) {
        await markUnknown(record.id, 'Original provider configuration unavailable; check provider history')
        continue
      }
      if (!maxConcurrentFor(config)) continue
      const createdAtMs = Date.parse(record.createdAt || '')
      const waitedMs = Number.isFinite(createdAtMs) ? Date.now() - createdAtMs : 0
      if (waitedMs > queueTimeoutMinutesFor(config) * 60_000) {
        await failTask(
          record.id,
          `E_VIDEO_QUEUE_TIMEOUT: รอคิวของ provider ${config.provider} เกิน ${queueTimeoutMinutesFor(config)} นาที — งานยังไม่ได้ถูกส่งให้ provider (ตรวจงานค้างบนเซิร์ฟเวอร์ หรือเพิ่ม queue_timeout_minutes ใน settings)`,
          'E_VIDEO_QUEUE_TIMEOUT',
        )
        continue
      }
      if (videoSlotsInUse(config.id ?? 0) >= maxConcurrentFor(config)) continue
      startTask(record.id, config, false, 'video')
    }
  } finally {
    pumpRunning = false
  }
}

/** sweep คิวตามเวลา: งานค้าง queued เกิน timeout ต้อง fail แม้ไม่มีงานอื่นจบมา trigger pump */
let queueSweepStarted = false
function ensureQueueSweep() {
  if (queueSweepStarted) return
  queueSweepStarted = true
  const timer = setInterval(() => { void pumpVideoQueue() }, QUEUE_SWEEP_INTERVAL_MS)
  timer.unref?.()
}
ensureQueueSweep()

/** ตำแหน่งคิว (1-based) สำหรับ UI — นับงาน video queued ของ config เดียวกันที่เก่ากว่า/เท่ากัน; null = ไม่อยู่คิว */
export function videoQueuePosition(record: {
  id: number
  type?: string | null
  status?: string | null
  configId?: number | null
  createdAt?: string | null
}): number | null {
  if (!record || record.type !== 'video' || record.status !== 'queued' || !record.configId) return null
  const [configRow] = db.select().from(schema.aiServiceConfigs)
    .where(eq(schema.aiServiceConfigs.id, record.configId))
    .all()
  if (!configRow) return null
  const config = { id: configRow.id, provider: configRow.provider || '', baseUrl: configRow.baseUrl, apiKey: configRow.apiKey, model: '', settings: parseSettingsJson(configRow.settings) }
  if (!maxConcurrentFor(config)) return null
  const queued = db.select({ id: schema.sysTask.id }).from(schema.sysTask)
    .where(and(eq(schema.sysTask.type, 'video'), eq(schema.sysTask.configId, record.configId), eq(schema.sysTask.status, 'queued')))
    .orderBy(asc(schema.sysTask.createdAt))
    .all()
  const index = queued.findIndex(q => q.id === record.id)
  return index >= 0 ? index + 1 : null
}

function parseSettingsJson(raw: string | null): Record<string, any> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export async function resumeGenerationTask(id: number): Promise<'resumed' | 'active' | 'unavailable'> {
  const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (!record?.taskId || !['unknown', 'processing'].includes(record.status || '')) return 'unavailable'
  const config = await recoveryConfig(record)
  if (!config) return 'unavailable'
  await db.update(schema.sysTask).set({ status: 'processing', errorMsg: null, updatedAt: now() }).where(eq(schema.sysTask.id, id))
  return startTask(id, config, true) ? 'resumed' : 'active'
}

function parseTaskParams(raw: string | null | undefined): Record<string, any> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) || {}
  } catch {
    return {}
  }
}

async function processTask(id: number, config: AIConfig) {
  let submitStarted = false
  let providerRejected = false
  let providerErrorCode: string | undefined
  try {
    const [record] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
    if (!record) return
    const type = record.type as TaskType
    const label = taskLabel(type)
    const params = parseTaskParams(record.params)
    logTaskProgress(label, 'build-request', {
      id,
      provider: config.provider,
      storyboardId: record.storyboardId,
      sceneId: record.sceneId,
      characterId: record.characterId,
    })

    let url: string, method: string, headers: Record<string, string>, body: unknown
    let submittedVideoRecord: VideoGenerationRecord | null = null

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const resolvedReferenceImages = await normalizeReferenceImages(params.referenceImages)
      let imageRecord: ImageGenerationRecord = {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        size: params.size,
        frameType: params.frameType,
        referenceImages: resolvedReferenceImages.length ? JSON.stringify(resolvedReferenceImages) : null,
      }
      // 部分厂商（如 Wan Create）需先把参考图上传到自家存储
      if (adapter.prepareRecord) imageRecord = await adapter.prepareRecord(config, imageRecord)
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, imageRecord))
    } else {
      const adapter = getVideoAdapter(config.provider)
      const resolvedImageUrl = await normalizeVideoReferenceUrl(params.imageUrl)
      const resolvedFirstFrameUrl = await normalizeVideoReferenceUrl(params.firstFrameUrl)
      const resolvedLastFrameUrl = await normalizeVideoReferenceUrl(params.lastFrameUrl)
      const resolvedReferenceImageUrls = await normalizeVideoReferenceUrls(params.referenceImageUrls)
      // 参考视频/音频文件较大，不适合 dataURL 内联，需解析为公网可访问 URL
      const resolvedReferenceVideoUrls = resolvePublicMediaUrls(params.referenceVideoUrls, 'video')
      const resolvedReferenceAudioUrls = resolvePublicMediaUrls(params.referenceAudioUrls, 'audio')
      const resolvedReferenceFileUrl = resolvePublicMediaUrl(params.referenceFileUrl, 'file')
      let videoRecord: VideoGenerationRecord = {
        id: record.id,
        model: record.model,
        prompt: record.prompt,
        referenceMode: params.referenceMode,
        imageUrl: resolvedImageUrl,
        firstFrameUrl: resolvedFirstFrameUrl,
        lastFrameUrl: resolvedLastFrameUrl,
        referenceImageUrls: resolvedReferenceImageUrls.length ? JSON.stringify(resolvedReferenceImageUrls) : null,
        referenceVideoUrls: resolvedReferenceVideoUrls.length ? JSON.stringify(resolvedReferenceVideoUrls) : null,
        referenceAudioUrls: resolvedReferenceAudioUrls.length ? JSON.stringify(resolvedReferenceAudioUrls) : null,
        referenceFileUrl: resolvedReferenceFileUrl,
        referenceLinkUrl: params.referenceLinkUrl,
        generateAudio: params.generateAudio,
        duration: params.duration,
        aspectRatio: params.aspectRatio,
        resolution: params.resolution,
        seed: params.seed,
        promptExtend: params.promptExtend,
        watermark: params.watermark,
      }
      if (adapter.prepareRecord) videoRecord = await adapter.prepareRecord(config, videoRecord)
      submittedVideoRecord = videoRecord
      ;({ url, method, headers, body } = adapter.buildGenerateRequest(config, videoRecord))
    }

    logTaskProgress(label, 'request', {
      id,
      provider: config.provider,
      method,
      url: redactUrl(url),
      model: record.model,
    })

    const isMultipart = body instanceof FormData
    logTaskPayload(label, 'request payload', {
      id, method, url, headers,
      // multipart 表单（如 OpenAI /v1/images/edits）无法 JSON 化，记录字段摘要
      body: isMultipart ? `[multipart/form-data: ${[...(body as FormData).keys()].join(', ')}]` : body,
    })

    // 提交：厂商返回「稍后再试」类拒绝（如 Wan 账号并发上限 blocked）时排队重试，而不是直接判任务失败
    const submitAdapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
    let result: any
    for (let attempt = 0; ; attempt++) {
      await db.update(schema.sysTask)
        .set({ status: 'submitting', updatedAt: now() })
        .where(eq(schema.sysTask.id, id))
      submitStarted = true
      const resp = await fetch(url, {
        method,
        headers,
        body: isMultipart ? (body as FormData) : JSON.stringify(body),
        signal: AbortSignal.timeout(600_000),
      })
      if (!resp.ok) {
        // 非 2xx 也让适配器有机会判定为「忙，稍后重试」（如 unsloth 409 = 服务器已有任务在跑）
        const errorBody = await resp.json().catch(() => null)
        if (errorBody && attempt < SUBMIT_RETRY_MAX && submitAdapter.isRetryableSubmit?.(errorBody)) {
          logTaskWarn(label, 'submit-busy-retry', { id, provider: config.provider, attempt: attempt + 1, waitMs: SUBMIT_RETRY_DELAY_MS, httpStatus: resp.status })
          await new Promise(r => setTimeout(r, SUBMIT_RETRY_DELAY_MS))
          continue
        }
        providerRejected = resp.status >= 400 && resp.status < 500
        throw new Error(`Provider HTTP ${resp.status}`)
      }
      result = await resp.json() as any
      providerRejected = result?.success === false
      providerErrorCode = result?.errorCode || result?.code
      logTaskPayload(label, 'response payload', { id, provider: config.provider, result })
      if (!submitAdapter.isRetryableSubmit?.(result) || attempt >= SUBMIT_RETRY_MAX) break
      logTaskWarn(label, 'submit-busy-retry', { id, provider: config.provider, attempt: attempt + 1, waitMs: SUBMIT_RETRY_DELAY_MS })
      await new Promise(r => setTimeout(r, SUBMIT_RETRY_DELAY_MS))
    }

    if (type === 'image') {
      const adapter = getImageAdapter(config.provider)
      const { isAsync, taskId, imageUrl } = adapter.parseGenerateResponse(result)

      if (!isAsync && imageUrl) {
        logTaskProgress(label, 'sync-complete', { id, imageUrl })
        await handleImageComplete(record, imageUrl)
        return
      }

      if (!isAsync && !imageUrl) {
        // 同步模式但无 URL（Gemini 等返回 base64）
        const b64 = adapter.extractImageBase64(result)
        if (b64) {
          logTaskProgress(label, 'sync-base64-complete', { id, mimeType: b64.mimeType })
          await handleImageCompleteBase64(record, b64.data, b64.mimeType)
          return
        }
        throw new Error('No image URL or base64 data in response')
      }

      if (!taskId) throw new Error('Provider accepted generation without a task ID')

      await markPolling(id, taskId)
      await pollTask(record, config, taskId!)
      return
    }

    const adapter = getVideoAdapter(config.provider)
    const { isAsync, taskId, videoUrl } = adapter.parseGenerateResponse(result, { config, record: submittedVideoRecord! })

    if (!isAsync && videoUrl) {
      logTaskProgress(label, 'sync-complete', { id, videoUrl })
      await handleVideoComplete(record, videoUrl, params.duration)
      return
    }

    if (!taskId) throw new Error('Provider accepted generation without a task ID')
    await markPolling(id, taskId)
    await pollTask(record, config, taskId!)
  } catch (err: any) {
    const rawMessage = String(err?.message || err)
    const message = (config.apiKey ? rawMessage.replaceAll(config.apiKey, '[redacted]') : rawMessage).slice(0, 500)
    // 适配器抛出「E_XXX: 前缀」的稳定错误码时（如 E_LOCAL_PROVIDER_UNREACHABLE）落库到 errorCode
    const codeFromMessage = /^\s*([A-Z][A-Z0-9_]{2,})(?:[\s:]|$)/.exec(message)?.[1]
    if (submitStarted && !providerRejected) await markUnknown(id, message, codeFromMessage ?? providerErrorCode)
    else await failTask(id, message, codeFromMessage ?? providerErrorCode)
  }
}

async function markPolling(id: number, taskId: string | undefined) {
  await db.update(schema.sysTask)
    .set({ taskId, status: 'processing', updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  logTaskProgress('SysTask', 'poll-start', { id, taskId })
}

async function failTask(id: number, message: string, code?: string) {
  logTaskError('SysTask', 'failed', { id, error: message })
  await db.update(schema.sysTask)
    .set({ status: 'failed', errorMsg: message, errorCode: code || null, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  void pumpVideoQueue()
}

async function markUnknown(id: number, message: string, code?: string) {
  logTaskWarn('SysTask', 'unknown', { id, error: message, code })
  await db.update(schema.sysTask)
    .set({ status: 'unknown', errorMsg: message.slice(0, 500), errorCode: code || null, updatedAt: now() })
    .where(eq(schema.sysTask.id, id))
  void pumpVideoQueue()
}

type SysTaskRecord = typeof schema.sysTask.$inferSelect

async function pollTask(record: SysTaskRecord, config: AIConfig, taskId: string) {
  const type = record.type as TaskType
  const label = taskLabel(type)
  const profile = POLL_PROFILES[type]
  const adapter = type === 'image' ? getImageAdapter(config.provider) : getVideoAdapter(config.provider)
  const startedAt = Date.now()

  for (let i = 0; i < profile.attempts; i++) {
    if (profile.maxDurationMs && Date.now() - startedAt >= profile.maxDurationMs) {
      await markUnknown(record.id, 'Polling timed out; provider task may still be running')
      return
    }
    await new Promise(r => setTimeout(r, profile.intervalMs))
    try {
      const { url, method, headers, body: pollBody } = adapter.buildPollRequest(config, taskId)
      logTaskProgress(label, 'poll-request', {
        id: record.id,
        taskId,
        provider: config.provider,
        method,
        url: redactUrl(url),
        attempt: i + 1,
      })
      const remainingMs = profile.maxDurationMs
        ? Math.max(1_000, profile.maxDurationMs - (Date.now() - startedAt))
        : 600_000
      const resp = await fetch(url, {
        method,
        headers,
        // 多数厂商用 GET 轮询；Wan Create 需要 POST { taskId }
        body: pollBody === undefined || pollBody === null ? undefined : JSON.stringify(pollBody),
        signal: AbortSignal.timeout(remainingMs),
      })
      if (!resp.ok) continue
      const result = await resp.json() as any

      // 图片/视频 PollResponse 结构不同，这里统一按 any 取值后按 type 分支
      const pollResp: any = type === 'image'
        ? adapter.parsePollResponse(result)
        : adapter.parsePollResponse(result, { config, taskId })

      if (pollResp.status === 'completed') {
        if (type === 'image') {
          if (pollResp.imageUrl) {
            logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, imageUrl: pollResp.imageUrl })
            await handleImageComplete(record, pollResp.imageUrl)
            return
          }
          if (adapter.provider === 'gemini') {
            // Gemini 可能返回 base64
            const b64 = (adapter as ReturnType<typeof getImageAdapter>).extractImageBase64(result)
            if (b64) {
              logTaskSuccess(label, 'poll-base64-complete', { id: record.id, taskId, mimeType: b64.mimeType })
              await handleImageCompleteBase64(record, b64.data, b64.mimeType)
              return
            }
          }
        } else if (pollResp.videoUrl) {
          logTaskSuccess(label, 'poll-complete', { id: record.id, taskId, videoUrl: pollResp.videoUrl })
          await handleVideoComplete(record, pollResp.videoUrl, pollResp.duration)
          return
        }
      }
      if (pollResp.status === 'failed') {
        // 上游明确失败（如内容审核拦截）属终态：立即落库，不重试不等待超时
        const failure = String(pollResp.error || 'Generation failed')
        const code = /^\s*([0-9]{3,}|[A-Z][A-Z0-9_]{2,})(?:\s|$)/.exec(failure)?.[1]
        await failTask(record.id, failure, code)
        return
      }
    } catch (err: any) {
      const exhausted = i === profile.attempts - 1
        || (profile.maxDurationMs != null && Date.now() - startedAt >= profile.maxDurationMs)
      if (exhausted) {
        await markUnknown(record.id, `Polling stopped: ${err.message}`)
        return
      }
      logTaskWarn(label, 'poll-retry', { id: record.id, taskId, attempt: i + 1, error: err.message })
    }
  }
  await markUnknown(record.id, 'Polling attempts exhausted; provider task may still be running')
}

/** ดาวน์โหลดผลจาก provider: URL ที่ต้องยืนยันตัวตน (เช่น gallery ของ unsloth) ใช้ Authorization ของ config เดิมซ้ำ */
async function downloadProviderFile(url: string, subDir: string, record: SysTaskRecord): Promise<string> {
  try {
    return await downloadFile(url, subDir)
  } catch (err: any) {
    if (!/401|403/.test(String(err?.message)) || !record.configId) throw err
    const config = await getConfigForRecovery(record.configId)
    if (!config?.apiKey) throw err
    return downloadFile(url, subDir, { headers: { Authorization: `Bearer ${config.apiKey}` } })
  }
}

async function handleImageComplete(record: SysTaskRecord, imageUrl: string) {
  const localPath = await downloadProviderFile(imageUrl, 'images', record)
  // 列表页缩略图（前端按命名约定推导地址，失败不影响主流程）
  await generateImageThumb(localPath)

  await writeBackImageAssets(record, localPath)
  await db.update(schema.sysTask)
    .set({ resultUrl: imageUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('ImageTask', 'downloaded', { id: record.id, provider: record.provider, localPath })
}

async function handleImageCompleteBase64(record: SysTaskRecord, base64Data: string, mimeType: string) {
  const localPath = await saveBase64Image(base64Data, mimeType, 'images')
  await generateImageThumb(localPath)

  await writeBackImageAssets(record, localPath)
  await db.update(schema.sysTask)
    .set({ localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('ImageTask', 'saved-base64', { id: record.id, provider: record.provider, mimeType, localPath })
}

// 图片完成后回写业务表：分镜(按 frameType)、角色、场景、道具
async function writeBackImageAssets(record: SysTaskRecord, localPath: string) {
  const params = parseTaskParams(record.params)
  if (record.storyboardId) {
    const [selected] = await db.select().from(schema.storyboardMediaSelections)
      .where(and(eq(schema.storyboardMediaSelections.storyboardId, record.storyboardId), eq(schema.storyboardMediaSelections.slot, taskMediaSlot(record))))
    const sbUpdate: Record<string, any> = { updatedAt: now() }
    if (params.frameType === 'first_frame') sbUpdate.firstFrameImage = localPath
    else if (params.frameType === 'last_frame') sbUpdate.lastFrameImage = localPath
    else sbUpdate.composedImage = localPath
    if (!selected) await db.update(schema.storyboards).set(sbUpdate).where(eq(schema.storyboards.id, record.storyboardId))
  }
  if (record.characterId) {
    await db.update(schema.characters).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.characters.id, record.characterId))
  }
  if (record.sceneId) {
    await db.update(schema.scenes).set({ imageUrl: localPath, status: 'completed', updatedAt: now() }).where(eq(schema.scenes.id, record.sceneId))
  }
  if (record.propId) {
    await db.update(schema.props).set({ imageUrl: localPath, updatedAt: now() }).where(eq(schema.props.id, record.propId))
  }
}

async function handleVideoComplete(record: SysTaskRecord, videoUrl: string, duration: number | null | undefined) {
  const localPath = await downloadProviderFile(videoUrl, 'videos', record)
  // 海报帧供列表/封面展示，避免前端为显示首帧缓冲整个视频
  await extractVideoPoster(localPath)
  if (record.storyboardId) {
    const [selected] = await db.select().from(schema.storyboardMediaSelections)
      .where(and(eq(schema.storyboardMediaSelections.storyboardId, record.storyboardId), eq(schema.storyboardMediaSelections.slot, 'video')))
    if (!selected) {
      await db.update(schema.storyboards)
        .set({ videoUrl: localPath, duration: duration || undefined, updatedAt: now() })
        .where(eq(schema.storyboards.id, record.storyboardId))
    }
  }
  await db.update(schema.sysTask)
    .set({ resultUrl: videoUrl, localPath, status: 'completed', completedAt: now(), updatedAt: now() })
    .where(eq(schema.sysTask.id, record.id))

  logTaskSuccess('VideoTask', 'downloaded', { id: record.id, localPath, storyboardId: record.storyboardId, duration })
  // สล็อตของ provider แบบ maxConcurrent ว่าง → ดึงงาน queued ถัดไปเข้าทำงาน
  void pumpVideoQueue()
}

// ─── 参考素材归一化 ───────────────────────────────────────────────

async function normalizeReferenceImages(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []

  const deduped = Array.from(
    new Set(
      refs
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  )

  const normalized = await Promise.all(deduped.map(async (value) => {
    if (value.startsWith('data:image/')) return value
    if (value.startsWith('static/') || value.startsWith('/static/')) {
      const localPath = value.startsWith('/static/') ? value.slice(1) : value
      try {
        return await readImageAsCompressedDataUrl(localPath, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
        return null
      }
    }
    // 远程 URL：下载压缩为 data URL，保证 multipart 上传（OpenAI edits）/ inline_data（Gemini）都可用
    if (/^https?:\/\//.test(value)) {
      try {
        return await fetchImageAsCompressedDataUrl(value, {
          maxWidth: 768,
          maxHeight: 768,
          quality: 68,
        })
      } catch (err) {
        logTaskWarn('ImageTask', 'reference-fetch-failed', { url: value, error: (err as Error).message })
        return null
      }
    }
    return value
  }))

  return normalized.filter((item): item is string => !!item).slice(0, 6)
}

async function normalizeVideoReferenceUrl(value: string | null | undefined): Promise<string | null> {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('data:image/')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const localPath = raw.startsWith('/static/') ? raw.slice(1) : raw
    try {
      return await readImageAsCompressedDataUrl(localPath, {
        maxWidth: 768,
        maxHeight: 768,
        quality: 68,
      })
    } catch (err) {
      logTaskWarn('VideoTask', 'reference-read-failed', { path: localPath, error: (err as Error).message })
      return null
    }
  }
  return raw
}

async function normalizeVideoReferenceUrls(refs: string[] | null | undefined): Promise<string[]> {
  if (!Array.isArray(refs) || !refs.length) return []
  const normalized = await Promise.all(
    Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean))).map((item) => normalizeVideoReferenceUrl(item)),
  )
  return normalized.filter((item): item is string => !!item)
}

/**
 * 将参考视频/音频解析为 Seedance API 可访问的 URL。
 * http(s)/dataURL 直通；本地 static 路径需要 PUBLIC_BASE_URL 拼成公网地址，
 * 未配置时抛出可操作的中文错误（落入 catch 写入 error_msg 供前端展示）。
 */
function resolvePublicMediaUrl(value: string | null | undefined, kind: 'video' | 'audio' | 'file'): string | null {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:')) return raw
  if (raw.startsWith('static/') || raw.startsWith('/static/')) {
    const base = (process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/, '')
    if (!base) {
      const label = kind === 'video' ? '视频' : kind === 'audio' ? '音频' : '文件'
      throw new Error(
        `参考${label}为本地路径 ${raw}，但后端未配置 PUBLIC_BASE_URL，上游视频生成 API 无法访问内网地址。` +
        `请在 backend/.env 配置 PUBLIC_BASE_URL（如 https://your-domain.com）后重试，或改用公网 URL。`,
      )
    }
    const p = raw.startsWith('/') ? raw : `/${raw}`
    return `${base}${p}`
  }
  return raw
}

function resolvePublicMediaUrls(refs: string[] | null | undefined, kind: 'video' | 'audio'): string[] {
  if (!Array.isArray(refs) || !refs.length) return []
  const items = Array.from(new Set(refs.map((item) => String(item || '').trim()).filter(Boolean)))
  return items.map((item) => resolvePublicMediaUrl(item, kind)).filter((item): item is string => !!item)
}

function normalizeStoredVideoResolution(resolution: string | null | undefined): string | undefined {
  const value = String(resolution || '').trim().toLowerCase()
  if (value === '480p' || value === '720p' || value === '1080p') return value
  if (value === '2k') return '2K'
  return undefined
}
