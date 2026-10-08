/**
 * Studio shot helpers — ใช้ร่วมกันระหว่าง services/studio.ts (PUT shots/:shotId)
 * และ agents/tools/studio-tools.ts (save_studio_shots)
 * ตั้งใจไม่ import mastra เพื่อไม่ให้เกิด dependency cycle (studio.ts → mastra → agents → tools → ที่นี่)
 */
import { and, eq, isNull } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { now } from '../utils/response.js'

/** ข้อมูลที่ prompt builder ต้องใช้ — caller อ่านจาก DB แล้วส่งมาเป็น plain object */
export interface ShotPromptContext {
  productName: string
  productDescription: string | null
  language: string
  platform: string
  hasDialogue: boolean
}

export interface ShotPromptInput {
  role: string
  durationSec: number
  visual: string
  dialogue: string | null
  onScreenText: string | null
}

export interface ShotPromptAvatar {
  name: string
  description: string
}

/**
 * Deterministic shot prompts — PUT shots/:shotId และ save_studio_shots ใช้ฟังก์ชันเดียวกัน
 * - videoPrompt ต้องมีบทพูดคำต่อคำในภาษาที่เลือก + สั่งให้พูดภาษานั้น (PLAN ข้อ 4 กติกา render)
 * - ห้ามตัวอักษร/โลโก้แปลกปลอม; on-screen text เฉพาะที่ผู้ใช้กำหนด
 */
export function buildShotPrompts(
  ctx: ShotPromptContext,
  shot: ShotPromptInput,
  avatar: ShotPromptAvatar | null,
): { imagePrompt: string; videoPrompt: string } {
  const presenter = avatar
    ? ` Featured presenter: ${avatar.name} — ${avatar.description}. Keep the presenter's face and appearance consistent with the avatar reference image.`
    : ''
  const product = `Product: ${ctx.productName}${ctx.productDescription ? ` — ${ctx.productDescription}` : ''}.`

  const imagePrompt = [
    `Product studio shot (${shot.role}, ${shot.durationSec}s): ${shot.visual}.`,
    product,
    presenter.trim() ? presenter.trim() : '',
    `Clean commercial composition for ${ctx.platform}. No random brand logos or watermarks.`,
  ].filter(Boolean).join(' ')

  const dialoguePart = shot.dialogue && shot.dialogue.trim()
    ? `The presenter speaks in ${ctx.language} — the voice-over MUST be exactly these words, nothing else: "${shot.dialogue.trim()}"`
    : 'No spoken dialogue for this shot.'
  const textPart = shot.onScreenText && shot.onScreenText.trim()
    ? ` The only on-screen text allowed is: "${shot.onScreenText.trim()}"`
    : ' No on-screen text.'
  const videoPrompt = [
    `Product studio shot (${shot.role}, ${shot.durationSec}s). Visual: ${shot.visual}.`,
    presenter.trim() ? presenter.trim() : '',
    dialoguePart,
    `Keep the exact product design, label and colors from the reference images.`,
    `No added text, logos or watermarks.${textPart}`,
  ].filter(Boolean).join(' ')

  return { imagePrompt, videoPrompt }
}

/** ลบ storyboards เดิมของ episode (soft delete ตาม pattern เดิม) ก่อนเขียนช็อตชุดใหม่ */
export async function clearEpisodeStoryboards(episodeId: number): Promise<number> {
  const res = await db.update(schema.storyboards)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(schema.storyboards.episodeId, episodeId), isNull(schema.storyboards.deletedAt)))
  return res?.changes ?? 0
}

/** เขียนช็อต 1 ช็อต: storyboard เดิม (เก็บภาพ/ความยาว/prompt) + studio_shots (role/dialogue/on_screen_text) */
export async function writeStudioShot(params: {
  projectId: number
  dramaId: number
  episodeId: number
  number: number
  role: string
  durationSec: number
  visual: string
  dialogue: string | null
  onScreenText: string | null
  imagePrompt: string
  videoPrompt: string
}): Promise<number> {
  const ts = now()
  const sbRes = await db.insert(schema.storyboards).values({
    episodeId: params.episodeId,
    storyboardNumber: params.number,
    title: params.role,
    duration: params.durationSec,
    description: params.visual,
    imagePrompt: params.imagePrompt,
    videoPrompt: params.videoPrompt,
    status: 'pending',
    createdAt: ts,
    updatedAt: ts,
  })
  const storyboardId = getInsertId(sbRes)
  await db.insert(schema.studioShots).values({
    storyboardId,
    projectId: params.projectId,
    role: params.role,
    dialogue: params.dialogue,
    onScreenText: params.onScreenText,
  })
  return storyboardId
}
