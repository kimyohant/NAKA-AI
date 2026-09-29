import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db, getInsertId, schema } from '../db/index.js'
import { success, created, now, badRequest } from '../utils/response.js'
import { toSnakeCase } from '../utils/transform.js'
import { logTaskPayload, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'
import { storyboardReadiness, taskMediaSlot, type MediaSlot } from '../services/storyboard-readiness.js'

const app = new Hono()

app.get('/:id/readiness', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return badRequest(c, 'Invalid storyboard ID')
  const readiness = await storyboardReadiness(id)
  return readiness ? success(c, readiness) : badRequest(c, '镜头不存在')
})

app.post('/:id/select-media', async (c) => {
  const storyboardId = Number(c.req.param('id'))
  const body = await c.req.json().catch(() => ({}))
  const taskId = Number(body.task_id)
  const slot = body.slot as MediaSlot
  if (!Number.isInteger(storyboardId) || !Number.isInteger(taskId) || !['composed', 'first_frame', 'last_frame', 'video'].includes(slot)) {
    return badRequest(c, 'Invalid media selection')
  }
  const [shot] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, storyboardId))
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, taskId))
  if (!shot || !task || task.storyboardId !== storyboardId || task.status !== 'completed' || !task.localPath || taskMediaSlot(task) !== slot) {
    return badRequest(c, 'Completed media task for this shot and slot is required')
  }
  const column = { composed: 'composedImage', first_frame: 'firstFrameImage', last_frame: 'lastFrameImage', video: 'videoUrl' }[slot]
  db.transaction((tx) => {
    tx.insert(schema.storyboardMediaSelections).values({ storyboardId, slot, taskId, selectedAt: now() })
      .onConflictDoUpdate({
        target: [schema.storyboardMediaSelections.storyboardId, schema.storyboardMediaSelections.slot],
        set: { taskId, selectedAt: now() },
      }).run()
    tx.update(schema.storyboards).set({ [column]: task.localPath, updatedAt: now() })
      .where(eq(schema.storyboards.id, storyboardId)).run()
  })
  return success(c, { storyboard_id: storyboardId, slot, task_id: taskId, path: task.localPath })
})

app.put('/:id/character-looks/:characterId', async (c) => {
  const storyboardId = Number(c.req.param('id'))
  const characterId = Number(c.req.param('characterId'))
  const body = await c.req.json().catch(() => ({}))
  const [binding] = await db.select().from(schema.storyboardCharacters)
    .where(and(eq(schema.storyboardCharacters.storyboardId, storyboardId), eq(schema.storyboardCharacters.characterId, characterId)))
  if (!binding) return badRequest(c, 'Character is not bound to this shot')
  if (body.look_id == null) {
    await db.delete(schema.storyboardCharacterLooks)
      .where(and(eq(schema.storyboardCharacterLooks.storyboardId, storyboardId), eq(schema.storyboardCharacterLooks.characterId, characterId)))
    return success(c)
  }
  const lookId = Number(body.look_id)
  const [look] = await db.select().from(schema.characterLooks).where(eq(schema.characterLooks.id, lookId))
  if (!look || look.characterId !== characterId) return badRequest(c, 'Look does not belong to this character')
  await db.insert(schema.storyboardCharacterLooks).values({ storyboardId, characterId, lookId })
    .onConflictDoUpdate({
      target: [schema.storyboardCharacterLooks.storyboardId, schema.storyboardCharacterLooks.characterId],
      set: { lookId },
    })
  return success(c, { storyboard_id: storyboardId, character_id: characterId, look_id: lookId })
})

async function syncStoryboardCharacters(storyboardId: number, characterIds: number[]) {
  await db.delete(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))


  const uniqueIds = [...new Set((characterIds || []).filter(Boolean))]
  const assigned = await db.select().from(schema.storyboardCharacterLooks)
    .where(eq(schema.storyboardCharacterLooks.storyboardId, storyboardId))
  for (const row of assigned) {
    if (!uniqueIds.includes(row.characterId)) {
      await db.delete(schema.storyboardCharacterLooks)
        .where(and(eq(schema.storyboardCharacterLooks.storyboardId, storyboardId), eq(schema.storyboardCharacterLooks.characterId, row.characterId)))
    }
  }
  if (!uniqueIds.length) return

  for (const characterId of uniqueIds) {
    await db.insert(schema.storyboardCharacters).values({
      storyboardId,
      characterId,
    })
  }
}

async function getStoryboardCharacterIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardCharacters)
    .where(eq(schema.storyboardCharacters.storyboardId, storyboardId))
  return links.map(link => link.characterId)
}

async function syncStoryboardProps(storyboardId: number, propIds: number[]) {
  await db.delete(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))

  const uniqueIds = [...new Set((propIds || []).filter(Boolean))]
  if (!uniqueIds.length) return

  for (const propId of uniqueIds) {
    await db.insert(schema.storyboardProps).values({
      storyboardId,
      propId,
    })
  }
}

async function getStoryboardPropIds(storyboardId: number) {
  const links = await db.select().from(schema.storyboardProps)
    .where(eq(schema.storyboardProps.storyboardId, storyboardId))
  return links.map(link => link.propId)
}

async function validateStoryboardBindings(episodeId: number, sceneId: number | null | undefined, characterIds: number[] | undefined, propIds?: number[] | undefined) {
  const sceneLinks = await db.select().from(schema.episodeScenes)
    .where(eq(schema.episodeScenes.episodeId, episodeId))
  const episodeSceneIds = new Set(sceneLinks.map(link => link.sceneId))
  const characterLinks = await db.select().from(schema.episodeCharacters)
    .where(eq(schema.episodeCharacters.episodeId, episodeId))
  const episodeCharacterIds = new Set(characterLinks.map(link => link.characterId))
  const propLinks = await db.select().from(schema.episodeProps)
    .where(eq(schema.episodeProps.episodeId, episodeId))
  const episodePropIds = new Set(propLinks.map(link => link.propId))

  if (sceneId != null && !episodeSceneIds.has(sceneId)) {
    throw new Error('scene_id 必须来自当前集已关联场景')
  }

  const invalidCharacterIds = (characterIds || []).filter(id => !episodeCharacterIds.has(id))
  if (invalidCharacterIds.length) {
    throw new Error('character_ids 必须来自当前集已关联角色')
  }

  const invalidPropIds = (propIds || []).filter(id => !episodePropIds.has(id))
  if (invalidPropIds.length) {
    throw new Error('prop_ids 必须来自当前集已关联道具')
  }
}

// POST /storyboards
app.post('/', async (c) => {
  const body = await c.req.json()
  const ts = now()
  logTaskStart('StoryboardAPI', 'create', {
    episodeId: body.episode_id,
    shotNumber: body.storyboard_number || 1,
    sceneId: body.scene_id,
    characterIds: body.character_ids,
  })
  logTaskPayload('StoryboardAPI', 'create body', body)
  await validateStoryboardBindings(body.episode_id, body.scene_id, body.character_ids, body.prop_ids)
  const res = await db.insert(schema.storyboards).values({
    episodeId: body.episode_id,
    storyboardNumber: body.storyboard_number || 1,
    title: body.title,
    description: body.description,
    sceneId: body.scene_id,
    duration: body.duration || 10,
    createdAt: ts,
    updatedAt: ts,
  })
  await syncStoryboardCharacters(getInsertId(res), body.character_ids || [])
  await syncStoryboardProps(getInsertId(res), body.prop_ids || [])
  const [result] = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.id, getInsertId(res)))
  logTaskSuccess('StoryboardAPI', 'create', {
    storyboardId: result.id,
    episodeId: result.episodeId,
    shotNumber: result.storyboardNumber,
  })
  return created(c, {
    ...toSnakeCase(result),
    character_ids: await getStoryboardCharacterIds(result.id),
    prop_ids: await getStoryboardPropIds(result.id),
  })
})

// PUT /storyboards/:id
app.put('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json()
  const [storyboard] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, id))
  if (!storyboard) return badRequest(c, '镜头不存在')
  logTaskStart('StoryboardAPI', 'update', {
    storyboardId: id,
    episodeId: storyboard.episodeId,
    fields: Object.keys(body),
  })
  logTaskPayload('StoryboardAPI', 'update body', body)

  const fieldMap: Record<string, string> = {
    title: 'title', description: 'description', shot_type: 'shotType',
    angle: 'angle', movement: 'movement', duration: 'duration',
    video_prompt: 'videoPrompt',
    image_prompt: 'imagePrompt', scene_id: 'sceneId', location: 'location',
    time: 'time', atmosphere: 'atmosphere', result: 'result',
    bgm_prompt: 'bgmPrompt', sound_effect: 'soundEffect',
    video_url: 'videoUrl',
  }

  const updates: Record<string, any> = { updatedAt: now() }
  for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
    if (snakeKey in body) updates[camelKey] = body[snakeKey]
  }

  await validateStoryboardBindings(
    storyboard.episodeId,
    'scene_id' in body ? body.scene_id : storyboard.sceneId,
    'character_ids' in body ? body.character_ids : await getStoryboardCharacterIds(id),
    'prop_ids' in body ? body.prop_ids : await getStoryboardPropIds(id),
  )

  await db.update(schema.storyboards).set(updates).where(eq(schema.storyboards.id, id))
  if ('character_ids' in body) await syncStoryboardCharacters(id, body.character_ids || [])
  if ('prop_ids' in body) await syncStoryboardProps(id, body.prop_ids || [])
  logTaskSuccess('StoryboardAPI', 'update', {
    storyboardId: id,
    updatedFields: Object.keys(updates),
    characterIds: body.character_ids,
    propIds: body.prop_ids,
  })
  return success(c)
})

// DELETE /storyboards/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  logTaskStart('StoryboardAPI', 'delete', { storyboardId: id })
  await db.delete(schema.storyboardCharacters).where(eq(schema.storyboardCharacters.storyboardId, id))
  await db.delete(schema.storyboardProps).where(eq(schema.storyboardProps.storyboardId, id))
  await db.delete(schema.storyboardMediaSelections).where(eq(schema.storyboardMediaSelections.storyboardId, id))
  await db.delete(schema.storyboardCharacterLooks).where(eq(schema.storyboardCharacterLooks.storyboardId, id))
  await db.delete(schema.storyboards).where(eq(schema.storyboards.id, id))
  logTaskSuccess('StoryboardAPI', 'delete', { storyboardId: id })
  return success(c)
})

export default app
