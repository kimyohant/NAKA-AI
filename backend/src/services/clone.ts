/**
 * Viral Clone Studio — โคลน "โครง" คลิปไวรัลเป็นตัวแปรโฆษณาหลายชุด (docs/viral-clone/PLAN.md)
 * - Blueprint: transcript (ผู้ใช้วางเอง) → LLM (agent `viral_cloner`) → JSON ตาม schema ข้อ 3 → validate → repair 1 ครั้ง
 * - Matrix: Cartesian ของ hook × product(Studio) × avatar × language — มุมว่าง = ค่า default (นับ 1 ทางเลือก) — cap 12/batch
 * - Render: reuse pipeline ของ Studio (drama/episode/storyboard + generateImage/generateVideo + คิว maxConcurrent
 *   + mergeEpisodeVideos + captions primitives) — ไม่สร้าง renderer ใหม่; kind `clone_render` + boot-resume ของตัวเอง
 * - ภาษาตัวแปร ≠ ภาษาโปรเจกต์ → แปล line/hooks ด้วย text provider ก่อน render เก็บใน overrides_json.translations[lang]
 */
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'
import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { AppError, now } from '../utils/response.js'
import { generateImage, generateVideo } from './generation.js'
import { getActiveConfig, getTextConfig } from './ai.js'
import { getActiveVideoProviderInfo, waitForMergeCompletion } from './studio.js'
import { clearEpisodeStoryboards } from './studio-shots.js'
import { mergeEpisodeVideos } from './ffmpeg-merge.js'
import {
  assertCaptionFontAvailable, buildCaptionCues, burnSubtitles, toAss, toSrt, aiLabelText, probeDurationSec,
} from './captions.js'
import { visualSizeFor } from './product-visuals.js'
import { mastra } from '../mastra/index.js'
import { startTask, updateTask, getTask, isCancelRequested } from './pipeline-tasks.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess, logTaskWarn } from '../utils/task-logger.js'
import { STORAGE_ROOT } from '../utils/paths.js'

export const CLONE_BEAT_ROLES = ['hook', 'demo', 'proof', 'offer', 'cta'] as const
export const CLONE_BEAT_VISUALS = ['product', 'avatar', 'broll', 'text'] as const
export const CLONE_CAPTION_STYLES = ['clean', 'bold', 'boxed'] as const
export const CLONE_MATRIX_CAP = 12
export const CLONE_MAX_TRANSCRIPT_LENGTH = 20_000

export type CloneBeatRole = typeof CLONE_BEAT_ROLES[number]
export type CloneBeatVisual = typeof CLONE_BEAT_VISUALS[number]

export interface CloneBeat {
  id: string
  role: string
  line: string
  visual: string
  visualHint: string | null
  durationSec: number
}

export interface CloneBlueprint {
  title?: string
  durationSec?: number
  beats: CloneBeat[]
  hooks?: string[]
  captionStyle?: { style?: string; enabled?: boolean } & Record<string, unknown>
}

const CLONE_RENDER_STAGES = ['prepare', 'keyframes', 'videos', 'merge'] as const
type CloneRenderStage = typeof CLONE_RENDER_STAGES[number]

interface CloneRenderState {
  variantId: number | null
  stage: CloneRenderStage
  taskIds: number[]
}

// ---------- serialization (camelCase เหมือน marketer/studio — สัญญา Agent B) ----------

type CloneProjectRow = typeof schema.cloneProjects.$inferSelect
type CloneVariantRow = typeof schema.cloneVariants.$inferSelect

function slashPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  return raw.startsWith('/') ? raw : `/${raw}`
}

function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function toCloneProjectJson(row: CloneProjectRow) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    referencePath: slashPath(row.referencePath),
    transcript: row.referenceTranscript,
    language: row.language,
    blueprint: row.blueprintJson ? parseJson<CloneBlueprint | null>(row.blueprintJson, null) : null,
    errorCode: row.errorCode,
    errorMsg: row.errorMsg,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

export function toCloneVariantJson(row: CloneVariantRow) {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    overrides: parseJson<Record<string, unknown>>(row.overridesJson, {}),
    status: row.status,
    outputPath: slashPath(row.outputPath),
    durationSec: row.durationSec,
    errorCode: row.errorCode,
    errorMsg: row.errorMsg,
    pipelineTaskId: row.pipelineTaskId,
    queuePosition: variantQueuePosition(row),
    episodeId: row.episodeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** ตำแหน่งคิว render (1-based) — นับตัวแปร queued ของโปรเจกต์เดียวกันที่เก่ากว่า; null เมื่อไม่ได้รอคิว */
export function variantQueuePosition(row: CloneVariantRow): number | null {
  if (row.status !== 'queued') return null
  const queued = db.select({ id: schema.cloneVariants.id }).from(schema.cloneVariants)
    .where(and(eq(schema.cloneVariants.projectId, row.projectId), eq(schema.cloneVariants.status, 'queued')))
    .all()
  const index = queued.findIndex(v => v.id === row.id)
  return index >= 0 ? index + 1 : null
}

// ---------- blueprint validation (Task 4) ----------

export function validateBlueprint(input: unknown): { ok: boolean; errors: string[] } {
  const errors: string[] = []
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: ['blueprint must be an object'] }
  }
  const bp = input as Record<string, any>
  if (bp.title !== undefined && (typeof bp.title !== 'string' || bp.title.length > 200)) {
    errors.push('title must be a string (≤200 chars)')
  }
  if (bp.durationSec !== undefined) {
    if (typeof bp.durationSec !== 'number' || !Number.isFinite(bp.durationSec) || bp.durationSec <= 0) {
      errors.push('durationSec must be a positive number')
    }
  }
  if (!Array.isArray(bp.beats) || bp.beats.length === 0) {
    errors.push('beats must be a non-empty array')
  } else {
    const ids = new Set<string>()
    bp.beats.forEach((beat: any, i: number) => {
      const label = `beats[${i}]`
      if (!beat || typeof beat !== 'object' || Array.isArray(beat)) {
        errors.push(`${label} must be an object`)
        return
      }
      if (typeof beat.id !== 'string' || !beat.id.trim()) errors.push(`${label}.id must be a non-empty string`)
      else if (ids.has(beat.id)) errors.push(`${label}.id duplicate: ${beat.id}`)
      else ids.add(beat.id)
      if (!CLONE_BEAT_ROLES.includes(beat.role)) errors.push(`${label}.role must be one of ${CLONE_BEAT_ROLES.join('|')}`)
      if (typeof beat.line !== 'string' || !beat.line.trim()) errors.push(`${label}.line must be a non-empty string`)
      if (!CLONE_BEAT_VISUALS.includes(beat.visual)) errors.push(`${label}.visual must be one of ${CLONE_BEAT_VISUALS.join('|')}`)
      if (beat.visualHint !== undefined && beat.visualHint !== null && typeof beat.visualHint !== 'string') {
        errors.push(`${label}.visualHint must be a string or null`)
      }
      if (typeof beat.durationSec !== 'number' || !Number.isFinite(beat.durationSec) || beat.durationSec <= 0) {
        errors.push(`${label}.durationSec must be a positive number`)
      }
    })
  }
  if (bp.hooks !== undefined) {
    if (!Array.isArray(bp.hooks) || bp.hooks.some((h: any) => typeof h !== 'string' || !h.trim())) {
      errors.push('hooks must be an array of non-empty strings')
    }
  }
  if (bp.captionStyle !== undefined && (bp.captionStyle === null || typeof bp.captionStyle !== 'object' || Array.isArray(bp.captionStyle))) {
    errors.push('captionStyle must be an object')
  } else if (bp.captionStyle?.style !== undefined && !CLONE_CAPTION_STYLES.includes(bp.captionStyle.style)) {
    errors.push(`captionStyle.style must be one of ${CLONE_CAPTION_STYLES.join('|')}`)
  }
  return { ok: errors.length === 0, errors }
}

function normalizeBlueprint(input: Record<string, any>): CloneBlueprint {
  const beats: CloneBeat[] = (input.beats as any[]).map((beat, i) => ({
    id: String(beat.id ?? `b${i + 1}`),
    role: beat.role,
    line: String(beat.line ?? '').trim(),
    visual: beat.visual,
    visualHint: beat.visualHint === undefined || beat.visualHint === null || String(beat.visualHint).trim() === ''
      ? null
      : String(beat.visualHint).trim(),
    durationSec: Number(beat.durationSec),
  }))
  const bp: CloneBlueprint = { beats }
  if (typeof input.title === 'string' && input.title.trim()) bp.title = input.title.trim()
  if (typeof input.durationSec === 'number' && Number.isFinite(input.durationSec)) bp.durationSec = input.durationSec
  if (Array.isArray(input.hooks)) bp.hooks = (input.hooks as any[]).map(h => String(h).trim()).filter(Boolean)
  if (input.captionStyle && typeof input.captionStyle === 'object') {
    bp.captionStyle = { ...input.captionStyle }
  }
  return bp
}

// ---------- beat merging (Task 6 — beat สั้นกว่า minDurationSec รวมติดกัน ความยาวรวมคงเดิม) ----------

/**
 * รวม beat ที่สั้นกว่า minDurationSec เข้า beat ติดกัน (คู่ผลรวมน้อยสุด เสมอกันเลือกซ้าย)
 * — กลยุทธ์เดียวกับ scaleBeats ของ Studio แต่ทำงานบน beat float ของ Blueprint (ไม่ scale ตาม target)
 */
export function mergeShortBeats(beats: CloneBeat[], minDurationSec?: number | null): CloneBeat[] {
  const minSeconds = minDurationSec && minDurationSec > 0 ? Math.ceil(minDurationSec - 1e-9) : 0
  const merged = beats.map(beat => ({ ...beat }))
  if (minSeconds <= 1 || !merged.some(b => b.durationSec < minSeconds)) return merged
  while (merged.length > 1 && merged.some(b => b.durationSec < minSeconds)) {
    let bestIdx = -1
    let bestSum = Infinity
    for (let i = 0; i < merged.length - 1; i++) {
      const sum = merged[i].durationSec + merged[i + 1].durationSec
      if (sum < bestSum) {
        bestSum = sum
        bestIdx = i
      }
    }
    if (bestIdx < 0) break
    const a = merged[bestIdx]
    const b = merged[bestIdx + 1]
    merged.splice(bestIdx, 2, {
      ...a,
      line: [a.line, b.line].filter(Boolean).join(' '),
      visualHint: [a.visualHint, b.visualHint].filter(Boolean).join(' — ') || null,
      durationSec: a.durationSec + b.durationSec,
    })
  }
  return merged
}

// ---------- matrix (Task 5) ----------

export interface CloneMatrixInput {
  hookIndexes?: unknown
  productIds?: unknown
  avatarIds?: unknown
  languages?: unknown
}

function angleList<T>(raw: unknown, map: (v: any) => T | null): T[] {
  if (!Array.isArray(raw)) return []
  return raw.map(map).filter((v): v is T => v !== null)
}

/**
 * Cartesian ของ hookIndexes × productIds × avatarIds × languages — **มุมใดว่าง = [default] ไม่ใช่ 0 ทางเลือก**
 * (hookIndex null = ใช้ hook เดิมของ blueprint, productId/avatarId null = ไม่ override, language = ของโปรเจกต์)
 */
export function buildMatrix(
  matrix: CloneMatrixInput,
  defaults: { language: string },
): { combos: Array<{ hookIndex: number | null; productId: number | null; avatarId: number | null; language: string }>; count: number } {
  const hookIndexes = angleList<number>(matrix.hookIndexes, v => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 0 ? n : null
  })
  const productIds = angleList<number>(matrix.productIds, v => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 ? n : null
  })
  const avatarIds = angleList<number>(matrix.avatarIds, v => {
    const n = Number(v)
    return Number.isInteger(n) && n >= 1 ? n : null
  })
  const languages = angleList<string>(matrix.languages, v => (typeof v === 'string' && v.trim() ? v.trim() : null))

  const hooks = hookIndexes.length ? [...new Set(hookIndexes)] : [null]
  const products = productIds.length ? [...new Set(productIds)] : [null]
  const avatars = avatarIds.length ? [...new Set(avatarIds)] : [null]
  const langs = (languages.length ? [...new Set(languages)] : [defaults.language])

  const combos: Array<{ hookIndex: number | null; productId: number | null; avatarId: number | null; language: string }> = []
  for (const hookIndex of hooks) {
    for (const productId of products) {
      for (const avatarId of avatars) {
        for (const language of langs) {
          combos.push({ hookIndex, productId, avatarId, language })
        }
      }
    }
  }
  return { combos, count: combos.length }
}

function buildVariantLabel(
  combo: { hookIndex: number | null; productId: number | null; avatarId: number | null; language: string },
  productNames: Map<number, string>,
  avatarNames: Map<number, string>,
  used: Set<string>,
): string {
  const parts = [
    combo.hookIndex !== null ? `hook${combo.hookIndex + 1}` : 'hook',
    combo.productId !== null ? (productNames.get(combo.productId) ?? `product${combo.productId}`) : 'noproduct',
    combo.avatarId !== null ? (avatarNames.get(combo.avatarId) ?? `avatar${combo.avatarId}`) : 'noavatar',
    combo.language,
  ]
  let label = parts.map(p => p.slice(0, 24)).join(' · ')
  let n = 2
  while (used.has(label)) {
    label = `${parts.map(p => p.slice(0, 24)).join(' · ')} #${n}`
    n += 1
  }
  used.add(label)
  return label
}

// ---------- CRUD (Task 2) ----------

async function getCloneProjectRow(id: number): Promise<CloneProjectRow | null> {
  const [row] = await db.select().from(schema.cloneProjects).where(eq(schema.cloneProjects.id, id))
  return row ?? null
}

async function getCloneVariantRow(id: number): Promise<CloneVariantRow | null> {
  const [row] = await db.select().from(schema.cloneVariants).where(eq(schema.cloneVariants.id, id))
  return row ?? null
}

export async function listCloneProjects() {
  const rows = await db.select().from(schema.cloneProjects).orderBy(desc(schema.cloneProjects.updatedAt))
  return rows.map(toCloneProjectJson)
}

export async function createCloneProject(body: any) {
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : ''
  if (!name) throw new AppError('name 必填', 'E_INVALID_FIELD')
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''
  if (!transcript) throw new AppError('transcript 必填 — วาง transcript ของคลิปต้นแบบก่อน (ระบบไม่มี ASR และไม่ดึงคลิปจากแพลตฟอร์ม)', 'E_INVALID_FIELD')
  if (transcript.length > CLONE_MAX_TRANSCRIPT_LENGTH) {
    throw new AppError(`transcript ยาวเกิน ${CLONE_MAX_TRANSCRIPT_LENGTH} ตัวอักษร`, 'E_INVALID_FIELD')
  }
  const language = typeof body.language === 'string' && body.language.trim() ? body.language.trim() : 'th'
  const referencePath = typeof body.referencePath === 'string' && body.referencePath.trim() ? body.referencePath.trim() : null

  const ts = now()
  const res = await db.insert(schema.cloneProjects).values({
    name,
    status: 'draft',
    referencePath,
    referenceTranscript: transcript,
    language,
    blueprintJson: null,
    createdAt: ts,
    updatedAt: ts,
  })
  const row = await getCloneProjectRow(getInsertId(res))
  return row ? toCloneProjectJson(row) : null
}

export async function getCloneProjectDetail(id: number) {
  const row = await getCloneProjectRow(id)
  if (!row) return null
  const variants = await db.select().from(schema.cloneVariants)
    .where(eq(schema.cloneVariants.projectId, id))
    .orderBy(schema.cloneVariants.id)
  return {
    ...toCloneProjectJson(row),
    variants: variants.map(toCloneVariantJson),
  }
}

export async function updateCloneProject(id: number, body: any) {
  const row = await getCloneProjectRow(id)
  if (!row) return null
  if (row.status === 'analyzing') throw new AppError('กำลังวิเคราะห์ Blueprint อยู่ กรุณารอสักครู่', 'E_CLONE_BUSY')
  const updates: Partial<typeof schema.cloneProjects.$inferInsert> = { updatedAt: now() }
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) throw new AppError('name 必填', 'E_INVALID_FIELD')
    updates.name = body.name.trim()
  }
  if (body.transcript !== undefined) {
    const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : ''
    if (!transcript) throw new AppError('transcript 必填', 'E_INVALID_FIELD')
    if (transcript.length > CLONE_MAX_TRANSCRIPT_LENGTH) {
      throw new AppError(`transcript ยาวเกิน ${CLONE_MAX_TRANSCRIPT_LENGTH} ตัวอักษร`, 'E_INVALID_FIELD')
    }
    updates.referenceTranscript = transcript
  }
  if (body.language !== undefined) {
    if (typeof body.language !== 'string' || !body.language.trim()) throw new AppError('language ไม่ถูกต้อง', 'E_INVALID_FIELD')
    updates.language = body.language.trim()
  }
  if (body.referencePath !== undefined) {
    updates.referencePath = typeof body.referencePath === 'string' && body.referencePath.trim() ? body.referencePath.trim() : null
  }
  await db.update(schema.cloneProjects).set(updates).where(eq(schema.cloneProjects.id, id))
  const updated = await getCloneProjectRow(id)
  return updated ? toCloneProjectJson(updated) : null
}

export async function getCloneVariantDetail(id: number) {
  const row = await getCloneVariantRow(id)
  if (!row) return null
  return toCloneVariantJson(row)
}

export async function deleteCloneProject(id: number) {
  const row = await getCloneProjectRow(id)
  if (!row) return false
  if (row.status === 'analyzing') throw new AppError('กำลังวิเคราะห์ Blueprint อยู่ — รอจบหรือรีสตาร์ทเซิร์ฟเวอร์ก่อนลบ', 'E_CLONE_BUSY')
  const busy = await db.select({ id: schema.cloneVariants.id }).from(schema.cloneVariants)
    .where(and(eq(schema.cloneVariants.projectId, id), inArray(schema.cloneVariants.status, ['queued', 'rendering'])))
  if (busy.length) throw new AppError('มีตัวแปรที่กำลัง render อยู่ — รอจบก่อนลบโปรเจกต์', 'E_CLONE_BUSY')
  await db.delete(schema.cloneVariants).where(eq(schema.cloneVariants.projectId, id))
  await db.delete(schema.cloneProjects).where(eq(schema.cloneProjects.id, id))
  return true
}

export async function deleteCloneVariant(id: number) {
  const row = await getCloneVariantRow(id)
  if (!row) return false
  if (row.status === 'queued' || row.status === 'rendering') {
    throw new AppError('ตัวแปรกำลังรอ/กำลัง render — ลบไม่ได้ระหว่างงานวิ่ง', 'E_CLONE_BUSY')
  }
  await db.delete(schema.cloneVariants).where(eq(schema.cloneVariants.id, id))
  return true
}

// ---------- analyze (Task 3 — async 202 + repair 1 ครั้ง) ----------

function extractJsonObject(text: string): Record<string, any> {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('response does not contain a JSON object')
  return JSON.parse(cleaned.slice(start, end + 1))
}

function analyzeMessage(transcript: string, language: string): string {
  return [
    `【Transcript of the original viral clip (${language})】`,
    transcript,
    '',
    'Convert this transcript into the Blueprint JSON per your instructions. Reply with ONLY the JSON object.',
  ].join('\n')
}

function repairMessage(previousJson: unknown, errors: string[]): string {
  return [
    'Your previous Blueprint JSON failed schema validation.',
    `【Validation errors】\n- ${errors.join('\n- ')}`,
    `【Previous JSON】\n${JSON.stringify(previousJson)}`,
    'Fix the errors and reply with ONLY the corrected JSON object (same contract).',
  ].join('\n\n')
}

async function runCloneAnalyze(projectId: number, key: string) {
  const project = await getCloneProjectRow(projectId)
  if (!project) {
    await updateTask(key, { status: 'error', errorMsg: 'E_TASK_INTERRUPTED: project missing', finishedAt: now() })
    return
  }
  const agent = mastra.getAgent('viral_cloner')
  if (!agent) throw new AppError('viral_cloner Agent 不可用', 'E_AGENT_UNAVAILABLE')

  let blueprint: CloneBlueprint | null = null
  let lastErrors: string[] = []
  try {
    const first = await agent.generate([{ role: 'user', content: analyzeMessage(project.referenceTranscript, project.language) }], { maxSteps: 2 })
    const parsed = extractJsonObject((first as any)?.text || '')
    const check = validateBlueprint(parsed)
    if (check.ok) {
      blueprint = normalizeBlueprint(parsed)
    } else {
      lastErrors = check.errors
      logTaskWarn('Clone', 'analyze-repair', { projectId, errors: check.errors.join('; ') })
      const second = await agent.generate([{ role: 'user', content: repairMessage(parsed, check.errors) }], { maxSteps: 2 })
      const repaired = extractJsonObject((second as any)?.text || '')
      const check2 = validateBlueprint(repaired)
      if (check2.ok) {
        blueprint = normalizeBlueprint(repaired)
      } else {
        lastErrors = check2.errors
      }
    }
    if (!blueprint) {
      throw new Error(`schema validation failed: ${lastErrors.slice(0, 3).join('; ') || 'invalid JSON from model'}`)
    }
    await db.update(schema.cloneProjects)
      .set({ status: 'ready', blueprintJson: JSON.stringify(blueprint), errorCode: null, errorMsg: null, updatedAt: now() })
      .where(eq(schema.cloneProjects.id, projectId))
    await updateTask(key, { status: 'done', finishedAt: now() })
    logTaskSuccess('Clone', 'analyze', { projectId, beats: blueprint.beats.length, hooks: blueprint.hooks?.length ?? 0 })
  } catch (err: any) {
    const detail = lastErrors.length ? lastErrors.slice(0, 3).join('; ') : String(err?.message || 'analyze failed')
    const msg = `E_CLONE_ANALYZE_FAILED: วิเคราะห์ transcript เป็น Blueprint ไม่สำเร็จ (${detail})`.slice(0, 500)
    await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
    await db.update(schema.cloneProjects)
      .set({ status: 'error', errorCode: 'E_CLONE_ANALYZE_FAILED', errorMsg: msg, updatedAt: now() })
      .where(eq(schema.cloneProjects.id, projectId))
    logTaskError('Clone', 'analyze', { projectId, error: msg })
  }
}

/** 202 + pipeline_tasks (pattern เดียวกับ revise/analyze ของ unsloth) — async หรือ sync ตาม body */
export async function analyzeCloneProject(projectId: number, opts: { async?: boolean } = {}) {
  const row = await getCloneProjectRow(projectId)
  if (!row) return null
  const key = `clone_analyze:${projectId}`
  const task = await startTask({ kind: 'clone_analyze', key })
  if (!task) throw new AppError('กำลังวิเคราะห์ Blueprint อยู่แล้ว กรุณารอสักครู่', 'E_CLONE_BUSY')
  await getTextConfig() // ไม่มี text model → fail ก่อนเปลี่ยนสถานะ (E_NO_TEXT_MODEL)
  await db.update(schema.cloneProjects)
    .set({ status: 'analyzing', errorCode: null, errorMsg: null, updatedAt: now() })
    .where(eq(schema.cloneProjects.id, projectId))
  logTaskStart('Clone', 'analyze', { projectId, async: opts.async !== false })

  if (opts.async === false) {
    try {
      await runCloneAnalyze(projectId, key)
    } finally {
      // sync mode: task status จัดการใน runCloneAnalyze เอง
    }
  } else {
    void runCloneAnalyze(projectId, key).catch(async (err: any) => {
      const raw = err?.message || 'analyze failed'
      const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
      await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
      await db.update(schema.cloneProjects)
        .set({ status: 'error', errorCode: 'E_CLONE_ANALYZE_FAILED', errorMsg: msg, updatedAt: now() })
        .where(eq(schema.cloneProjects.id, projectId))
      logTaskError('Clone', 'analyze', { projectId, error: msg })
    })
  }
  const updated = await getCloneProjectRow(projectId)
  return updated ? toCloneProjectJson(updated) : null
}

/** boot: analyzing ค้างที่ไม่มี pipeline row วิ่งอยู่ (failStaleRunningTasks เคลียร์ row ไปแล้ว) → error */
export async function failStaleCloneAnalyzes(): Promise<number> {
  const rows = await db.select().from(schema.cloneProjects).where(eq(schema.cloneProjects.status, 'analyzing'))
  if (!rows.length) return 0
  let fixed = 0
  for (const row of rows) {
    const running = await getTask(`clone_analyze:${row.id}`)
    if (running?.status === 'running') continue
    const msg = 'E_TASK_INTERRUPTED: 服务重启，任务中断，请重试'
    await db.update(schema.cloneProjects)
      .set({ status: 'error', errorCode: 'E_CLONE_ANALYZE_FAILED', errorMsg: msg, updatedAt: now() })
      .where(eq(schema.cloneProjects.id, row.id))
    fixed += 1
  }
  return fixed
}

// ---------- blueprint save (Task 4) ----------

export async function saveCloneBlueprint(projectId: number, input: unknown) {
  const row = await getCloneProjectRow(projectId)
  if (!row) return null
  if (row.status === 'analyzing') throw new AppError('กำลังวิเคราะห์ Blueprint อยู่ — บันทึกไม่ได้ระหว่างวิเคราะห์', 'E_CLONE_BUSY')
  const check = validateBlueprint(input)
  if (!check.ok) {
    throw new AppError(`Blueprint ไม่ผ่าน schema: ${check.errors.join('; ')}`, 'E_INVALID_FIELD')
  }
  const blueprint = normalizeBlueprint(input as Record<string, any>)
  await db.update(schema.cloneProjects)
    .set({ blueprintJson: JSON.stringify(blueprint), status: 'ready', errorCode: null, errorMsg: null, updatedAt: now() })
    .where(eq(schema.cloneProjects.id, projectId))
  const updated = await getCloneProjectRow(projectId)
  return updated ? toCloneProjectJson(updated) : null
}

// ---------- variants: matrix → rows (Task 5) ----------

export async function createCloneVariants(projectId: number, body: any) {
  const project = await getCloneProjectRow(projectId)
  if (!project) return null
  const blueprint = parseJson<CloneBlueprint | null>(project.blueprintJson, null)
  if (!blueprint) throw new AppError('ยังไม่มี Blueprint — กดวิเคราะห์ก่อนสร้างตัวแปร', 'E_CLONE_ANALYZE_FAILED')
  const matrix = (body?.matrix && typeof body.matrix === 'object' && !Array.isArray(body.matrix)) ? body.matrix : body ?? {}
  const { combos, count } = buildMatrix(matrix as CloneMatrixInput, { language: project.language })
  if (count > CLONE_MATRIX_CAP) {
    throw new AppError(`matrix ได้ ${count} ตัวแปร — เกินลิมิต ${CLONE_MATRIX_CAP} ต่อ batch (ลดมุมใดมุมหนึ่งหรือสร้างเป็นหลายรอบ)`, 'E_CLONE_MATRIX_TOO_LARGE')
  }

  // ตรวจ productId/avatarId มีจริง (ไม่ทำ FK แข็ง — ตาม PLAN ข้อ 3)
  const productIds = combos.map(c => c.productId).filter((v): v is number => v !== null)
  const avatarIds = combos.map(c => c.avatarId).filter((v): v is number => v !== null)
  const productNames = new Map<number, string>()
  if (productIds.length) {
    const rows = await db.select().from(schema.studioProjects)
      .where(and(inArray(schema.studioProjects.id, productIds), isNull(schema.studioProjects.deletedAt)))
    for (const r of rows) productNames.set(r.id, r.productName?.trim() || r.title)
  }
  const missingProducts = [...new Set(productIds)].filter(id => !productNames.has(id))
  if (missingProducts.length) {
    throw new AppError(`productId ไม่พบใน Product Studio: ${missingProducts.join(', ')}`, 'E_INVALID_FIELD')
  }
  const avatarNames = new Map<number, string>()
  if (avatarIds.length) {
    const rows = await db.select().from(schema.studioAvatars)
      .where(and(inArray(schema.studioAvatars.id, avatarIds), isNull(schema.studioAvatars.deletedAt)))
    for (const r of rows) avatarNames.set(r.id, r.name)
  }
  const missingAvatars = [...new Set(avatarIds)].filter(id => !avatarNames.has(id))
  if (missingAvatars.length) {
    throw new AppError(`avatarId ไม่พบ: ${missingAvatars.join(', ')}`, 'E_INVALID_FIELD')
  }

  const existing = await db.select({ label: schema.cloneVariants.label }).from(schema.cloneVariants)
    .where(eq(schema.cloneVariants.projectId, projectId))
  const used = new Set(existing.map(r => r.label))
  const ts = now()
  const created: ReturnType<typeof toCloneVariantJson>[] = []
  for (const combo of combos) {
    const label = buildVariantLabel(combo, productNames, avatarNames, used)
    const res = await db.insert(schema.cloneVariants).values({
      projectId,
      label,
      overridesJson: JSON.stringify({
        hookIndex: combo.hookIndex,
        productId: combo.productId,
        avatarId: combo.avatarId,
        language: combo.language,
      }),
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    })
    const row = await getCloneVariantRow(getInsertId(res))
    if (row) created.push(toCloneVariantJson(row))
  }
  logTaskStart('Clone', 'variants', { projectId, count: created.length })
  return created
}

// ---------- render path (Task 6 — reuse pipeline เดิม) ----------

/** ภาพ/วิดีโอจบหรือล้มครบ (queued/submitting/processing ยังวิ่งอยู่ → รอ) */
async function waitTasksSettle(taskIds: number[]): Promise<void> {
  if (!taskIds.length) return
  for (;;) {
    const rows = await db.select().from(schema.sysTask).where(inArray(schema.sysTask.id, taskIds))
    const inFlight = rows.filter(r => ['queued', 'submitting', 'processing'].includes(r.status || ''))
    if (!inFlight.length) return
    await new Promise(r => setTimeout(r, 5_000))
  }
}

/** งานล้ม (failed/unknown) → throw พร้อม "E_CODE: message" ของงานแรก เพื่อลง error_code ให้ตัวแปร */
async function assertTasksOk(taskIds: number[]): Promise<void> {
  const rows = await db.select().from(schema.sysTask).where(inArray(schema.sysTask.id, taskIds))
  const failed = rows.find(r => r.status === 'failed' || r.status === 'unknown')
  if (failed) {
    const code = failed.errorCode || 'E_RENDER_TASK_FAILED'
    const message = failed.errorMsg || 'generation task failed'
    throw Object.assign(new Error(message.startsWith(code) ? message : `${code}: ${message}`), { errorCode: code })
  }
}

function toAbs(rel: string): string {
  if (path.isAbsolute(rel)) return rel
  if (rel.startsWith('static/')) return path.join(STORAGE_ROOT, '..', rel)
  return path.join(STORAGE_ROOT, rel)
}

/** beat ของ variant หลัง apply overrides (hook/ภาษา/แปล) — deterministic (render ซ้ำได้ผลเดิม) */
function resolveVariantBeats(
  project: CloneProjectRow,
  variant: CloneVariantRow,
  translations: { lines?: Record<string, string>; hooks?: string[] } | null,
): CloneBeat[] {
  const blueprint = parseJson<CloneBlueprint | null>(project.blueprintJson, null)
  if (!blueprint?.beats?.length) throw new AppError('ยังไม่มี Blueprint — กดวิเคราะห์ก่อน render', 'E_CLONE_ANALYZE_FAILED')
  const overrides = parseJson<Record<string, any>>(variant.overridesJson, {})
  let beats: CloneBeat[] = blueprint.beats.map(beat => ({ ...beat }))
  let hooks = [...(blueprint.hooks ?? [])]

  // ภาษาตัวแปร ≠ ภาษาโปรเจกต์ → ใช้คำแปลที่เก็บไว้ใน overrides_json.translations[lang]
  const language = typeof overrides.language === 'string' && overrides.language ? overrides.language : project.language
  if (language !== project.language) {
    if (!translations) throw new AppError('ยังไม่ได้แปลข้อความสำหรับภาษาของตัวแปรนี้', 'E_CLONE_TRANSLATE_FAILED')
    for (const beat of beats) {
      const translated = translations.lines?.[beat.id]
      if (translated) beat.line = translated
    }
    if (translations.hooks?.length) hooks = translations.hooks
  }

  // hookIndex → แทน line ของ beat แรกที่ role hook
  if (overrides.hookIndex !== null && overrides.hookIndex !== undefined) {
    const hookText = hooks[Number(overrides.hookIndex)]
    if (typeof hookText !== 'string' || !hookText.trim()) {
      throw new AppError(`hookIndex ${overrides.hookIndex} ไม่มีใน Blueprint hooks`, 'E_INVALID_FIELD')
    }
    const hookBeat = beats.find(b => b.role === 'hook') ?? beats[0]
    hookBeat.line = hookText.trim()
  }
  return beats
}

function buildBeatPrompts(
  beat: CloneBeat,
  ctx: { language: string; productName: string | null; productDescription: string | null; avatarName: string | null; avatarDescription: string | null },
): { imagePrompt: string; videoPrompt: string } {
  const product = ctx.productName ? `Product: ${ctx.productName}${ctx.productDescription ? ` — ${ctx.productDescription}` : ''}.` : ''
  const presenter = ctx.avatarName
    ? ` Featured presenter: ${ctx.avatarName}${ctx.avatarDescription ? ` — ${ctx.avatarDescription}` : ''}. Keep the presenter consistent with the avatar reference image.`
    : ''
  const visual = beat.visualHint ? `${beat.visual}. ${beat.visualHint}` : beat.visual
  const imagePrompt = [
    `UGC-style keyframe for a short ad (${beat.role}): ${visual}.`,
    product,
    presenter.trim(),
    'Vertical 9:16 composition. No random brand logos or watermarks.',
  ].filter(Boolean).join(' ')
  const videoPrompt = [
    `Short ad shot (${beat.role}, ~${Math.round(beat.durationSec)}s). Visual: ${visual}.`,
    presenter.trim(),
    product,
    `The presenter speaks in ${ctx.language} — the voice-over MUST be exactly these words, nothing else: "${beat.line}"`,
    'No added text, logos or watermarks.',
  ].filter(Boolean).join(' ')
  return { imagePrompt, videoPrompt }
}

async function renderContext(project: CloneProjectRow, variant: CloneVariantRow) {
  const overrides = parseJson<Record<string, any>>(variant.overridesJson, {})
  let productName: string | null = null
  let productDescription: string | null = null
  const productImages: string[] = []
  if (overrides.productId) {
    const [product] = await db.select().from(schema.studioProjects)
      .where(and(eq(schema.studioProjects.id, Number(overrides.productId)), isNull(schema.studioProjects.deletedAt)))
    if (product) {
      productName = product.productName?.trim() || product.title
      productDescription = product.productDescription ?? null
      const images = product.productImages ? (JSON.parse(product.productImages) as string[]) : []
      productImages.push(...images.slice(0, 3))
    }
  }
  let avatarName: string | null = null
  let avatarDescription: string | null = null
  if (overrides.avatarId) {
    const [avatar] = await db.select().from(schema.studioAvatars)
      .where(and(eq(schema.studioAvatars.id, Number(overrides.avatarId)), isNull(schema.studioAvatars.deletedAt)))
    if (avatar) {
      avatarName = avatar.name
      avatarDescription = avatar.description ?? null
      if (avatar.imageUrl) productImages.push(avatar.imageUrl.replace(/^\//, ''))
    }
  }
  return { productName, productDescription, avatarName, avatarDescription, productImages }
}

/** แปล line/hooks เมื่อภาษาตัวแปร ≠ ภาษาโปรเจกต์ — เก็บผลใน overrides_json.translations[lang] (Agent A decision, ดู Notes) */
async function translateVariantLines(
  project: CloneProjectRow,
  variant: CloneVariantRow,
  blueprint: CloneBlueprint,
): Promise<{ lines: Record<string, string>; hooks: string[] }> {
  const overrides = parseJson<Record<string, any>>(variant.overridesJson, {})
  const language = typeof overrides.language === 'string' && overrides.language ? overrides.language : project.language
  const cached = overrides.translations?.[language]
  if (cached?.lines && cached?.hooks) return cached

  const agent = mastra.getAgent('viral_translator')
  if (!agent) throw new AppError('viral_translator Agent 不可用', 'E_AGENT_UNAVAILABLE')
  const lines: Record<string, string> = {}
  for (const beat of blueprint.beats) lines[beat.id] = beat.line
  const payload = { sourceLanguage: project.language, targetLanguage: language, lines, hooks: blueprint.hooks ?? [] }
  const result = await agent.generate(
    [{ role: 'user', content: `Translate every value to ${language} (keep tone, length and meaning). Reply with ONLY JSON {"lines": {...same keys...}, "hooks": [...]}. Input: ${JSON.stringify(payload)}` }],
    { maxSteps: 2 },
  )
  const parsed = extractJsonObject((result as any)?.text || '')
  const translated = {
    lines: (parsed.lines && typeof parsed.lines === 'object' ? parsed.lines : lines) as Record<string, string>,
    hooks: (Array.isArray(parsed.hooks) ? parsed.hooks : payload.hooks).map((h: any) => String(h)),
  }
  overrides.translations = { ...(overrides.translations ?? {}), [language]: translated }
  await db.update(schema.cloneVariants)
    .set({ overridesJson: JSON.stringify(overrides), updatedAt: now() })
    .where(eq(schema.cloneVariants.id, variant.id))
  return translated
}

async function burnCloneCaptions(
  project: CloneProjectRow,
  variant: CloneVariantRow,
  beats: CloneBeat[],
  mergeRow: typeof schema.videoMerges.$inferSelect,
): Promise<string | null> {
  const blueprint = parseJson<CloneBlueprint | null>(project.blueprintJson, null)
  const style = (blueprint?.captionStyle?.style as string) ?? 'bold'
  if (blueprint?.captionStyle?.enabled === false) return null
  const language = (parseJson<Record<string, any>>(variant.overridesJson, {}).language as string) || project.language
  assertCaptionFontAvailable(language)
  if (!mergeRow.mergedUrl) throw new Error('merge output missing')

  const storyboards = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, variant.episodeId ?? -1))
    .orderBy(schema.storyboards.storyboardNumber)
  // beats ผ่าน mergeShortBeats แล้ว → จำนวนตรงกับ storyboards (เรียงตาม number) — cue ใช้ line ของ beat
  const inputs = storyboards.map((sb, i) => ({
    text: beats[i]?.line ?? null,
    clipPath: sb.videoUrl ? toAbs(sb.videoUrl) : null,
  }))
  const cues = await buildCaptionCues(inputs, language, '9:16')
  if (!cues.length) return null

  const srtRel = `static/merged/${uuid()}.srt`
  const assRel = `static/merged/${uuid()}.ass`
  fs.writeFileSync(toAbs(srtRel), toSrt(cues), 'utf-8')
  fs.writeFileSync(toAbs(assRel), toAss(cues, {
    style: (CLONE_CAPTION_STYLES.includes(style as any) ? style : 'bold') as 'clean' | 'bold' | 'boxed',
    language,
    aspectRatio: '9:16',
    aiLabelText: null,
    totalDurationSec: cues[cues.length - 1].end,
  }), 'utf-8')

  const outputRel = `static/merged/${uuid()}.mp4`
  await burnSubtitles(toAbs(mergeRow.mergedUrl), toAbs(assRel), toAbs(outputRel))
  logTaskProgress('Clone', 'captions-burned', { variantId: variant.id, srt: srtRel })
  return outputRel
}

async function saveRenderState(projectId: number, state: CloneRenderState) {
  await db.update(schema.cloneProjects)
    .set({ renderState: JSON.stringify(state), updatedAt: now() })
    .where(eq(schema.cloneProjects.id, projectId))
}

/** render ตัวแปร 1 ตัว → keyframes → คลิป → merge → captions → completed/failed (งานล้มไม่หยุด batch) */
async function renderSingleVariant(project: CloneProjectRow, variant: CloneVariantRow, key: string, imageConfigId: number | undefined, videoConfigId: number | undefined): Promise<void> {
  const blueprint = parseJson<CloneBlueprint | null>(project.blueprintJson, null)
  if (!blueprint) throw new AppError('ยังไม่มี Blueprint', 'E_CLONE_ANALYZE_FAILED')
  const providerInfo = await getActiveVideoProviderInfo()
  const minDurationSec = providerInfo?.minDurationSec ?? null
  const overrides = parseJson<Record<string, any>>(variant.overridesJson, {})
  const language = typeof overrides.language === 'string' && overrides.language ? overrides.language : project.language

  await db.update(schema.cloneVariants)
    .set({ status: 'rendering', errorCode: null, errorMsg: null, updatedAt: now() })
    .where(eq(schema.cloneVariants.id, variant.id))

  try {
    // ภาษาต่างจากโปรเจกต์ → แปลก่อน (เก็บ cache ใน overrides_json.translations)
    let translations: { lines: Record<string, string>; hooks: string[] } | null = null
    if (language !== project.language) translations = await translateVariantLines(project, variant, blueprint)

    let beats = resolveVariantBeats(project, variant, translations)
    beats = mergeShortBeats(beats, minDurationSec).map(beat => ({
      ...beat,
      durationSec: Math.max(1, Math.round(beat.durationSec)),
    }))

    // drama/episode ของตัวแปร (reuse pipeline ของ Studio — storyboards เป็นที่อยู่ของงาน image/video)
    const ts = now()
    const dramaRes = await db.insert(schema.dramas).values({
      title: `${project.name} — ${variant.label}`,
      aspectRatio: '9:16',
      metadata: JSON.stringify({ cloneProjectId: project.id, cloneVariantId: variant.id }),
      status: 'draft',
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const dramaId = getInsertId(dramaRes)
    const [imageConfig, videoConfig] = await Promise.all([
      getActiveConfig('image'), getActiveConfig('video'),
    ])
    const epRes = await db.insert(schema.episodes).values({
      dramaId,
      episodeNumber: 1,
      title: variant.label,
      status: 'draft',
      resolution: '720p',
      imageConfigId: imageConfigId ?? imageConfig?.id ?? null,
      videoConfigId: videoConfigId ?? videoConfig?.id ?? null,
      createdAt: ts,
      updatedAt: ts,
    }).run()
    const episodeId = getInsertId(epRes)
    await db.update(schema.cloneVariants).set({ episodeId, updatedAt: now() }).where(eq(schema.cloneVariants.id, variant.id))

    const ctx = await renderContext(project, variant)
    await clearEpisodeStoryboards(episodeId)
    const storyboardIds: number[] = []
    for (let i = 0; i < beats.length; i++) {
      const beat = beats[i]
      const prompts = buildBeatPrompts(beat, { language, ...ctx })
      const res = await db.insert(schema.storyboards).values({
        episodeId,
        storyboardNumber: i + 1,
        title: beat.role,
        description: beat.visualHint ?? beat.line,
        duration: beat.durationSec,
        imagePrompt: prompts.imagePrompt,
        videoPrompt: prompts.videoPrompt,
        status: 'pending',
        createdAt: ts,
        updatedAt: ts,
      }).run()
      storyboardIds.push(getInsertId(res))
    }

    // stage 1: keyframes (first_frame) — refs จาก productImages/avatar ของตัวแปร
    const keyframeTaskIds: number[] = []
    for (let i = 0; i < beats.length; i++) {
      const id = await generateImage({
        storyboardId: storyboardIds[i],
        dramaId,
        prompt: (await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardIds[i])))[0].imagePrompt || '',
        size: visualSizeFor('9:16', 'on_model'),
        referenceImages: ctx.productImages.length ? ctx.productImages : undefined,
        frameType: 'first_frame',
        configId: imageConfigId,
      })
      keyframeTaskIds.push(id)
    }
    await saveRenderState(project.id, { variantId: variant.id, stage: 'keyframes', taskIds: keyframeTaskIds })
    await waitTasksSettle(keyframeTaskIds)
    await assertTasksOk(keyframeTaskIds)

    // stage 2: คลิป — first frame จาก keyframe, เสียงพูดตาม line (H3 native audio; generate_audio on)
    const sbs = await db.select().from(schema.storyboards)
      .where(eq(schema.storyboards.episodeId, episodeId)).orderBy(schema.storyboards.storyboardNumber)
    const videoTaskIds: number[] = []
    for (const sb of sbs) {
      const id = await generateVideo({
        storyboardId: sb.id,
        dramaId,
        prompt: sb.videoPrompt || sb.description || '',
        referenceMode: 'reference',
        firstFrameUrl: sb.firstFrameImage || undefined,
        generateAudio: true,
        duration: sb.duration ?? undefined,
        aspectRatio: '9:16',
        configId: videoConfigId,
      })
      videoTaskIds.push(id)
    }
    await saveRenderState(project.id, { variantId: variant.id, stage: 'videos', taskIds: videoTaskIds })
    await waitTasksSettle(videoTaskIds)
    await assertTasksOk(videoTaskIds)

    // stage 3: merge + captions + วัดความยาวจริง
    const mergeId = await mergeEpisodeVideos(episodeId, dramaId)
    await saveRenderState(project.id, { variantId: variant.id, stage: 'merge', taskIds: [] })
    const mergeRow = await waitForMergeCompletion(mergeId)
    if (mergeRow.status === 'failed') {
      throw Object.assign(new Error(`E_RENDER_TASK_FAILED: ${mergeRow.errorMsg || 'merge failed'}`), { errorCode: 'E_RENDER_TASK_FAILED' })
    }
    let outputPath = mergeRow.mergedUrl
    if (!outputPath) throw Object.assign(new Error('E_RENDER_TASK_FAILED: merge completed without output path'), { errorCode: 'E_RENDER_TASK_FAILED' })
    try {
      const captioned = await burnCloneCaptions(project, variant, beats, mergeRow)
      if (captioned) outputPath = captioned
    } catch (err: any) {
      // captions ล้ม (เช่นฟอนต์) — ยังส่งมอบตัวแปรได้ด้วยคลิปที่ไม่มีซับ
      logTaskWarn('Clone', 'captions-fallback', { variantId: variant.id, error: err?.message })
    }
    const durationSec = await probeDurationSec(toAbs(outputPath))

    await db.update(schema.cloneVariants)
      .set({ status: 'completed', outputPath, durationSec, errorCode: null, errorMsg: null, updatedAt: now() })
      .where(eq(schema.cloneVariants.id, variant.id))
    await saveRenderState(project.id, { variantId: null, stage: 'prepare', taskIds: [] })
    logTaskSuccess('Clone', 'render-variant', { variantId: variant.id, outputPath, durationSec })
  } catch (err: any) {
    const raw = String(err?.message || 'render failed')
    const code = err?.errorCode || 'E_RENDER_TASK_FAILED'
    const msg = raw.startsWith(code) ? raw.slice(0, 500) : `${code}: ${raw}`.slice(0, 500)
    await db.update(schema.cloneVariants)
      .set({ status: 'failed', errorCode: code, errorMsg: msg, updatedAt: now() })
      .where(eq(schema.cloneVariants.id, variant.id))
    await saveRenderState(project.id, { variantId: null, stage: 'prepare', taskIds: [] })
    logTaskError('Clone', 'render-variant', { variantId: variant.id, error: msg })
  }
}

/**
 * driver ของ batch — วนเก็บตัวแปร queued ทีละตัวตาม id (คิวระดับโปรเจกต์);
 * งาน sys_task ของ provider ใช้คิว maxConcurrent เดิมของ generation.ts; kind = clone_render
 */
async function runCloneRenderPipeline(projectId: number, key: string): Promise<void> {
  try {
    for (;;) {
      if (await isCancelRequested(key)) {
        // งานที่ rendering อยู่ปล่อยจบเอง — ตัวที่ยัง queued คืนเป็น draft
        await db.update(schema.cloneVariants)
          .set({ status: 'draft', updatedAt: now() })
          .where(and(eq(schema.cloneVariants.projectId, projectId), eq(schema.cloneVariants.status, 'queued')))
        await updateTask(key, { status: 'cancelled', finishedAt: now() })
        logTaskSuccess('Clone', 'render-cancelled', { projectId })
        return
      }
      const [next] = await db.select().from(schema.cloneVariants)
        .where(and(eq(schema.cloneVariants.projectId, projectId), eq(schema.cloneVariants.status, 'queued')))
        .orderBy(schema.cloneVariants.id)
        .limit(1)
      if (!next) {
        await updateTask(key, { status: 'done', finishedAt: now() })
        await saveRenderState(projectId, { variantId: null, stage: 'prepare', taskIds: [] })
        logTaskSuccess('Clone', 'render-batch', { projectId })
        return
      }
      const project = await getCloneProjectRow(projectId)
      if (!project) {
        await updateTask(key, { status: 'error', errorMsg: 'E_TASK_INTERRUPTED: project missing', finishedAt: now() })
        return
      }
      const imageConfig = await getActiveConfig('image')
      const videoConfig = await getActiveConfig('video')
      await renderSingleVariant(project, next, key, imageConfig?.id, videoConfig?.id)
    }
  } catch (err: any) {
    const raw = err?.message || 'render batch failed'
    const msg = err?.errorCode && !raw.startsWith(err.errorCode) ? `${err.errorCode}: ${raw}` : raw
    await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
    logTaskError('Clone', 'render-batch', { projectId, error: msg })
  }
}

/** render variant เดี่ยวหรือทั้ง batch — 202 + pipeline_tasks; driver วนเก็บ queued เอง */
export async function startCloneRender(opts: { projectId?: number; variantId?: number }): Promise<{ queued: number } | null> {
  let project: CloneProjectRow | null = null
  let variants: CloneVariantRow[] = []
  if (opts.variantId) {
    const variant = await getCloneVariantRow(opts.variantId)
    if (!variant) return null
    project = await getCloneProjectRow(variant.projectId)
    if (!project) return null
    variants = [variant]
  } else if (opts.projectId) {
    project = await getCloneProjectRow(opts.projectId)
    if (!project) return null
    variants = await db.select().from(schema.cloneVariants)
      .where(eq(schema.cloneVariants.projectId, opts.projectId))
      .orderBy(schema.cloneVariants.id)
  }
  if (!project) return null
  if (!project.blueprintJson) throw new AppError('ยังไม่มี Blueprint — กดวิเคราะห์ก่อน render', 'E_CLONE_ANALYZE_FAILED')

  // คิวเฉพาะตัวที่ render ได้: draft/failed (completed/rendering ไม่แตะ, queued อยู่ในคิวอยู่แล้ว)
  const targets = variants.filter(v => v.status === 'draft' || v.status === 'failed')
  const ts = now()
  for (const variant of targets) {
    await db.update(schema.cloneVariants).set({ status: 'queued', errorCode: null, errorMsg: null, updatedAt: ts })
      .where(eq(schema.cloneVariants.id, variant.id))
  }
  // mutex ระดับโปรเจกต์: driver วิ่งอยู่ = ตัวที่เพิ่ง queued จะถูกวนเก็บต่อเอง
  const key = `clone_render:${project.id}`
  const task = await startTask({ kind: 'clone_render', key })
  if (!task) {
    logTaskProgress('Clone', 'render-queued', { projectId: project.id, queued: targets.length, driverRunning: true })
    return { queued: targets.length }
  }
  await db.update(schema.cloneVariants).set({ pipelineTaskId: task.id })
    .where(and(eq(schema.cloneVariants.projectId, project.id), eq(schema.cloneVariants.status, 'queued')))
  logTaskStart('Clone', 'render', { projectId: project.id, queued: targets.length })
  void runCloneRenderPipeline(project.id, key)
  return { queued: targets.length }
}

/** boot: driver ค้างจากรีสตาร์ท → วิ่งต่อ (sys_task ที่ submit ไปแล้ว recover โดย recoverGenerationTasks) */
export async function resumeStaleCloneRenders(): Promise<number> {
  const rows = await db.select().from(schema.pipelineTasks)
    .where(and(eq(schema.pipelineTasks.kind, 'clone_render'), eq(schema.pipelineTasks.status, 'running')))
  let resumed = 0
  for (const row of rows) {
    const projectId = Number(row.key.split(':')[1])
    if (!Number.isInteger(projectId)) {
      await updateTask(row.key, { status: 'error', errorMsg: 'E_TASK_INTERRUPTED: invalid key', finishedAt: now() })
      continue
    }
    const project = await getCloneProjectRow(projectId)
    if (!project) {
      await updateTask(row.key, { status: 'error', errorMsg: 'E_TASK_INTERRUPTED: project missing', finishedAt: now() })
      continue
    }
    void runCloneRenderPipeline(projectId, row.key)
    resumed += 1
  }
  return resumed
}
