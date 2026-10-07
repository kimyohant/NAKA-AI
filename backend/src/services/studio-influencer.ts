/**
 * AI Influencer service — คลังพรีเซนเตอร์ AI สำหรับรีวิวสินค้า (buzzy-style 3 ขั้น:
 * สร้าง influencer จากข้อความ/รูปอ้างอิง → คุมหน้าเดิมทุกภาพ (reference) → สเกลคอนเทนต์รีวิว)
 * reuse: generateImage (sys_task write-back), pipeline_tasks (async script), studio-templates (markets/languages)
 * ห้าม import services/studio.ts กลับ (studio.ts อ้างมาที่นี่ — กัน dependency cycle)
 */
import { and, desc, eq, isNull } from 'drizzle-orm'
import { ownedBy } from '../auth/owner-context.js'
import { db, getInsertId, schema } from '../db/index.js'
import { AppError, now } from '../utils/response.js'
import { getActiveConfig } from './ai.js'
import { generateImage } from './generation.js'
import { startTask, updateTask } from './pipeline-tasks.js'
import { mastra } from '../mastra/index.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { STUDIO_LANGUAGES, STUDIO_MARKETS, STUDIO_PLATFORMS, type StudioLanguage, type StudioMarket, type StudioPlatform } from './studio-templates.js'

export const INFLUENCER_NICHES = ['beauty', 'fashion', 'food', 'tech', 'fitness', 'lifestyle', 'gaming', 'travel', 'home', 'mom_baby'] as const
export type InfluencerNiche = typeof INFLUENCER_NICHES[number]

/** ฉากรีวิวมาตรฐาน — frontend แสดง chip เลือกได้ (i18n: productStudio.influencers.scenes.*) */
export const INFLUENCER_REVIEW_SCENES = ['unboxing', 'holding', 'using', 'closeup', 'lifestyle'] as const
export type InfluencerReviewScene = typeof INFLUENCER_REVIEW_SCENES[number]

const SCENE_PROMPTS: Record<InfluencerReviewScene, string> = {
  unboxing: 'Unboxing moment: the presenter opens the product packaging and reveals the product, natural delighted reaction, packaging visible in frame.',
  holding: 'Waist-up shot: the presenter holds the product up toward the camera with a friendly confident smile, product clearly visible.',
  using: 'The presenter actively uses the product in a natural believable way, showing how it works.',
  closeup: 'Close-up: the product held in the presenter\'s hand near the camera, sharp focus on the product details.',
  lifestyle: 'Lifestyle shot: the presenter together with the product in a bright everyday setting that suits the product.',
}

type InfluencerRow = typeof schema.studioInfluencers.$inferSelect
type ContentRow = typeof schema.studioInfluencerContents.$inferSelect

function slashPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.startsWith('/') ? raw : `/${raw}`
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function cleanOneLine(v: string): string {
  return v.replace(/\s+/g, ' ').trim()
}

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new AppError(`${field} ไม่ถูกต้อง (รองรับ: ${allowed.join(', ')})`, 'E_INVALID_FIELD')
  }
  return value as T
}

// ---------- 序列化（camelCase 对外） ----------

/** imageUrl จาก upload มาก่อนเสมอ; ไม่มี → รูปจาก AI (image_task_id → sys_task) — pattern เดียวกับ avatar */
function toInfluencerJson(row: InfluencerRow, task: typeof schema.sysTask.$inferSelect | undefined) {
  if (row.imageUrl) {
    return influencerJson(row, row.imageUrl.startsWith('/') ? row.imageUrl : `/${row.imageUrl}`, 'completed', null)
  }
  const status = task?.status === 'completed' ? 'completed'
    : (task?.status === 'failed' || task?.status === 'unknown') ? 'failed'
      : row.imageTaskId ? 'processing' : 'none'
  const rawImage = status === 'completed' ? (task?.localPath || task?.resultUrl || null) : null
  return influencerJson(row, slashPath(rawImage), status, status === 'failed' ? (task?.errorMsg || 'influencer portrait generation failed') : null)
}

function influencerJson(row: InfluencerRow, imageUrl: string | null, imageStatus: string, imageError: string | null) {
  return {
    id: row.id,
    name: row.name,
    niche: row.niche,
    persona: row.persona,
    appearance: row.appearance,
    locale: row.locale,
    tone: row.tone,
    imageUrl,
    imageStatus,
    imageError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toContentJson(row: ContentRow, task: typeof schema.sysTask.$inferSelect | undefined) {
  let status = row.status as 'processing' | 'completed' | 'failed'
  let imageUrl: string | null = null
  let errorMsg = row.errorMsg
  if (row.kind === 'image' && row.taskId) {
    status = task?.status === 'completed' ? 'completed'
      : (task?.status === 'failed' || task?.status === 'unknown') ? 'failed' : 'processing'
    imageUrl = status === 'completed' ? slashPath(task?.localPath || task?.resultUrl || null) : null
    errorMsg = status === 'failed' ? (task?.errorMsg || 'image generation failed') : null
  }
  return {
    id: row.id,
    influencerId: row.influencerId,
    kind: row.kind as 'image' | 'script',
    productName: row.productName,
    productImage: row.productImage,
    scene: row.scene,
    instruction: row.instruction,
    language: row.language,
    platform: row.platform,
    durationSec: row.durationSec,
    prompt: row.prompt,
    taskId: row.taskId,
    script: row.kind === 'script' ? row.script : null,
    status,
    imageUrl,
    errorMsg: status === 'failed' ? (errorMsg || 'content generation failed') : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export async function getInfluencerWithTask(influencerId: number | null | undefined): Promise<{ row: InfluencerRow; json: ReturnType<typeof toInfluencerJson> } | null> {
  if (!influencerId) return null
  const [row] = await db.select().from(schema.studioInfluencers)
    .where(and(eq(schema.studioInfluencers.id, influencerId), isNull(schema.studioInfluencers.deletedAt)))
  if (!row) return null
  const [task] = row.imageTaskId
    ? await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.imageTaskId))
    : []
  return { row, json: toInfluencerJson(row, task) }
}

/** รูปตัวตนล่าสุดของ influencer (upload หรือ portrait ที่เสร็จแล้ว) — ใช้เป็น reference คุมหน้าเดิม */
function identityImageUrl(row: InfluencerRow, task: typeof schema.sysTask.$inferSelect | undefined): string | null {
  if (row.imageUrl) return row.imageUrl.startsWith('/') ? row.imageUrl : `/${row.imageUrl}`
  return task?.status === 'completed' ? slashPath(task.localPath || task.resultUrl || null) : null
}

// ---------- Prompt composition (export ไว้เขียน test) ----------

export function composeInfluencerPortraitPrompt(
  inf: { appearance: string; persona: string; niche: string | null },
  instruction?: string | null,
): string {
  return [
    `Portrait photograph (waist-up) of a product-review influencer: ${cleanOneLine(inf.appearance) || 'a presentable social media creator'}.`,
    inf.persona ? `On-camera personality to convey: ${cleanOneLine(inf.persona)}.` : '',
    inf.niche ? `Content niche: ${inf.niche.replace(/_/g, ' ')}.` : '',
    'Plain neutral studio background, soft even lighting, natural realistic face, confident friendly influencer expression, looking at the camera, social-media creator style.',
    'No added text, logos or watermarks.',
    instruction ? `Additional direction from the user: ${cleanOneLine(instruction)}.` : '',
  ].filter(Boolean).join(' ')
}

export function composeInfluencerReviewPrompt(
  scene: InfluencerReviewScene,
  productName: string,
  instruction?: string | null,
): string {
  return [
    `Authentic social-media product-review photo of a presenter with the product "${cleanOneLine(productName)}".`,
    SCENE_PROMPTS[scene],
    'CRITICAL identity consistency: keep the presenter\'s face, hairstyle and body exactly the same as the presenter reference image (the first reference image).',
    'CRITICAL product accuracy: keep the exact product design, label, text layout, colors and proportions from the product reference image (the second reference image). Do not invent or alter the product.',
    'Natural lighting, UGC creator style suitable for a short-video review. No added text, logos or watermarks.',
    instruction ? `Additional direction from the user: ${cleanOneLine(instruction)}.` : '',
  ].filter(Boolean).join(' ')
}

function reviewImageSize(aspectRatio: string | undefined): string {
  if (aspectRatio === '1:1') return '1024x1024'
  if (aspectRatio === '16:9') return '1820x1024'
  return '1024x1820'
}

// ---------- CRUD ----------

export async function listInfluencers() {
  const rows = await db.select().from(schema.studioInfluencers)
    .where(and(isNull(schema.studioInfluencers.deletedAt), ownedBy(schema.studioInfluencers.ownerUserId)))
    .orderBy(desc(schema.studioInfluencers.updatedAt))
  return Promise.all(rows.map(async (row) => {
    const [task] = row.imageTaskId
      ? await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.imageTaskId))
      : []
    return toInfluencerJson(row, task)
  }))
}

export async function createInfluencer(body: any) {
  if (!isNonEmptyString(body.name)) throw new AppError('name 必填', 'E_INVALID_FIELD')
  const values: Partial<typeof schema.studioInfluencers.$inferInsert> = {
    name: cleanOneLine(body.name),
    persona: isNonEmptyString(body.persona) ? body.persona.trim() : '',
    appearance: isNonEmptyString(body.appearance) ? body.appearance.trim() : '',
    imageUrl: isNonEmptyString(body.imageUrl) ? body.imageUrl.trim() : null,
    createdAt: now(),
    updatedAt: now(),
  }
  if (body.niche !== undefined && body.niche !== null && body.niche !== '') {
    values.niche = requireEnum<InfluencerNiche>(body.niche, INFLUENCER_NICHES, 'niche')
  }
  if (body.locale !== undefined && body.locale !== null && body.locale !== '') {
    values.locale = requireEnum<StudioMarket>(body.locale, STUDIO_MARKETS.map(m => m.id), 'locale')
  }
  if (body.tone !== undefined) values.tone = isNonEmptyString(body.tone) ? body.tone.trim() : null
  const res = await db.insert(schema.studioInfluencers).values(values as typeof schema.studioInfluencers.$inferInsert)
  const [row] = await db.select().from(schema.studioInfluencers).where(eq(schema.studioInfluencers.id, getInsertId(res)))
  return toInfluencerJson(row, undefined)
}

export async function updateInfluencer(influencerId: number, body: any) {
  const [row] = await db.select().from(schema.studioInfluencers)
    .where(and(eq(schema.studioInfluencers.id, influencerId), isNull(schema.studioInfluencers.deletedAt)))
  if (!row) return null
  const updates: Partial<typeof schema.studioInfluencers.$inferInsert> = { updatedAt: now() }
  if (body.name !== undefined) {
    if (!isNonEmptyString(body.name)) throw new AppError('name 不能为空', 'E_INVALID_FIELD')
    updates.name = cleanOneLine(body.name)
  }
  if (body.niche !== undefined) updates.niche = body.niche === null || body.niche === '' ? null : requireEnum<InfluencerNiche>(body.niche, INFLUENCER_NICHES, 'niche')
  if (body.persona !== undefined) updates.persona = isNonEmptyString(body.persona) ? body.persona.trim() : ''
  if (body.appearance !== undefined) updates.appearance = isNonEmptyString(body.appearance) ? body.appearance.trim() : ''
  if (body.locale !== undefined) updates.locale = body.locale === null || body.locale === '' ? null : requireEnum<StudioMarket>(body.locale, STUDIO_MARKETS.map(m => m.id), 'locale')
  if (body.tone !== undefined) updates.tone = isNonEmptyString(body.tone) ? body.tone.trim() : null
  if (body.imageUrl !== undefined) {
    // imageUrl จาก uploadAPI เดิม — เก็บตรง ๆ (ล้างงาน AI เดิม)
    updates.imageUrl = isNonEmptyString(body.imageUrl) ? body.imageUrl.trim() : null
    updates.imageTaskId = null
  }
  await db.update(schema.studioInfluencers).set(updates).where(eq(schema.studioInfluencers.id, influencerId))
  const [updated] = await db.select().from(schema.studioInfluencers).where(eq(schema.studioInfluencers.id, influencerId))
  return toInfluencerJson(updated, undefined)
}

export async function deleteInfluencer(influencerId: number): Promise<boolean> {
  const [row] = await db.select().from(schema.studioInfluencers)
    .where(and(eq(schema.studioInfluencers.id, influencerId), isNull(schema.studioInfluencers.deletedAt)))
  if (!row) return false
  // soft delete — โปรเจกต์ที่ใช้อยู่เก็บ influencerId เดิม แต่ GET จะคืน influencer: null
  await db.update(schema.studioInfluencers).set({ deletedAt: now(), updatedAt: now() })
    .where(eq(schema.studioInfluencers.id, influencerId))
  return true
}

// ---------- Portrait (Buzzy step 1-2: สร้างตัวตน + คุมหน้าเดิม) ----------

export async function generateInfluencerPortrait(influencerId: number, body: { instruction?: string } = {}) {
  const [row] = await db.select().from(schema.studioInfluencers)
    .where(and(eq(schema.studioInfluencers.id, influencerId), isNull(schema.studioInfluencers.deletedAt)))
  if (!row) return null
  const imageConfig = await getActiveConfig('image')
  if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')
  const instruction = isNonEmptyString(body.instruction) ? body.instruction : null
  const prompt = composeInfluencerPortraitPrompt(row, instruction)

  // consistency: มีรูปตัวตนอยู่แล้ว (upload หรือ portrait เดิม) → ส่งเป็น reference เพื่อรักษาหน้าเดิม
  const [previousTask] = row.imageTaskId
    ? await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.imageTaskId))
    : []
  const reference = identityImageUrl(row, previousTask)
  const taskId = await generateImage({
    prompt,
    size: '1024x1024',
    referenceImages: reference ? [reference] : undefined,
  })
  await db.update(schema.studioInfluencers).set({ imageTaskId: taskId, updatedAt: now() })
    .where(eq(schema.studioInfluencers.id, influencerId))
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
  return toInfluencerJson({ ...row, imageTaskId: taskId }, task)
}

// ---------- Review images (Buzzy step 3: สเกลคอนเทนต์รีวิวสินค้า) ----------

export async function generateReviewImages(influencerId: number, body: any) {
  const found = await getInfluencerWithTask(influencerId)
  if (!found) return null
  const imageConfig = await getActiveConfig('image')
  if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')

  const portrait = found.json.imageUrl
  if (!portrait) {
    throw new AppError('influencer ยังไม่มีรูปพรีเซนเตอร์ — อัปโหลดหรือกดให้ AI สร้างรูปก่อน', 'E_INFLUENCER_NO_IMAGE')
  }
  if (!isNonEmptyString(body.productName)) throw new AppError('productName 必填', 'E_INVALID_FIELD')
  if (!isNonEmptyString(body.productImage)) throw new AppError('productImage 必填 (รูปสินค้า 1 รูป)', 'E_INVALID_FIELD')

  const scenes: InfluencerReviewScene[] = Array.isArray(body.scenes) && body.scenes.length
    ? body.scenes.map((s: unknown) => requireEnum<InfluencerReviewScene>(s, INFLUENCER_REVIEW_SCENES, 'scene'))
    : ['holding']
  const count = body.count ?? 1
  if (!Number.isInteger(count) || count < 1 || count > 4) {
    throw new AppError('count 必须是 1-4 的整数', 'E_INVALID_FIELD')
  }
  const instruction = isNonEmptyString(body.instruction) ? body.instruction : null
  const size = reviewImageSize(typeof body.aspectRatio === 'string' ? body.aspectRatio : undefined)
  const productName = cleanOneLine(body.productName)
  const productImage = body.productImage.trim()
  const references = [portrait, productImage]

  logTaskStart('Influencer', 'review-images', { influencerId, scenes, count, size })
  const rows: ContentRow[] = []
  const ts = now()
  for (const scene of scenes) {
    const prompt = composeInfluencerReviewPrompt(scene, productName, instruction)
    for (let i = 0; i < count; i++) {
      const taskId = await generateImage({ prompt, size, referenceImages: references })
      const res = await db.insert(schema.studioInfluencerContents).values({
        influencerId,
        kind: 'image',
        productName,
        productImage,
        scene,
        instruction,
        prompt,
        taskId,
        createdAt: ts,
        updatedAt: ts,
      })
      const [row] = await db.select().from(schema.studioInfluencerContents).where(eq(schema.studioInfluencerContents.id, getInsertId(res)))
      rows.push(row)
    }
  }
  return rows.map(row => toContentJson(row, undefined))
}

export async function listInfluencerContents(influencerId: number) {
  const rows = await db.select().from(schema.studioInfluencerContents)
    .where(eq(schema.studioInfluencerContents.influencerId, influencerId))
    .orderBy(desc(schema.studioInfluencerContents.id))
  return Promise.all(rows.map(async (row) => {
    const [task] = row.taskId
      ? await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, row.taskId))
      : []
    return toContentJson(row, task)
  }))
}

export async function deleteInfluencerContent(influencerId: number, contentId: number): Promise<boolean> {
  const res = await db.delete(schema.studioInfluencerContents)
    .where(and(eq(schema.studioInfluencerContents.id, contentId), eq(schema.studioInfluencerContents.influencerId, influencerId)))
  return (res?.changes ?? 0) > 0
}

// ---------- Review script (async — agent influencer_writer, pattern เดียวกับ studio script) ----------

export async function generateReviewScript(influencerId: number, body: any) {
  const found = await getInfluencerWithTask(influencerId)
  if (!found) return null
  const textConfig = await getActiveConfig('text')
  if (!textConfig) throw new AppError('未配置文本模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_TEXT_MODEL')
  if (!isNonEmptyString(body.productName)) throw new AppError('productName 必填', 'E_INVALID_FIELD')

  const language = body.language !== undefined && body.language !== null
    ? requireEnum<StudioLanguage>(body.language, STUDIO_LANGUAGES, 'language')
    : (found.row.locale && STUDIO_LANGUAGES.includes(found.row.locale.toLowerCase() as StudioLanguage)
      ? (found.row.locale.toLowerCase() as StudioLanguage)
      : 'th')
  const platform = body.platform !== undefined && body.platform !== null
    ? requireEnum<StudioPlatform>(body.platform, STUDIO_PLATFORMS.map(p => p.id), 'platform')
    : 'tiktok'
  let durationSec = Math.round(Number(body.durationSec ?? 30))
  if (!Number.isFinite(durationSec)) durationSec = 30
  durationSec = Math.min(Math.max(durationSec, 10), 60)
  const productDescription = isNonEmptyString(body.productDescription) ? body.productDescription.trim() : null
  const instruction = isNonEmptyString(body.instruction) ? body.instruction : null
  const productName = cleanOneLine(body.productName)

  const key = `influencer_script:${influencerId}`
  const task = await startTask({ kind: 'influencer_script', key })
  if (!task) throw new AppError('กำลังเขียนสคริปต์รีวิวอยู่แล้ว กรุณารอสักครู่', 'E_INFLUENCER_BUSY')

  const ts = now()
  const res = await db.insert(schema.studioInfluencerContents).values({
    influencerId,
    kind: 'script',
    productName,
    instruction,
    language,
    platform,
    durationSec,
    createdAt: ts,
    updatedAt: ts,
  })
  const contentId = getInsertId(res)
  logTaskStart('Influencer', 'review-script', { influencerId, contentId, language, platform, durationSec })

  const message = [
    `【Influencer】`,
    `- Name: ${found.row.name}`,
    found.row.niche ? `- Niche: ${found.row.niche.replace(/_/g, ' ')}` : '',
    found.row.persona ? `- Persona: ${found.row.persona}` : '',
    found.row.tone ? `- Speaking tone: ${found.row.tone}` : '',
    `【Product】`,
    `- Name: ${productName}`,
    productDescription ? `- Description: ${productDescription}` : '',
    `【Requirements】`,
    `- Spoken language: ${language} — the whole script MUST be written in ${language}, nothing else.`,
    `- Platform: ${platform} · target spoken length ≈ ${durationSec} seconds.`,
    '- Structure: HOOK (first 2 seconds) → problem/why it matters → demo or proof from real use → CTA.',
    '- First-person, natural spoken style of a real creator reviewing a product they bought — no stage directions, no camera notes, no emoji, no markdown.',
    instruction ? `- User instruction: ${instruction}` : '',
    'Write the complete review script now as plain text. Mark each beat with a short bracket label like [HOOK] on its own line, followed by the spoken lines.',
  ].filter(Boolean).join('\n')

  ;(async () => {
    const agent = mastra.getAgent('influencer_writer')
    if (!agent) throw new Error('E_AGENT_UNAVAILABLE: influencer_writer Agent 不可用')
    const result: any = await agent.generate([{ role: 'user', content: message }], { maxSteps: 2 })
    const script = String(result?.text || '').trim()
    if (!script) throw new Error('influencer_writer returned an empty script')
    await db.update(schema.studioInfluencerContents)
      .set({ script, status: 'completed', errorMsg: null, updatedAt: now() })
      .where(eq(schema.studioInfluencerContents.id, contentId))
    await updateTask(key, { status: 'done', finishedAt: now() })
    logTaskSuccess('Influencer', 'review-script', { influencerId, contentId })
  })()
    .catch(async (err: any) => {
      const raw = err?.message || 'review script generation failed'
      const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
      await db.update(schema.studioInfluencerContents)
        .set({ status: 'failed', errorMsg: msg, updatedAt: now() })
        .where(eq(schema.studioInfluencerContents.id, contentId))
      await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
      logTaskError('Influencer', 'review-script', { influencerId, contentId, error: msg })
    })

  const [row] = await db.select().from(schema.studioInfluencerContents).where(eq(schema.studioInfluencerContents.id, contentId))
  return toContentJson(row, undefined)
}
