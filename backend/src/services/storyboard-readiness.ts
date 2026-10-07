import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

export type MediaSlot = 'composed' | 'first_frame' | 'last_frame' | 'video'

export function taskMediaSlot(task: typeof schema.sysTask.$inferSelect): MediaSlot {
  if (task.type === 'video') return 'video'
  let params: { frameType?: string } = {}
  try { params = JSON.parse(task.params || '{}') } catch { /* old task */ }
  return params.frameType === 'first_frame' ? 'first_frame'
    : params.frameType === 'last_frame' ? 'last_frame' : 'composed'
}

export async function storyboardReadiness(storyboardId: number) {
  const [shot] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  if (!shot) return null
  const [sceneRows, characterLinks, propLinks, tasks, selections, lookAssignments] = await Promise.all([
    shot.sceneId ? db.select().from(schema.scenes).where(eq(schema.scenes.id, shot.sceneId)) : Promise.resolve([]),
    db.select().from(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, storyboardId)),
    db.select().from(schema.storyboardProps).where(eq(schema.storyboardProps.storyboardId, storyboardId)),
    db.select().from(schema.sysTask).where(eq(schema.sysTask.storyboardId, storyboardId)),
    db.select().from(schema.storyboardMediaSelections).where(eq(schema.storyboardMediaSelections.storyboardId, storyboardId)),
    db.select().from(schema.storyboardCharacterLooks).where(eq(schema.storyboardCharacterLooks.storyboardId, storyboardId)),
  ])
  const scene = sceneRows[0]
  const [allCharacters, allProps, allLooks] = await Promise.all([
    db.select().from(schema.characters),
    db.select().from(schema.props),
    db.select().from(schema.characterLooks),
  ])
  const blockers: Array<{ code: string; name?: string; slot?: string }> = []
  if (!String(shot.videoPrompt || '').trim()) blockers.push({ code: 'missing_prompt' })
  if (shot.sceneId && !scene) blockers.push({ code: 'missing_scene_image', name: String(shot.sceneId) })
  if (scene && !scene.imageUrl) blockers.push({ code: 'missing_scene_image', name: scene.location })
  for (const link of characterLinks) {
    const character = allCharacters.find(row => row.id === link.characterId)
    const assigned = lookAssignments.find(row => row.characterId === link.characterId)
    const image = assigned ? allLooks.find(row => row.id === assigned.lookId)?.imageUrl : character?.imageUrl
    if (!image) blockers.push({ code: assigned ? 'missing_look_image' : 'missing_character_image', name: character?.name || String(link.characterId) })
  }
  for (const link of propLinks) {
    const prop = allProps.find(row => row.id === link.propId)
    if (!prop?.imageUrl) blockers.push({ code: 'missing_prop_image', name: prop?.name || String(link.propId) })
  }
  const selectedSlots = new Set(selections.map(row => row.slot))
  const imageCandidateSlots = new Set(tasks
    .filter(row => row.type === 'image' && row.status === 'completed' && row.localPath)
    .map(taskMediaSlot))
  for (const slot of imageCandidateSlots) {
    if (!selectedSlots.has(slot)) blockers.push({ code: 'select_image_candidate', slot })
  }
  return {
    storyboard_id: storyboardId,
    ready_for_video: blockers.length === 0,
    blockers,
    selected: Object.fromEntries(selections.map(row => [row.slot, row.taskId])),
    candidate_count: tasks.filter(row => row.status === 'completed' && row.localPath).length,
  }
}
