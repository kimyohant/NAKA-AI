/**
 * AI Live — สร้างอวตารใหม่จากรูปหรือวิดีโอของผู้ใช้ (docs/ai-live/PLAN.md §Avatars)
 *
 *   photo ─ generateVideo (โมเดลวิดีโอที่เปิดใช้อยู่ เช่น MiniMax H3 บน Unsloth; ท่านิ่งธรรมชาติ ปิดปาก ~10 s)
 *         ─┐
 *   video ──┴─ ส่งไฟล์ให้ naka-live-agent POST /avatars → genavatar.py (wav2lip 256) → poll /avatars/tasks/<id>
 *
 * LiveTalking วนเฟรมแบบไป-กลับ (mirror_index) เอง คลิปสั้น ๆ จึงเล่นต่อเนื่องได้ไม่สะดุด
 * งานเก็บในหน่วยความจำ (รีสตาร์ต backend แล้วหาย แต่อวตารที่สร้างเสร็จอยู่บนเครื่อง GPU ถาวร)
 */
import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../core/db/index.js'
import { AppError } from '../core/http/response.js'
import { getAbsolutePath, readImageAsCompressedDataUrl } from '../core/utils/storage.js'
import { generateVideo } from '../core/generation/generation.js'
import { agentJson, freeUnslothGpu, liveStatus } from './ai-live.js'

export type AvatarJobStage = 'video' | 'upload' | 'building' | 'done' | 'failed'
export interface AvatarJob {
  avatarId: string
  source: 'photo' | 'video'
  stage: AvatarJobStage
  error: string | null
  videoTaskId: number | null
  startedAt: number
  finishedAt: number | null
}

const AVATAR_ID_RE = /^[a-z0-9][a-z0-9_-]{2,40}$/
const MAX_VIDEO_BYTES = 300 * 1024 * 1024
const jobs = new Map<string, AvatarJob>()

/** idle "live host" motion the avatar loops while LiveTalking lip-syncs the mouth */
export const IDLE_PROMPT = 'The same person from the first frame, facing the camera like a friendly live-stream host: gentle breathing, natural blinking, a very slight head movement and a small warm smile. '
  + 'Mouth closed the whole time, not talking. Hands and body still, steady camera, same framing, same background and lighting. Photorealistic, no text.'

// ---- seams for tests ----
type VideoMaker = (firstFrameDataUrl: string) => Promise<string> // → stored path "static/…"
let makeVideo: VideoMaker = defaultMakeVideo
export function __setVideoMaker(f: VideoMaker | null) { makeVideo = f || defaultMakeVideo }
let pollMs = 5000
export function __setPollMs(ms: number) { pollMs = ms }

async function defaultMakeVideo(firstFrameDataUrl: string): Promise<string> {
  // a data URL works for every provider (the Unsloth H3 adapter accepts only data/http URLs)
  const taskId = await generateVideo({ prompt: IDLE_PROMPT, referenceMode: 'reference', firstFrameUrl: firstFrameDataUrl, generateAudio: false, duration: 10, aspectRatio: '9:16' })
  for (;;) {
    const row = db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId)).get()
    if (!row) throw new Error('video task disappeared')
    if (row.status === 'completed' && row.localPath) return row.localPath
    if (row.status === 'failed' || row.status === 'unknown') throw new Error(row.errorMsg || 'video generation failed')
    await new Promise(r => setTimeout(r, pollMs))
  }
}

export function listAvatarJobs(): AvatarJob[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt)
}

/** stored upload path ("static/uploads/x.png" or "/static/…") → absolute file inside STORAGE_ROOT */
function storedFile(p: unknown): string {
  const rel = String(p || '').replace(/^\/+/, '')
  if (!rel.startsWith('static/') || rel.includes('..')) throw new AppError('ไฟล์ไม่ถูกต้อง (ต้องอัปโหลดผ่าน Studio ก่อน)', 'E_AVATAR_FILE')
  const abs = getAbsolutePath(rel)
  if (!fs.existsSync(abs)) throw new AppError('ไม่พบไฟล์ที่อัปโหลด', 'E_AVATAR_FILE')
  return abs
}

export async function createAvatar(input: { name?: unknown; source?: unknown; path?: unknown; consent?: unknown }) {
  const avatarId = String(input.name || '').trim().toLowerCase()
  if (!AVATAR_ID_RE.test(avatarId)) throw new AppError('ชื่ออวตารใช้ a-z 0-9 _ - ยาว 3-41 ตัว เช่น naka_host_ann', 'E_AVATAR_NAME')
  const source = input.source === 'photo' ? 'photo' : input.source === 'video' ? 'video' : null
  if (!source) throw new AppError('source ต้องเป็น photo หรือ video', 'E_AVATAR_SOURCE')
  if (input.consent !== true) throw new AppError('ต้องยืนยันว่าเป็นหน้าของคุณเองหรือได้รับอนุญาตแล้ว', 'E_AVATAR_CONSENT')
  const running = jobs.get(avatarId)
  if (running && !['done', 'failed'].includes(running.stage)) throw new AppError('อวตารชื่อนี้กำลังสร้างอยู่', 'E_AVATAR_BUSY')
  const file = storedFile(input.path)

  const st = await liveStatus()
  if (!st.online) throw new AppError('ติดต่อเครื่อง AI Live ไม่ได้', 'E_LIVE_UNREACHABLE')
  if (st.agent?.avatars?.includes(avatarId)) throw new AppError(`มีอวตารชื่อ ${avatarId} แล้ว`, 'E_AVATAR_EXISTS')
  // an AI video needs the whole GPU; the running avatar would hold ~6 GB of it
  if (source === 'photo' && st.agent?.livetalking.running) throw new AppError('หยุดอวตารก่อน เพราะการสร้างวิดีโอจากรูปต้องใช้การ์ดจอทั้งใบ', 'E_AVATAR_GPU_BUSY')

  const job: AvatarJob = { avatarId, source, stage: source === 'photo' ? 'video' : 'upload', error: null, videoTaskId: null, startedAt: Date.now(), finishedAt: null }
  jobs.set(avatarId, job)
  runJob(job, file, String(input.path).replace(/^\/+/, '')).catch(() => { /* recorded on the job */ })
  return job
}

async function runJob(job: AvatarJob, file: string, storedPath: string) {
  try {
    let videoFile = file
    if (job.source === 'photo') {
      const firstFrame = await readImageAsCompressedDataUrl(storedPath, { maxWidth: 1024, maxHeight: 1024, quality: 85 })
      const stored = await makeVideo(firstFrame)
      videoFile = getAbsolutePath(stored)
      // H3 / Qwen-Image stay loaded on the Unsloth GPU after a render; free it for LiveTalking
      await freeUnslothGpu().catch(() => [])
    }
    const size = fs.statSync(videoFile).size
    if (size > MAX_VIDEO_BYTES) throw new Error('วิดีโอใหญ่เกิน 300 MB')
    job.stage = 'upload'
    const form = new FormData()
    form.append('avatar_id', job.avatarId) // the agent reads avatar_id before the file
    form.append('file', new Blob([fs.readFileSync(videoFile)]), path.basename(videoFile))
    await agentJson('/avatars', { form, timeoutMs: 10 * 60_000 })
    job.stage = 'building'
    for (const deadline = Date.now() + 40 * 60_000; Date.now() < deadline;) {
      await new Promise(r => setTimeout(r, pollMs))
      const t = await agentJson(`/avatars/tasks/${job.avatarId}`, { timeoutMs: 15_000 })
      if (t?.status === 'done') { job.stage = 'done'; job.finishedAt = Date.now(); return }
      if (t?.status === 'failed') throw new Error(t.error || 'สร้างอวตารไม่สำเร็จ')
    }
    throw new Error('สร้างอวตารนานเกิน 40 นาที')
  } catch (err: any) {
    job.stage = 'failed'
    job.error = String(err?.message || err).slice(0, 300)
    job.finishedAt = Date.now()
  }
}
