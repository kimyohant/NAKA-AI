/**
 * Product Studio Agent 工具 — review_director
 * บันทึก shot list ลง DB ผ่าน services/studio-shots.ts (deterministic prompts)
 * — Agent ไม่ parse ข้อความดิบเอง; studioProjectId/studioEpisodeId/studioDramaId ผ่าน StudioRequestContext
 */
import { createTool } from '@mastra/core/tools'
import { z } from 'zod'
import { eq } from 'drizzle-orm'
import { db, schema } from '../../db/index.js'
import { getStudioProjectId } from '../context.js'
import { buildShotPrompts, writeStudioShot } from '../../services/studio-shots.js'

const saveStudioShots = createTool({
  id: 'save_studio_shots',
  description: 'Save the complete shot list for this studio project (replaces all existing shots). One call with every shot, in order.',
  inputSchema: z.object({
    shots: z.array(z.object({
      role: z.string().min(1).describe('Beat role from the template (e.g. hook/problem/cta) — must match the roles given in the request'),
      durationSec: z.number().int().min(2).max(60).describe('Shot duration in seconds (use the seconds given in the request for this role)'),
      visual: z.string().min(1).describe('What is seen on screen: product, presenter, scene, action'),
      dialogue: z.string().nullable().optional().describe('Spoken lines in the project language, short enough to fit the shot duration; null when the shot has no dialogue'),
      onScreenText: z.string().nullable().optional().describe('Short on-screen text overlay, or null'),
    })).min(1).max(12).describe('All shots in order — the count must equal the number of beats in the request'),
  }),
  execute: async ({ shots }, context) => {
    const projectId = getStudioProjectId(context?.requestContext)
    if (!projectId) return { error: 'Missing studioProjectId in request context' }
    const rc = context?.requestContext
    const dramaId = rc?.get('studioDramaId' as never)
    const episodeId = rc?.get('studioEpisodeId' as never)
    if (typeof dramaId !== 'number' || typeof episodeId !== 'number') {
      return { error: 'Missing studioDramaId/studioEpisodeId in request context' }
    }
    const expected = rc?.get('expectedShots' as never) as number | undefined
    if (typeof expected === 'number' && shots.length !== expected) {
      return { error: `Expected ${expected} shots (one per template beat) but got ${shots.length}` }
    }
    const [project] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId))
    if (!project) return { error: `Studio project not found (id=${projectId})` }
    const avatar = project.avatarId
      ? (await db.select().from(schema.studioAvatars).where(eq(schema.studioAvatars.id, project.avatarId)))[0]
      : null

    const ids: number[] = []
    for (let i = 0; i < shots.length; i++) {
      const shot = shots[i]
      const { imagePrompt, videoPrompt } = buildShotPrompts(
        {
          productName: project.productName,
          productDescription: project.productDescription,
          language: project.language,
          platform: project.platform,
          hasDialogue: true,
        },
        { role: shot.role, durationSec: shot.durationSec, visual: shot.visual, dialogue: shot.dialogue ?? null, onScreenText: shot.onScreenText ?? null },
        avatar && !avatar.deletedAt ? { name: avatar.name, description: avatar.description } : null,
      )
      ids.push(await writeStudioShot({
        projectId,
        dramaId,
        episodeId,
        number: i + 1,
        role: shot.role,
        durationSec: shot.durationSec,
        visual: shot.visual,
        dialogue: shot.dialogue ?? null,
        onScreenText: shot.onScreenText ?? null,
        imagePrompt,
        videoPrompt,
      }))
    }
    return { message: `${ids.length} studio shots saved`, shot_ids: ids }
  },
})

export const studioTools = { saveStudioShots }
