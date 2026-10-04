/**
 * Unsloth Studio (local) 视频生成 Adapter — MiniMax H3 GGUF (docs/unsloth/PLAN.md ข้อ 1/3)
 *
 * เลือกเส้นทาง **native** (`/api/inference/video/*`) ไม่ใช่ OpenAI-style `/v1/videos`:
 * - `/v1/videos` ตาม spec ไม่ระบุ request body และ probe ด้วย body ไม่ครบยืนยันไม่ได้ว่ารับ
 *   first_frame ได้ (handler ตรวจ prompt ก่อนแล้ว early-return) — ใช้จนกว่าจะพิสูจน์ได้ = เสี่ยง
 * - native รับ `first_frame`/`last_frame` (base64/data-URL) ตาม spec, คุม `num_frames` บน
 *   lattice 17k+5 ได้ตรง และ `GET /api/inference/video/generate-progress` คืนผลจบพร้อม
 *   GalleryVideo (มี `seed` + `url`) และ `error` ตอน failed — ผูกผลกับงานด้วย seed ที่เราตั้งเอง
 *   (taskId = seed) จึงไม่มีโอกาสผูกผลผิดงาน แม้มีคนส่งงานคู่ขนานผ่าน UI ของ Unsloth
 * - งานทีละงาน (GPU เดียว) คุมด้วย capabilities.maxConcurrent = 1 → คิวใน generation.ts
 */
import type {
  VideoProviderAdapter,
  ProviderRequest,
  AIConfig,
  VideoGenerationRecord,
  VideoGenResponse,
  VideoPollResponse,
  VideoCapabilities,
  VideoPollContext,
  VideoSubmitContext,
} from './types'
import { joinProviderUrl } from './url'
import { fetchImageAsCompressedDataUrl } from '../../utils/storage.js'

/** MiniMax-H3 temporal lattice: num_frames = 17k + 5 (frame_step/frame_offset มาจาก video/status defaults) */
export const FRAME_STEP = 17
export const FRAME_OFFSET = 5
export const MIN_FRAMES = 124
export const MAX_FRAMES = 345
export const FPS = 24

/** resolution_presets จาก video/status (family minimax-h3) — [width, height] */
const RESOLUTION_PRESETS: [number, number][] = [
  [1344, 768], [1536, 672], [1024, 768], [1024, 1024],
  [768, 1024], [768, 1344], [960, 544], [544, 960],
]

/** GGUF fl2va ที่ดาวน์โหลดไว้แล้วบน server (ผู้ใช้ตั้งทับได้ผ่าน settings.gguf_filename) */
const DEFAULT_GGUF_FILENAME = 'minimax_h3_fl2va_pruned-Q8_0.gguf'
const DEFAULT_REPO = 'unsloth/MiniMax-H3-GGUF'

export interface DurationFrames {
  numFrames: number
  /** true = ค่าที่ส่งเกิน/ต่ำกว่าช่วง lattice และถูก clamp (คลิปจริงจึงสั้น/ยาวกว่าที่ขอ) */
  clamped: boolean
}

/**
 * duration → num_frames: ค่า lattice ที่**ใกล้ที่สุด**กับ duration×24 แล้ว clamp [124, 345]
 * (ตรงชุดเคส 5→124, 6→141, 10→243, 15→345, 20→345+clamp; ทั้ง ceil/floor ล้มเหลวอย่างใดอย่างหนึ่ง)
 */
export function durationToNumFrames(durationSec: number | null | undefined): DurationFrames {
  const target = Math.max(0, Number(durationSec) || 0) * FPS
  const k = Math.round((target - FRAME_OFFSET) / FRAME_STEP)
  const clampedK = Math.min(Math.max(k, Math.ceil((MIN_FRAMES - FRAME_OFFSET) / FRAME_STEP)), Math.floor((MAX_FRAMES - FRAME_OFFSET) / FRAME_STEP))
  const numFrames = clampedK * FRAME_STEP + FRAME_OFFSET
  return { numFrames, clamped: numFrames !== target && (target > MAX_FRAMES || target < MIN_FRAMES) }
}

/**
 * aspect + quality → ขนาดจาก resolution_presets เท่านั้น (server ปฏิเสธขนาดนอก preset)
 * fast = preset พื้นที่เล็กสุดที่ตรง aspect, standard = ใหญ่สุดที่ตรง aspect
 */
export function pickSize(aspectRatio: string | null | undefined, quality: string | null | undefined): { width: number; height: number } {
  const raw = String(aspectRatio || '').trim()
  let ratio: number | null = null
  const m = /^(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)$/.exec(raw)
  if (m) {
    const w = Number(m[1]); const h = Number(m[2])
    if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) ratio = w / h
  }
  const candidates = RESOLUTION_PRESETS.filter(([w, h]) => ratio === null || Math.abs(Math.log((w / h) / ratio)) < 0.02)
  const pool = candidates.length ? candidates : RESOLUTION_PRESETS
  const sorted = [...pool].sort((a, b) => (a[0] * a[1] - b[0] * b[1]) || (a[0] - b[0]))
  const chosen = quality === 'standard' ? sorted[sorted.length - 1] : sorted[0]
  return { width: chosen[0], height: chosen[1] }
}

/** settings ของ config (เติม default ตาม PLAN ข้อ 3) */
export function unslothSettings(config: AIConfig): {
  steps: number
  quality: 'fast' | 'standard'
  maxConcurrent: number
  queueTimeoutMinutes: number
  ggufFilename: string
} {
  const s = (config.settings && typeof config.settings === 'object') ? config.settings : {}
  const stepsRaw = Number(s.steps)
  const steps = Number.isFinite(stepsRaw) && stepsRaw >= 1 ? Math.min(100, Math.round(stepsRaw)) : 20
  const quality = s.quality === 'standard' ? 'standard' : 'fast'
  const maxConcurrentRaw = Number(s.max_concurrent)
  const maxConcurrent = Number.isFinite(maxConcurrentRaw) && maxConcurrentRaw >= 1 ? Math.floor(maxConcurrentRaw) : 1
  const timeoutRaw = Number(s.queue_timeout_minutes)
  const queueTimeoutMinutes = Number.isFinite(timeoutRaw) && timeoutRaw > 0 ? timeoutRaw : 240
  const ggufFilename = typeof s.gguf_filename === 'string' && s.gguf_filename.trim() ? s.gguf_filename.trim() : DEFAULT_GGUF_FILENAME
  return { steps, quality, maxConcurrent, queueTimeoutMinutes, ggufFilename }
}

function bearerHeaders(config: AIConfig, withJson = false): Record<string, string> {
  const headers: Record<string, string> = {}
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`
  if (withJson) headers['Content-Type'] = 'application/json'
  return headers
}

/** seed ระบุตัวตนของงาน: ผู้ใช้ตั้งก็ตามผู้ใช้ ไม่งั้นใช้ sys_task id (ไม่ซ้ำ) — taskId ของ poll ก็คือค่านี้ */
function identitySeed(record: VideoGenerationRecord): number {
  const parsed = Number(record.seed)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : record.id
}

/** ตรวจว่า H3 ไม่รองรับ reference (supports_references=false) — ชัดเจนกว่าปล่อย server โยน error เอง */
function rejectUnsupportedReferences(record: VideoGenerationRecord) {
  const refs = [record.referenceImageUrls, record.referenceVideoUrls, record.referenceAudioUrls, record.referenceFileUrl, record.imageUrl]
  const hasRefs = refs.some(v => {
    if (!v) return false
    if (typeof v !== 'string') return true
    try { return JSON.parse(v).length > 0 } catch { return true }
  })
  if (hasRefs) {
    throw new Error('E_LOCAL_PROVIDER_UNSUPPORTED_REFERENCE: MiniMax-H3 (unsloth) ไม่รองรับ reference images/videos/audios — ใช้ first frame แทน')
  }
}

/**
 * video/status บอกว่าโมเดลที่โหลดอยู่คือตัวที่ config ต้องการไหม (repo ตรง + H3 ต้องเป็น partition fl2va ที่รับ first/last frame)
 * ใช้ร่วมกับปุ่มทดสอบใน Settings
 */
export function isConfiguredVideoModelLoaded(status: any, modelPath: string): boolean {
  if (!status?.loaded || typeof status.repo_id !== 'string') return false
  if (status.repo_id.toLowerCase() !== modelPath.toLowerCase()) return false
  if (/minimax-h3/i.test(modelPath) && status.h3_task && status.h3_task !== 'fl2va') return false
  return true
}

export class UnslothVideoAdapter implements VideoProviderAdapter {
  provider = 'unsloth'

  capabilities: VideoCapabilities = {
    minDurationSec: MIN_FRAMES / FPS,
    durationStepSec: FRAME_STEP / FPS,
    maxDurationSec: MAX_FRAMES / FPS,
    maxConcurrent: 1,
    nativeAudio: true,
    needsPublicUrls: false,
    estimatedSecondsPerClip: 716, // วัดจริง 2026-10-04: 5.17s คลิปที่ 544×960 / 20 steps = 716s (PLAN ข้อ 1)
  }

  /** โมเดลยังไม่ load → load ให้แล้วรอ load-progress (phase ready/error) */
  private async ensureModelLoaded(config: AIConfig) {
    const statusUrl = joinProviderUrl(config.baseUrl, '/api/inference', '/video/status')
    const statusResp = await fetch(statusUrl, { headers: bearerHeaders(config), signal: AbortSignal.timeout(30_000) })
    if (statusResp.status === 401) throw new Error('E_LOCAL_PROVIDER_UNREACHABLE: Unsloth server ปฏิเสธ API key (401)')
    if (!statusResp.ok) throw new Error(`E_LOCAL_PROVIDER_UNREACHABLE: video/status HTTP ${statusResp.status}`)
    const status = await statusResp.json() as any
    const settings = unslothSettings(config)
    const modelPath = config.model || DEFAULT_REPO
    // ต้องเป็นโมเดลที่ตั้งค่าไว้จริง — ผู้ใช้อาจสลับไปโหลดตัวอื่น (เช่น Wan) ผ่าน Unsloth UI;
    // แค่ `loaded` จะทำให้งานไปวิ่งบนโมเดลผิดตัว (ไม่มีเสียง / frame lattice ไม่ตรง)
    if (isConfiguredVideoModelLoaded(status, modelPath)) return

    const loadUrl = joinProviderUrl(config.baseUrl, '/api/inference', '/video/load')
    const loadResp = await fetch(loadUrl, {
      method: 'POST',
      headers: bearerHeaders(config, true),
      body: JSON.stringify({
        model_path: modelPath,
        gguf_filename: settings.ggufFilename,
        h3_task: modelPath.includes('MiniMax-H3') || modelPath.includes('minimax-h3') ? 'fl2va' : undefined,
      }),
      signal: AbortSignal.timeout(120_000),
    })
    if (!loadResp.ok) {
      const text = await loadResp.text().catch(() => '')
      throw new Error(`E_LOCAL_PROVIDER_UNREACHABLE: video/load HTTP ${loadResp.status} ${text.slice(0, 200)}`)
    }

    // 21.4GB จาก disk/หน่วยความจำ — รอได้นาน; load-progress phase: downloading|finalizing|ready|error|null
    const progressUrl = joinProviderUrl(config.baseUrl, '/api/inference', '/video/load-progress')
    const deadline = Date.now() + 30 * 60_000
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 5_000))
      const resp = await fetch(progressUrl, { headers: bearerHeaders(config), signal: AbortSignal.timeout(30_000) })
      if (!resp.ok) continue
      const progress = await resp.json() as any
      if (progress?.phase === 'ready') return
      if (progress?.phase === 'error') throw new Error(`E_LOCAL_MODEL_NOT_LOADED: ${progress.error || 'model load failed'}`)
    }
    throw new Error('E_LOCAL_MODEL_NOT_LOADED: model load timed out after 30 minutes')
  }

  /** first/last frame ต้องเป็น base64/data-URL — remote URL ดาวน์โหลดมาแปลง (ไม่พึ่ง PUBLIC_BASE_URL) */
  private async toDataUrl(value: string | null | undefined, label: string): Promise<string | null> {
    const raw = String(value || '').trim()
    if (!raw) return null
    if (raw.startsWith('data:')) return raw
    if (/^https?:\/\//.test(raw)) {
      // fetchImageAsCompressedDataUrl โยน error เองเมื่อดาวน์โหลดไม่ได้ — error จะถูกบันทึกลง sys_task
      return await fetchImageAsCompressedDataUrl(raw, { maxWidth: 1024, maxHeight: 1024, quality: 80 })
    }
    throw new Error(`E_LOCAL_PROVIDER_UNSUPPORTED_REFERENCE: ${label} frame ต้องเป็น data URL หรือ http(s) URL (ได้: ${raw.slice(0, 80)})`)
  }

  async prepareRecord(config: AIConfig, record: VideoGenerationRecord): Promise<VideoGenerationRecord> {
    rejectUnsupportedReferences(record)
    await this.ensureModelLoaded(config)
    return {
      ...record,
      firstFrameUrl: await this.toDataUrl(record.firstFrameUrl, 'first'),
      lastFrameUrl: await this.toDataUrl(record.lastFrameUrl, 'last'),
    }
  }

  buildGenerateRequest(config: AIConfig, record: VideoGenerationRecord): ProviderRequest {
    const model = record.model || config.model || DEFAULT_REPO
    const prompt = (record.prompt || '').trim()
    if (!prompt) throw new Error('unsloth video generation requires a prompt')

    const settings = unslothSettings(config)
    const { width, height } = pickSize(record.aspectRatio, settings.quality)
    const { numFrames, clamped } = durationToNumFrames(record.duration)
    if (clamped) {
      // ข้อความเตือนอยู่ใน log เท่านั้น — งานยังส่งได้ (เช่น 20s → 14.4s)
      console.warn(`[UnslothVideo] task ${record.id}: requested ${record.duration}s is outside the H3 lattice; using ${numFrames} frames (${(numFrames / FPS).toFixed(2)}s)`)
    }

    const body: any = {
      model,
      prompt,
      width,
      height,
      num_frames: numFrames,
      fps: FPS,
      steps: settings.steps,
      seed: identitySeed(record),
    }
    if (record.firstFrameUrl) body.first_frame = record.firstFrameUrl
    if (record.lastFrameUrl) body.last_frame = record.lastFrameUrl

    return {
      url: joinProviderUrl(config.baseUrl, '/api/inference', '/video/generate'),
      method: 'POST',
      headers: bearerHeaders(config, true),
      body,
    }
  }

  /** {status:"started"} ไม่มี job id → ใช้ seed ที่เราตั้งเป็น taskId สำหรับ poll */
  parseGenerateResponse(result: any, ctx?: VideoSubmitContext): VideoGenResponse {
    if (result?.status === 'started') {
      const seed = ctx ? identitySeed(ctx.record) : null
      return { isAsync: true, taskId: seed !== null ? String(seed) : 'unsloth-native' }
    }
    throw new Error(`Unexpected unsloth generate response: ${JSON.stringify(result)?.slice(0, 200)}`)
  }

  /**
   * 409 = มีงาน render อยู่บน server (GPU เดียว, คนอื่น/Unsloth UI ใช้คิวเดียวกัน) — รอแล้ว submit ใหม่
   * (ร่วมกับ non-ok retry ใน generation.ts; หมด 40 ครั้ง ≈ 10 นาที → งาน fail ตามปกติ)
   */
  isRetryableSubmit(result: any): boolean {
    const text = typeof result === 'string' ? result : (() => { try { return JSON.stringify(result ?? '') } catch { return '' } })()
    return /\b(409|conflict|busy|already|in[- ]?progress|try again)\b/i.test(text)
  }

  buildPollRequest(config: AIConfig, _taskId: string): ProviderRequest {
    // generate-progress เป็นสถานะระดับระบบ (งานเดียวต่อ GPU) — ความถูกต้องของผลยืนยันด้วย seed ที่ parsePollResponse
    return {
      url: joinProviderUrl(config.baseUrl, '/api/inference', '/video/generate-progress'),
      method: 'GET',
      headers: bearerHeaders(config),
      body: undefined,
    }
  }

  parsePollResponse(result: any, ctx?: VideoPollContext): VideoPollResponse {
    const phase = result?.phase
    if (phase === 'failed') {
      return { status: 'failed', error: String(result?.error || 'Video generation failed') }
    }
    if (phase === 'completed' && result?.video) {
      // ผูกผลให้ถูกงาน: seed ของคลิปต้องตรง taskId (seed ที่เราส่งตอน submit)
      const seed = ctx?.taskId ? String(result.video.seed) : null
      if (ctx?.taskId && seed !== String(ctx.taskId)) {
        // งานของคนอื่นจบก่อน (progress เป็นสถานะระดับระบบ) — ยังไม่ใช่ผลของเรา ให้รอต่อ
        return { status: 'pending' }
      }
      const url = String(result.video.url || '')
      if (!url) return { status: 'failed', error: 'Unsloth reported completion without a video URL' }
      const base = (ctx?.config?.baseUrl || '').replace(/\/+$/, '')
      const videoUrl = /^https?:\/\//.test(url) ? url : `${base}${url.startsWith('/') ? '' : '/'}${url}`
      return { status: 'completed', videoUrl, duration: Number(result.video.duration_s) || undefined }
    }
    // active/queued/denoise/export → processing; idle ทั้งที่ยังไม่เห็นผล → รอต่อจนกว่า attempts หมด
    return { status: 'pending' }
  }

  extractVideoUrl(result: any): string | null {
    return result?.video?.url ?? null
  }
}
