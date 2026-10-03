/**
 * Product Studio 服务 — วิดีโอรีวิวสินค้า 1 ชิ้น + เทมเพลต (docs/product-studio/PLAN.md)
 * 1 โปรเจกต์ = 1 drama + episode ที่ระบบสร้างให้ (metadata.studioProjectId) · ช็อต = storyboards เดิม
 * script เป็นงาน async (pipeline_tasks, pattern เดียวกับ Marketer); keyframe/video อ่านสดจาก sys_task
 * ของเดิมที่ reuse: product-ingest (SSRF-safe), generateImage/generateVideo (write-back ลง storyboard),
 * mergeEpisodeVideos, task-prep, product-visuals, budget guard ใน createTask
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { AppError, now } from '../utils/response.js'
import { getActiveConfig } from './ai.js'
import { generateImage, generateVideo } from './generation.js'
import { mergeEpisodeVideos } from './ffmpeg-merge.js'
import { ingestUrl } from './marketer.js'
import { resolveTaskContext, prepareVideoTask } from './task-prep.js'
import { buildVisualPrompt, visualSizeFor } from './product-visuals.js'
import {
  getStudioTemplate, scaleBeats, templateDurationSec, STUDIO_TEMPLATES,
  STUDIO_LANGUAGES, STUDIO_MARKETS, STUDIO_PLATFORMS,
  type StudioLanguage, type StudioMarket, type StudioPlatform, type StudioAspectRatio,
} from './studio-templates.js'
import { buildShotPrompts, clearEpisodeStoryboards, writeStudioShot } from './studio-shots.js'
import { mastra } from '../mastra/index.js'
import { buildStudioRequestContext } from '../agents/context.js'
import { startTask, updateTask } from './pipeline-tasks.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

export const STUDIO_PROJECT_ING_STATUSES = ['scripting']
export const STUDIO_IMAGE_KINDS = ['packshot', 'lifestyle', 'on_model', 'banner'] as const
export type StudioImageKind = typeof STUDIO_IMAGE_KINDS[number]

// ---------- 序列化（camelCase 对外） ----------

type ProjectRow = typeof schema.studioProjects.$inferSelect
type ShotRow = typeof schema.studioShots.$inferSelect
type AvatarRow = typeof schema.studioAvatars.$inferSelect
type ImageRow = typeof schema.studioImages.$inferSelect

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw)
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

function toProjectJson(row: ProjectRow) {
  return {
    id: row.id,
    title: row.title,
    productName: row.productName,
    productUrl: row.productUrl,
    productDescription: row.productDescription,
    productImages: parseJsonArray(row.productImages),
    templateId: row.templateId,
    language: row.language,
    market: row.market,
    platform: row.platform,
    aspectRatio: row.aspectRatio,
    durationSec: row.durationSec,
    avatarId: row.avatarId,
    tone: row.tone,
    notes: row.notes,
    budgetThb: row.budgetThb,
    aiDisclosure: row.aiDisclosure === null ? true : !!row.aiDisclosure,
    status: row.status,
    errorMsg: row.errorMsg,
    dramaId: row.dramaId,
    episodeId: row.episodeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** MediaStatus จาก sys_task ล่าสุดของ storyboard (unknown = หลุดจาก provider → failed) */
function mediaStatusFromTask(taskStatus: string | null | undefined): 'none' | 'processing' | 'completed' | 'failed' {
  if (taskStatus === 'completed') return 'completed'
  if (taskStatus === 'failed' || taskStatus === 'unknown') return 'failed'
  if (taskStatus === null || taskStatus === undefined) return 'none'
  return 'processing'
}

function slashPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.startsWith('/') ? raw : `/${raw}`
}

async function toShotJson(storyboard: typeof schema.storyboards.$inferSelect, shot: ShotRow | null): Promise<ReturnType<typeof buildShotJsonSync>> {
  const tasks = await db.select().from(schema.sysTask)
    .where(eq(schema.sysTask.storyboardId, storyboard.id))
    .orderBy(desc(schema.sysTask.id))
  const latestImage = tasks.find(t => t.type === 'image')
  const latestVideo = tasks.find(t => t.type === 'video')
  return buildShotJsonSync(storyboard, shot, latestImage, latestVideo)
}

function buildShotJsonSync(
  storyboard: typeof schema.storyboards.$inferSelect,
  shot: ShotRow | null,
  latestImage: typeof schema.sysTask.$inferSelect | undefined,
  latestVideo: typeof schema.sysTask.$inferSelect | undefined,
) {
  const keyframeStatus = mediaStatusFromTask(latestImage?.status)
  const videoStatus = mediaStatusFromTask(latestVideo?.status)
  const keyframeCompleted = keyframeStatus === 'completed'
  return {
    id: storyboard.id,
    number: storyboard.storyboardNumber,
    role: shot?.role ?? storyboard.title ?? '',
    durationSec: storyboard.duration ?? 0,
    dialogue: shot?.dialogue ?? null,
    visual: storyboard.description ?? '',
    onScreenText: shot?.onScreenText ?? null,
    keyframeUrl: keyframeCompleted ? slashPath(storyboard.firstFrameImage) : null,
    keyframeStatus,
    keyframeError: keyframeStatus === 'failed' ? (latestImage?.errorMsg || 'keyframe generation failed') : null,
    videoUrl: videoStatus === 'completed' ? (slashPath(storyboard.videoUrl) ?? slashPath(latestVideo?.localPath ?? latestVideo?.resultUrl ?? null)) : null,
    videoStatus,
    videoError: videoStatus === 'failed' ? (latestVideo?.errorMsg || 'video generation failed') : null,
  }
}

function toStudioImageJson(row: ImageRow, task: typeof schema.sysTask.$inferSelect | undefined, productImages: string[]) {
  const status = task?.status === 'completed' ? 'completed' : (task?.status === 'failed' || task?.status === 'unknown') ? 'failed' : 'processing'
  const rawImage = status === 'completed' ? (task?.localPath || task?.resultUrl || null) : null
  const imageUrl = rawImage ? (rawImage.startsWith('/') ? rawImage : `/${rawImage}`) : null
  const promoted = !!imageUrl && productImages.some(img => img.replace(/^\//, '') === imageUrl.replace(/^\//, ''))
  return {
    id: row.id,
    projectId: row.projectId,
    kind: row.kind,
    platform: row.platform,
    sourceImage: row.sourceImage,
    instruction: row.instruction,
    prompt: row.prompt,
    taskId: row.taskId,
    status,
    imageUrl,
    errorMsg: status === 'failed' ? (task?.errorMsg || 'image generation failed') : null,
    promoted,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** avatar.imageUrl อ่านสดจาก sys_task (image_task_id) — pattern เดียวกับ campaign_visuals */
function toAvatarJson(row: AvatarRow, task: typeof schema.sysTask.$inferSelect | undefined) {
  // รูปที่ผู้ใช้อัปโหลด (image_url) มาก่อนเสมอ; ไม่มี → รูปจาก AI (image_task_id)
  if (row.imageUrl) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      locale: row.locale,
      imageUrl: row.imageUrl.startsWith('/') ? row.imageUrl : `/${row.imageUrl}`,
      imageStatus: 'completed',
      imageError: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
  const status = task?.status === 'completed' ? 'completed' : (task?.status === 'failed' || task?.status === 'unknown') ? 'failed' : row.imageTaskId ? 'processing' : 'none'
  const rawImage = status === 'completed' ? (task?.localPath || task?.resultUrl || null) : null
  const imageUrl = rawImage ? (rawImage.startsWith('/') ? rawImage : `/${rawImage}`) : null
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    locale: row.locale,
    imageUrl,
    imageStatus: status,
    imageError: status === 'failed' ? (task?.errorMsg || 'avatar image generation failed') : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

async function getAvatarWithTask(avatarId: number | null): Promise<{ row: AvatarRow; json: ReturnType<typeof toAvatarJson> } | null> {
  if (!avatarId) return null
  const [row] = await db.select().from(schema.studioAvatars)
    .where(and(eq(schema.studioAvatars.id, avatarId), isNull(schema.studioAvatars.deletedAt)))
  if (!row) return null
  const [task] = row.imageTaskId
    ? await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.imageTaskId))
    : []
  return { row, json: toAvatarJson(row, task) }
}

// ---------- 校验 ----------

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AppError(`${field} ไม่ถูกต้อง (รองรับ: ${allowed.join(', ')})`, 'E_INVALID_FIELD')
  }
  return value as T
}

function parseBudgetThb(raw: unknown): number | null {
  if (raw === null || raw === '' || raw === undefined) return null
  const amount = Number(raw)
  if (!Number.isFinite(amount) || amount < 0 || amount > 100_000_000) {
    throw new AppError('Budget must be between 0 and 100,000,000 THB', 'E_INVALID_FIELD')
  }
  return Math.round(amount * 100) / 100
}

// ---------- CRUD ----------

async function getProjectRow(id: number): Promise<ProjectRow | null> {
  const [row] = await db.select().from(schema.studioProjects)
    .where(and(eq(schema.studioProjects.id, id), isNull(schema.studioProjects.deletedAt)))
  return row ?? null
}

export async function listProjects() {
  const rows = await db.select().from(schema.studioProjects)
    .where(isNull(schema.studioProjects.deletedAt))
    .orderBy(desc(schema.studioProjects.updatedAt))
  return rows.map(toProjectJson)
}

export function getStudioOptions() {
  return {
    languages: STUDIO_LANGUAGES,
    markets: STUDIO_MARKETS,
    platforms: STUDIO_PLATFORMS,
  }
}

export function getStudioTemplates() {
  return STUDIO_TEMPLATES
}

export async function getProjectDetail(id: number) {
  const row = await getProjectRow(id)
  if (!row) return null
  const shots = row.episodeId ? await getProjectShots(row) : []
  const imageRows = await db.select().from(schema.studioImages)
    .where(eq(schema.studioImages.projectId, id))
    .orderBy(desc(schema.studioImages.id))
  const productImages = parseJsonArray(row.productImages)
  const images = await Promise.all(imageRows.map(async (img) => {
    const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, img.taskId))
    return toStudioImageJson(img, task, productImages)
  }))
  const latestMergeRow = row.episodeId
    ? (await db.select().from(schema.videoMerges)
      .where(and(eq(schema.videoMerges.episodeId, row.episodeId), isNull(schema.videoMerges.deletedAt)))
      .orderBy(desc(schema.videoMerges.id)))[0]
    : undefined
  const avatar = await getAvatarWithTask(row.avatarId)
  return {
    ...toProjectJson(row),
    shots,
    images,
    latestMerge: latestMergeRow
      ? {
        id: latestMergeRow.id,
        status: latestMergeRow.status === 'completed' ? 'completed' : latestMergeRow.status === 'failed' ? 'failed' : 'processing',
        videoUrl: slashPath(latestMergeRow.mergedUrl),
        errorMsg: latestMergeRow.errorMsg,
        createdAt: latestMergeRow.createdAt,
      }
      : null,
    avatar: avatar?.json ?? null,
  }
}

/** ช็อตของโปรเจกต์ = storyboards ที่ยังไม่ลบของ episode + studio_shots + สถานะจาก sys_task ล่าสุดต่อชนิด */
async function getProjectShots(row: ProjectRow) {
  if (!row.episodeId) return []
  const storyboards = await db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, row.episodeId), isNull(schema.storyboards.deletedAt)))
    .orderBy(schema.storyboards.storyboardNumber)
  const shotRows = await db.select().from(schema.studioShots)
    .where(eq(schema.studioShots.projectId, row.id))
  const shotByStoryboard = new Map(shotRows.map(s => [s.storyboardId, s]))
  const tasks = row.episodeId
    ? await db.select().from(schema.sysTask)
      .where(inArray(schema.sysTask.storyboardId, storyboards.map(sb => sb.id)))
      .orderBy(desc(schema.sysTask.id))
    : []
  const latest = new Map<string, typeof schema.sysTask.$inferSelect>()
  for (const task of tasks) {
    const key = `${task.storyboardId}:${task.type}`
    if (!latest.has(key)) latest.set(key, task)
  }
  return Promise.all(storyboards.map(sb => toShotJson(sb, shotByStoryboard.get(sb.id) ?? null)))
}

export async function createProject(body: any) {
  if (!isNonEmptyString(body.productName) && !isNonEmptyString(body.productUrl)) {
    throw new AppError('需要 productName 或 productUrl', 'E_INVALID_FIELD')
  }
  const templateId = isNonEmptyString(body.templateId) ? body.templateId : ''
  const template = getStudioTemplate(templateId)
  if (!template) throw new AppError(`ไม่รู้จัก template: ${templateId}`, 'E_TEMPLATE_UNKNOWN')

  const platform = body.platform !== undefined && body.platform !== null
    ? requireEnum<StudioPlatform>(body.platform, STUDIO_PLATFORMS.map(p => p.id), 'platform')
    : 'tiktok'
  const platformOption = STUDIO_PLATFORMS.find(p => p.id === platform)!
  const market = body.market !== undefined && body.market !== null
    ? requireEnum<StudioMarket>(body.market, STUDIO_MARKETS.map(m => m.id), 'market')
    : 'TH'
  const marketOption = STUDIO_MARKETS.find(m => m.id === market)!
  const language = body.language !== undefined && body.language !== null
    ? requireEnum<StudioLanguage>(body.language, STUDIO_LANGUAGES, 'language')
    : marketOption.defaultLanguage
  const aspectRatio = body.aspectRatio !== undefined && body.aspectRatio !== null
    ? requireEnum<StudioAspectRatio>(body.aspectRatio, ['9:16', '1:1', '16:9'] as const, 'aspectRatio')
    : platformOption.defaultAspect

  // durationSec: 10-60 (clamp ตาม platform maxDurationSec) — default = ผลรวมวินาทีของเทมเพลต
  let durationSec = body.durationSec ?? templateDurationSec(template.beats)
  durationSec = Math.round(Number(durationSec))
  if (!Number.isFinite(durationSec)) durationSec = templateDurationSec(template.beats)
  durationSec = Math.min(Math.max(durationSec, 10), platformOption.maxDurationSec)

  if (body.avatarId !== undefined && body.avatarId !== null) {
    const avatar = Number(body.avatarId)
    if (!Number.isInteger(avatar) || avatar < 1) throw new AppError('avatarId ไม่ถูกต้อง', 'E_INVALID_FIELD')
  }

  const ts = now()
  const values: typeof schema.studioProjects.$inferInsert = {
    title: isNonEmptyString(body.title) ? body.title.trim() : (body.productName || body.productUrl).trim(),
    productName: isNonEmptyString(body.productName) ? body.productName.trim() : '',
    templateId: template.id,
    language,
    market,
    platform,
    aspectRatio,
    durationSec,
    aiDisclosure: body.aiDisclosure === undefined ? true : !!body.aiDisclosure,
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }
  if (body.productUrl !== undefined) values.productUrl = isNonEmptyString(body.productUrl) ? body.productUrl.trim() : null
  if (body.productDescription !== undefined) values.productDescription = isNonEmptyString(body.productDescription) ? body.productDescription : null
  if (body.productImages !== undefined) {
    if (!Array.isArray(body.productImages)) throw new AppError('productImages ต้องเป็น array', 'E_INVALID_FIELD')
    values.productImages = JSON.stringify(body.productImages.map(String))
  }
  if (body.avatarId !== undefined && body.avatarId !== null) values.avatarId = Number(body.avatarId)
  if (body.tone !== undefined) values.tone = isNonEmptyString(body.tone) ? body.tone : null
  if (body.notes !== undefined) values.notes = isNonEmptyString(body.notes) ? body.notes : null
  if (body.budgetThb !== undefined) values.budgetThb = parseBudgetThb(body.budgetThb)

  const res = await db.insert(schema.studioProjects).values(values)
  const row = await getProjectRow(getInsertId(res))
  return row ? toProjectJson(row) : null
}

/** ฟิลด์ที่ PUT แก้ได้ — status ไม่ให้แก้ตรง ๆ (state machine จาก script job) */
export async function updateProject(id: number, body: any) {
  const row = await getProjectRow(id)
  if (!row) return null
  const updates: Partial<typeof schema.studioProjects.$inferInsert> = { updatedAt: now() }
  if (body.title !== undefined) {
    if (!isNonEmptyString(body.title)) throw new AppError('title 不能为空', 'E_INVALID_FIELD')
    updates.title = body.title.trim()
  }
  if (body.productName !== undefined) {
    if (!isNonEmptyString(body.productName)) throw new AppError('productName 不能为空', 'E_INVALID_FIELD')
    updates.productName = body.productName.trim()
  }
  if (body.productUrl !== undefined) updates.productUrl = isNonEmptyString(body.productUrl) ? body.productUrl.trim() : null
  if (body.productDescription !== undefined) updates.productDescription = isNonEmptyString(body.productDescription) ? body.productDescription : null
  if (body.productImages !== undefined) {
    if (!Array.isArray(body.productImages)) throw new AppError('productImages ต้องเป็น array', 'E_INVALID_FIELD')
    updates.productImages = JSON.stringify(body.productImages.map(String))
  }
  if (body.templateId !== undefined) {
    const templateId = isNonEmptyString(body.templateId) ? body.templateId : ''
    if (!getStudioTemplate(templateId)) throw new AppError(`ไม่รู้จัก template: ${templateId}`, 'E_TEMPLATE_UNKNOWN')
    updates.templateId = templateId
  }
  if (body.language !== undefined) updates.language = requireEnum<StudioLanguage>(body.language, STUDIO_LANGUAGES, 'language')
  if (body.market !== undefined) updates.market = requireEnum<StudioMarket>(body.market, STUDIO_MARKETS.map(m => m.id), 'market')
  if (body.platform !== undefined) {
    updates.platform = requireEnum<StudioPlatform>(body.platform, STUDIO_PLATFORMS.map(p => p.id), 'platform')
    // ไม่ได้ส่ง aspectRatio มาด้วย → ตาม default ของ platform ใหม่
    if (body.aspectRatio === undefined) {
      updates.aspectRatio = STUDIO_PLATFORMS.find(p => p.id === updates.platform)!.defaultAspect
    }
  }
  if (body.aspectRatio !== undefined) updates.aspectRatio = requireEnum<StudioAspectRatio>(body.aspectRatio, ['9:16', '1:1', '16:9'] as const, 'aspectRatio')
  if (body.durationSec !== undefined) {
    const platform = (updates.platform ?? row.platform) as StudioPlatform
    const max = STUDIO_PLATFORMS.find(p => p.id === platform)!.maxDurationSec
    const duration = Math.round(Number(body.durationSec))
    if (!Number.isFinite(duration) || duration < 10 || duration > max) {
      throw new AppError(`durationSec ต้องอยู่ระหว่าง 10-${max} วินาที`, 'E_INVALID_FIELD')
    }
    updates.durationSec = duration
  }
  if (body.avatarId !== undefined) updates.avatarId = body.avatarId === null ? null : Number(body.avatarId)
  if (body.tone !== undefined) updates.tone = isNonEmptyString(body.tone) ? body.tone : null
  if (body.notes !== undefined) updates.notes = isNonEmptyString(body.notes) ? body.notes : null
  if (body.budgetThb !== undefined) updates.budgetThb = parseBudgetThb(body.budgetThb)
  if (body.aiDisclosure !== undefined) updates.aiDisclosure = !!body.aiDisclosure

  await db.update(schema.studioProjects).set(updates).where(eq(schema.studioProjects.id, id))
  const updated = await getProjectRow(id)
  return updated ? toProjectJson(updated) : null
}

export async function deleteProject(id: number): Promise<boolean> {
  const row = await getProjectRow(id)
  if (!row) return false
  // soft delete — drama ที่ผูกไว้ไม่ลบ (ผู้ใช้อาจยังใช้ episode เดิมอยู่)
  await db.update(schema.studioProjects).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.studioProjects.id, id))
  return true
}

export async function ingestStudioUrl(url: string) {
  return ingestUrl(url)
}

// ---------- Script (review_director, async) ----------

function assertNotScripting(row: ProjectRow) {
  if (STUDIO_PROJECT_ING_STATUSES.includes(row.status)) {
    throw new AppError('โปรเจกต์กำลังเขียนบทอยู่ กรุณารอสักครู่', 'E_STUDIO_BUSY')
  }
}

/** เทมเพลต avatarMode: required แต่ไม่มี avatar ที่มีรูป → E_AVATAR_REQUIRED (เช็กตอน script และ render keyframes) */
async function requireAvatarIfTemplateNeeds(row: ProjectRow) {
  const template = getStudioTemplate(row.templateId)
  if (!template || template.avatarMode !== 'required') return null
  const avatar = await getAvatarWithTask(row.avatarId)
  if (!avatar || avatar.json.imageStatus !== 'completed' || !avatar.json.imageUrl) {
    throw new AppError('เทมเพลตนี้ต้องใช้ avatar ที่มีรูปก่อน', 'E_AVATAR_REQUIRED')
  }
  return avatar
}

/** สร้าง drama + episode ให้โปรเจกต์ (ถ้ายังไม่มี) — reuse pattern ของ Marketer produce */
async function ensureDramaAndEpisode(row: ProjectRow): Promise<{ dramaId: number; episodeId: number }> {
  let dramaId = row.dramaId
  if (dramaId) {
    const [drama] = await db.select().from(schema.dramas)
      .where(and(eq(schema.dramas.id, dramaId), isNull(schema.dramas.deletedAt)))
    if (!drama) dramaId = null
  }
  if (!dramaId) {
    const ts = now()
    const res = await db.insert(schema.dramas).values({
      title: row.title,
      aspectRatio: row.aspectRatio,
      metadata: JSON.stringify({ studioProjectId: row.id }),
      budgetThb: row.budgetThb ?? null,
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    })
    dramaId = getInsertId(res)
  }
  let episodeId = row.episodeId
  if (episodeId) {
    const [ep] = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.id, episodeId), isNull(schema.episodes.deletedAt)))
    if (!ep) episodeId = null
  }
  if (!episodeId) {
    const existing = await db.select().from(schema.episodes)
      .where(and(eq(schema.episodes.dramaId, dramaId), isNull(schema.episodes.deletedAt)))
      .orderBy(schema.episodes.episodeNumber)
    const nextNum = existing.length ? Math.max(...existing.map(e => e.episodeNumber)) + 1 : 1
    const ts = now()
    const [imageConfigId, videoConfigId] = await Promise.all([
      getActiveConfig('image'), getActiveConfig('video'),
    ])
    const epRes = await db.insert(schema.episodes).values({
      dramaId,
      episodeNumber: nextNum,
      title: row.title,
      status: 'draft',
      resolution: '720p',
      imageConfigId: imageConfigId?.id ?? null,
      videoConfigId: videoConfigId?.id ?? null,
      createdAt: ts,
      updatedAt: ts,
    })
    episodeId = getInsertId(epRes)
  }
  await db.update(schema.studioProjects).set({ dramaId, episodeId, updatedAt: now() })
    .where(eq(schema.studioProjects.id, row.id))
  return { dramaId, episodeId }
}

export async function startStudioScript(projectId: number, opts: { instruction?: string } = {}) {
  const row = await getProjectRow(projectId)
  if (!row) return null
  assertNotScripting(row)
  await requireAvatarIfTemplateNeeds(row)
  const template = getStudioTemplate(row.templateId)
  if (!template) throw new AppError(`ไม่รู้จัก template: ${row.templateId}`, 'E_TEMPLATE_UNKNOWN')
  const textConfig = await getActiveConfig('text')
  if (!textConfig) throw new AppError('未配置文本模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_TEXT_MODEL')

  const key = `studio_script:${projectId}`
  const task = await startTask({ kind: 'studio_script', key })
  if (!task) throw new AppError('กำลังเขียนบทอยู่แล้ว', 'E_STUDIO_BUSY')

  // drama + episode ก่อนเริ่ม agent (tool ต้องใช้ episodeId)
  const { dramaId, episodeId } = await ensureDramaAndEpisode(row)
  const cleared = await clearEpisodeStoryboards(episodeId)
  await db.delete(schema.studioShots).where(eq(schema.studioShots.projectId, projectId))

  // beats สเกลตาม durationSec — role strings ตรงกับ frontend i18n
  const beats = scaleBeats(template.beats, row.durationSec)
  const avatar = await getAvatarWithTask(row.avatarId)

  await db.update(schema.studioProjects).set({ status: 'scripting', errorMsg: null, updatedAt: now() })
    .where(eq(schema.studioProjects.id, projectId))
  logTaskStart('Studio', 'script', { projectId, template: row.templateId, shots: beats.length, cleared })

  const marketOption = STUDIO_MARKETS.find(m => m.id === row.market)
  const message = [
    `【Product】\n- Name: ${row.productName}`,
    row.productUrl ? `- URL: ${row.productUrl} (reference only — never fetch)` : '',
    row.productDescription ? `- Description: ${row.productDescription}` : '',
    parseJsonArray(row.productImages).length ? `- Product images: ${parseJsonArray(row.productImages).join(', ')}` : '',
    `【Template】\n- id: ${template.id} · category: ${template.category} · avatarMode: ${template.avatarMode} · hasDialogue: ${template.hasDialogue}`,
    `- Beats (one shot per role, seconds EXACTLY as given, in order):\n${beats.map(b => `  - role: ${b.role} · ${b.seconds}s`).join('\n')}`,
    `【Settings】\n- Spoken language: ${row.language} · Market: ${row.market} (currency ${marketOption?.currency}) · Platform: ${row.platform}`,
    avatar ? `- Avatar: ${avatar.row.name} — ${avatar.row.description}` : '- Avatar: none',
    row.tone ? `- Tone: ${row.tone}` : '',
    row.notes ? `- Notes: ${row.notes}` : '',
    opts.instruction ? `- User instruction: ${opts.instruction}` : '',
    'Write the complete shot list now and call save_studio_shots ONCE with all shots in order. Dialogue must be in ' + row.language + '.',
  ].filter(Boolean).join('\n')

  // fire-and-forget เหมือน Marketer — ความผิดพลาดเก็บ "E_CODE: message"
  ;(async () => {
    const agent = mastra.getAgent('review_director')
    if (!agent) throw new Error('E_AGENT_UNAVAILABLE: review_director Agent 不可用')
    const requestContext = buildStudioRequestContext({
      studioProjectId: projectId,
      studioDramaId: dramaId,
      studioEpisodeId: episodeId,
      expectedShots: beats.length,
    })
    return agent.generate([{ role: 'user', content: message }], { maxSteps: 12, requestContext })
  })()
    .then(async (result: any) => {
      await updateTask(key, { status: 'done', finishedAt: now() })
      await db.update(schema.studioProjects).set({ status: 'script_ready', errorMsg: null, updatedAt: now() })
        .where(eq(schema.studioProjects.id, projectId))
      logTaskSuccess('Studio', 'script', { projectId, shots: (result?.toolCalls || []).length })
    })
    .catch(async (err: any) => {
      const raw = err?.message || 'script generation failed'
      const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
      await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
      await db.update(schema.studioProjects).set({ status: 'failed', errorMsg: msg, updatedAt: now() })
        .where(eq(schema.studioProjects.id, projectId))
      logTaskError('Studio', 'script', { projectId, error: msg })
    })
  return { status: 'scripting' as const }
}

/** boot 清理：scripting ค้างหลัง restart เป็น failed (รูปแบบ "E_CODE: message" เดียวกับ Marketer) */
export async function failStaleStudioProjects(): Promise<number> {
  const res = await db.update(schema.studioProjects)
    .set({ status: 'failed', errorMsg: 'E_TASK_INTERRUPTED: 服务重启，任务中断，请重试', updatedAt: now() })
    .where(inArray(schema.studioProjects.status, STUDIO_PROJECT_ING_STATUSES))
  return res?.changes ?? 0
}

// ---------- Shot edit + Render + Merge ----------

/** ตรวจว่า shot (storyboard) เป็นของโปรเจกต์นี้จริง */
async function getProjectShot(project: ProjectRow, shotId: number) {
  const [sb] = await db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.id, shotId), eq(schema.storyboards.episodeId, project.episodeId ?? -1), isNull(schema.storyboards.deletedAt)))
  if (!sb) return null
  const [shot] = await db.select().from(schema.studioShots).where(eq(schema.studioShots.storyboardId, shotId))
  return { storyboard: sb, shot: shot ?? null }
}

export async function updateShot(projectId: number, shotId: number, body: any) {
  const project = await getProjectRow(projectId)
  if (!project) return null
  const found = await getProjectShot(project, shotId)
  if (!found) return null
  const { storyboard, shot } = found
  if (project.status === 'scripting') throw new AppError('โปรเจกต์กำลังเขียนบทอยู่ กรุณารอสักครู่', 'E_STUDIO_BUSY')

  const visual = body.visual !== undefined ? String(body.visual) : (storyboard.description ?? '')
  const durationSec = body.durationSec !== undefined ? Math.round(Number(body.durationSec)) : (storyboard.duration ?? 0)
  if (!Number.isFinite(durationSec) || durationSec < 2 || durationSec > 60) {
    throw new AppError('durationSec ต้องอยู่ระหว่าง 2-60 วินาที', 'E_INVALID_FIELD')
  }
  const dialogue = body.dialogue !== undefined ? (isNonEmptyString(body.dialogue) ? String(body.dialogue) : null) : (shot?.dialogue ?? null)
  const onScreenText = body.onScreenText !== undefined ? (isNonEmptyString(body.onScreenText) ? String(body.onScreenText) : null) : (shot?.onScreenText ?? null)
  const role = shot?.role ?? storyboard.title ?? ''

  // imagePrompt/videoPrompt สร้างใหม่แบบ deterministic — keyframe/video เดิมยังอยู่จนกว่าจะสั่ง render ใหม่
  const avatar = await getAvatarWithTask(project.avatarId)
  const { imagePrompt, videoPrompt } = buildShotPrompts(
    {
      productName: project.productName,
      productDescription: project.productDescription,
      language: project.language,
      platform: project.platform,
      hasDialogue: true,
    },
    { role, durationSec, visual, dialogue, onScreenText },
    avatar ? { name: avatar.row.name, description: avatar.row.description } : null,
  )

  const ts = now()
  await db.update(schema.storyboards)
    .set({ description: visual, duration: durationSec, imagePrompt, videoPrompt, updatedAt: ts })
    .where(eq(schema.storyboards.id, shotId))
  if (shot) {
    await db.update(schema.studioShots)
      .set({ dialogue, onScreenText })
      .where(eq(schema.studioShots.storyboardId, shotId))
  } else {
    await db.insert(schema.studioShots).values({ storyboardId: shotId, projectId, role, dialogue, onScreenText })
  }
  const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, shotId))
  const [updatedShot] = await db.select().from(schema.studioShots).where(eq(schema.studioShots.storyboardId, shotId))
  return toShotJson(sb, updatedShot ?? null)
}

/** ช็อตเป้าหมายของ render — ไม่ระบุ shotIds = ทุกช็อตที่ยังไม่ completed ตาม stage */
async function renderTargets(project: ProjectRow, stage: 'keyframes' | 'videos', shotIds: number[] | undefined) {
  const all = await getProjectShots(project)
  let shots = all
  if (shotIds?.length) {
    const allow = new Set(shotIds)
    shots = all.filter(s => allow.has(s.id))
  } else {
    shots = all.filter(s => (stage === 'keyframes' ? s.keyframeStatus : s.videoStatus) !== 'completed')
  }
  return { all, shots }
}

export async function renderStage(projectId: number, body: { stage?: unknown; shotIds?: unknown }) {
  const project = await getProjectRow(projectId)
  if (!project) return null
  const stage = requireEnum(body.stage, ['keyframes', 'videos'] as const, 'stage')
  const shotIds = Array.isArray(body.shotIds) ? body.shotIds.map(Number).filter(n => Number.isInteger(n) && n > 0) : undefined

  const { all, shots } = await renderTargets(project, stage, shotIds)
  if (!all.length) throw new AppError('ยังไม่มีบท/ช็อต — สั่งเขียนบทก่อน', 'E_STUDIO_NEEDS_SCRIPT')

  if (stage === 'keyframes') {
    await requireAvatarIfTemplateNeeds(project)
    const imageConfig = await getActiveConfig('image')
    if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')
    const productImages = parseJsonArray(project.productImages)
    const avatar = await getAvatarWithTask(project.avatarId)
    const references = [
      ...productImages.slice(0, 3),
      ...(avatar?.json.imageUrl ? [avatar.json.imageUrl] : []),
    ]
    let queued = 0
    for (const shot of shots) {
      await generateImage({
        storyboardId: shot.id,
        dramaId: project.dramaId ?? undefined,
        prompt: (await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, shot.id)))[0].imagePrompt || shot.visual,
        size: visualSizeFor(project.aspectRatio, 'on_model'),
        referenceImages: references.length ? references : undefined,
        frameType: 'first_frame',
        configId: (await db.select().from(schema.episodes).where(eq(schema.episodes.id, project.episodeId ?? -1)))[0]?.imageConfigId ?? undefined,
      })
      queued += 1
    }
    logTaskStart('Studio', 'render-keyframes', { projectId, queued })
    return { queued }
  }

  // videos: state check มาก่อน model guard — ต้องมี keyframe completed ของช็อตนั้น
  // (ไม่มี ⇒ ข้ามช็อตนั้น; ไม่มีสักช็อต ⇒ E_STUDIO_NEEDS_KEYFRAMES)
  const withKeyframe = shots.filter(s => s.keyframeStatus === 'completed' && s.keyframeUrl)
  if (!withKeyframe.length) {
    throw new AppError('ยังไม่มี keyframe ที่เสร็จแล้ว — สร้าง keyframe ก่อนสร้างวิดีโอ', 'E_STUDIO_NEEDS_KEYFRAMES')
  }
  const videoConfig = await getActiveConfig('video')
  if (!videoConfig) throw new AppError('未配置视频模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_VIDEO_MODEL')
  let queued = 0
  for (const shot of withKeyframe) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, shot.id))
    const body = {
      storyboard_id: shot.id,
      drama_id: project.dramaId ?? undefined,
      prompt: sb.videoPrompt || shot.visual,
      first_frame_url: sb.firstFrameImage || undefined,
      generate_audio: !!shot.dialogue || getStudioTemplate(project.templateId)?.hasDialogue === true,
      duration: shot.durationSec,
      aspect_ratio: project.aspectRatio,
      resolution: (await db.select().from(schema.episodes).where(eq(schema.episodes.id, project.episodeId ?? -1)))[0]?.resolution || undefined,
      config_id: (await db.select().from(schema.episodes).where(eq(schema.episodes.id, project.episodeId ?? -1)))[0]?.videoConfigId ?? undefined,
    }
    // ผ่าน service จาก task 1 (resolveTaskContext + prepareVideoTask) — ไม่ก๊อป logic แยก
    const context = await resolveTaskContext(body, 'video')
    const prepared = await prepareVideoTask(body, context)
    await generateVideo({
      storyboardId: shot.id,
      dramaId: project.dramaId ?? undefined,
      prompt: prepared.prompt,
      model: prepared.videoBody.model,
      referenceMode: 'reference',
      imageUrl: prepared.videoBody.image_url,
      firstFrameUrl: prepared.videoBody.first_frame_url,
      referenceImageUrls: prepared.videoBody.reference_image_urls,
      referenceVideoUrls: prepared.videoBody.reference_video_urls,
      referenceAudioUrls: prepared.videoBody.reference_audio_urls,
      referenceFileUrl: prepared.videoBody.file_url,
      referenceLinkUrl: prepared.videoBody.link_url,
      generateAudio: prepared.videoBody.generate_audio,
      duration: prepared.videoBody.duration,
      aspectRatio: prepared.videoBody.aspect_ratio,
      resolution: context.episodeResolution || prepared.videoBody.resolution,
      seed: prepared.videoBody.seed,
      promptExtend: prepared.videoBody.prompt_extend,
      watermark: prepared.videoBody.watermark,
      configId: context.configId,
    })
    queued += 1
  }
  logTaskStart('Studio', 'render-videos', { projectId, queued })
  return { queued }
}

export async function mergeProject(projectId: number) {
  const project = await getProjectRow(projectId)
  if (!project) return null
  if (!project.episodeId || !project.dramaId) throw new AppError('ยังไม่มีบท/ช็อต — สั่งเขียนบทก่อน', 'E_STUDIO_NEEDS_SCRIPT')
  const sbs = await db.select().from(schema.storyboards)
    .where(and(eq(schema.storyboards.episodeId, project.episodeId), isNull(schema.storyboards.deletedAt)))
  const hasVideo = sbs.some(sb => !!sb.videoUrl)
  if (!hasVideo) throw new AppError('ยังไม่มีวิดีโอของช็อตใดเลย — สร้างวิดีโอก่อน', 'E_STUDIO_NO_VIDEOS')
  // ต่อเฉพาะช็อตที่มีวิดีโอ เรียงตามลำดับ (mergeEpisodeVideos จัดการเอง)
  const mergeId = await mergeEpisodeVideos(project.episodeId, project.dramaId)
  const [row] = await db.select().from(schema.videoMerges).where(eq(schema.videoMerges.id, mergeId))
  return {
    id: row?.id ?? mergeId,
    status: row?.status === 'completed' ? 'completed' : row?.status === 'failed' ? 'failed' : 'processing',
    videoUrl: slashPath(row?.mergedUrl ?? null),
    errorMsg: row?.errorMsg ?? null,
    createdAt: row?.createdAt ?? now(),
  }
}

// ---------- Project images (packshot/lifestyle/on_model/banner) ----------

function studioImageSize(aspectRatio: string, kind: StudioImageKind, platform: StudioPlatform): string {
  // banner ตาม platform defaultAspect; ชนิดอื่นเหมือน Marketer (packshot สี่เหลี่ยมจัตุรัส)
  if (kind === 'banner') {
    const aspect = STUDIO_PLATFORMS.find(p => p.id === platform)?.defaultAspect ?? '9:16'
    return aspect === '1:1' ? '1024x1024' : aspect === '16:9' ? '1820x1024' : '1024x1820'
  }
  return visualSizeFor(aspectRatio, kind)
}

export async function generateProjectImages(projectId: number, body: any) {
  const project = await getProjectRow(projectId)
  if (!project) return null
  const kind = requireEnum(body.kind, STUDIO_IMAGE_KINDS, 'kind')
  const count = body.count ?? 2
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new AppError('count 必须是 1-4 的整数', 'E_INVALID_FIELD')
  }
  const platform = body.platform !== undefined && body.platform !== null
    ? requireEnum<StudioPlatform>(body.platform, STUDIO_PLATFORMS.map(p => p.id), 'platform')
    : null
  const sourceImage = typeof body.sourceImage === 'string' ? body.sourceImage.trim() : ''
  const productImages = parseJsonArray(project.productImages)
  if (!sourceImage || !productImages.includes(sourceImage)) {
    throw new AppError('sourceImage 必须是 project.productImages 中的一张图', 'E_INVALID_FIELD')
  }
  const instruction = isNonEmptyString(body.instruction) ? body.instruction : null
  const imageConfig = await getActiveConfig('image')
  if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')

  const prompt = buildVisualPrompt(kind, instruction)
  const size = studioImageSize(project.aspectRatio, kind as StudioImageKind, project.platform as StudioPlatform)
  logTaskStart('Studio', 'images', { projectId, kind, count, size })

  const rows: ReturnType<typeof toStudioImageJson>[] = []
  for (let i = 0; i < count; i++) {
    const taskId = await generateImage({
      dramaId: project.dramaId ?? undefined,
      prompt,
      size,
      referenceImages: [sourceImage],
    })
    const ts = now()
    const res = await db.insert(schema.studioImages).values({
      projectId,
      kind,
      platform,
      sourceImage,
      instruction,
      prompt,
      taskId,
      createdAt: ts,
      updatedAt: ts,
    })
    const [row] = await db.select().from(schema.studioImages).where(eq(schema.studioImages.id, getInsertId(res)))
    rows.push(toStudioImageJson(row, undefined, productImages))
  }
  return rows
}

export async function deleteProjectImage(projectId: number, imageId: number): Promise<boolean> {
  const [row] = await db.select().from(schema.studioImages)
    .where(and(eq(schema.studioImages.id, imageId), eq(schema.studioImages.projectId, projectId)))
  if (!row) return false
  await db.delete(schema.studioImages).where(eq(schema.studioImages.id, imageId))
  return true
}

export async function promoteProjectImage(projectId: number, imageId: number) {
  const project = await getProjectRow(projectId)
  if (!project) return null
  const [row] = await db.select().from(schema.studioImages)
    .where(and(eq(schema.studioImages.id, imageId), eq(schema.studioImages.projectId, projectId)))
  if (!row) return null
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.taskId))
  const json = toStudioImageJson(row, task, parseJsonArray(project.productImages))
  if (json.status !== 'completed' || !json.imageUrl) {
    throw new AppError('ภาพยังสร้างไม่เสร็จ (completed เท่านั้น)', 'E_VISUAL_NOT_READY')
  }
  const productImages = parseJsonArray(project.productImages)
  if (!json.promoted) {
    const next = [...productImages, json.imageUrl]
    await db.update(schema.studioProjects).set({ productImages: JSON.stringify(next), updatedAt: now() })
      .where(eq(schema.studioProjects.id, projectId))
  }
  const updated = await getProjectRow(projectId)
  return updated ? toProjectJson(updated) : null
}

// ---------- Avatars ----------

export async function listAvatars() {
  const rows = await db.select().from(schema.studioAvatars)
    .where(isNull(schema.studioAvatars.deletedAt))
    .orderBy(desc(schema.studioAvatars.updatedAt))
  return Promise.all(rows.map(async (row) => {
    const [task] = row.imageTaskId
      ? await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.imageTaskId))
      : []
    return toAvatarJson(row, task)
  }))
}

export async function createAvatar(body: any) {
  if (!isNonEmptyString(body.name)) throw new AppError('name 必填', 'E_INVALID_FIELD')
  if (!isNonEmptyString(body.description)) throw new AppError('description 必填', 'E_INVALID_FIELD')
  const locale = body.locale !== undefined && body.locale !== null
    ? requireEnum<StudioMarket>(body.locale, STUDIO_MARKETS.map(m => m.id), 'locale')
    : null
  const ts = now()
  const res = await db.insert(schema.studioAvatars).values({
    name: body.name.trim(),
    description: body.description.trim(),
    locale,
    imageUrl: isNonEmptyString(body.imageUrl) ? body.imageUrl.trim() : null,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.studioAvatars).where(eq(schema.studioAvatars.id, getInsertId(res)))
  return toAvatarJson(row, undefined)
}

export async function updateAvatar(avatarId: number, body: any) {
  const [row] = await db.select().from(schema.studioAvatars)
    .where(and(eq(schema.studioAvatars.id, avatarId), isNull(schema.studioAvatars.deletedAt)))
  if (!row) return null
  const updates: Partial<typeof schema.studioAvatars.$inferInsert> = { updatedAt: now() }
  if (body.name !== undefined) {
    if (!isNonEmptyString(body.name)) throw new AppError('name 不能为空', 'E_INVALID_FIELD')
    updates.name = body.name.trim()
  }
  if (body.description !== undefined) {
    if (!isNonEmptyString(body.description)) throw new AppError('description 不能为空', 'E_INVALID_FIELD')
    updates.description = body.description.trim()
  }
  if (body.locale !== undefined) updates.locale = body.locale === null ? null : requireEnum<StudioMarket>(body.locale, STUDIO_MARKETS.map(m => m.id), 'locale')
  if (body.imageUrl !== undefined) {
    // imageUrl จาก uploadAPI เดิม — เก็บตรง ๆ (ล้างงาน AI เดิม)
    updates.imageUrl = isNonEmptyString(body.imageUrl) ? body.imageUrl.trim() : null
    updates.imageTaskId = null
  }
  await db.update(schema.studioAvatars).set(updates).where(eq(schema.studioAvatars.id, avatarId))
  const [updated] = await db.select().from(schema.studioAvatars).where(eq(schema.studioAvatars.id, avatarId))
  return toAvatarJson(updated, undefined)
}

export async function generateAvatarImage(avatarId: number, body: { instruction?: string } = {}) {
  const [row] = await db.select().from(schema.studioAvatars)
    .where(and(eq(schema.studioAvatars.id, avatarId), isNull(schema.studioAvatars.deletedAt)))
  if (!row) return null
  const imageConfig = await getActiveConfig('image')
  if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')
  const instruction = isNonEmptyString(body.instruction) ? body.instruction : null
  const prompt = [
    `Portrait photograph (waist-up) of a presentable product reviewer avatar: ${row.description}.`,
    'Plain neutral studio background, soft even lighting, natural realistic face, friendly approachable expression, looking at the camera.',
    'No added text, logos or watermarks.',
    instruction ? ` Additional direction from the user: ${instruction}.` : '',
  ].join(' ')
  const taskId = await generateImage({ prompt, size: '1024x1024' })
  await db.update(schema.studioAvatars).set({ imageTaskId: taskId, updatedAt: now() })
    .where(eq(schema.studioAvatars.id, avatarId))
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
  return toAvatarJson({ ...row, imageTaskId: taskId }, task)
}

export async function deleteAvatar(avatarId: number): Promise<boolean> {
  const [row] = await db.select().from(schema.studioAvatars)
    .where(and(eq(schema.studioAvatars.id, avatarId), isNull(schema.studioAvatars.deletedAt)))
  if (!row) return false
  // soft delete — โปรเจกต์ที่ใช้อยู่เก็บ avatarId เดิม แต่ GET จะคืน avatar: null
  await db.update(schema.studioAvatars).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.studioAvatars.id, avatarId))
  return true
}
