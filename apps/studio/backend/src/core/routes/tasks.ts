import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { ownedBy } from '../auth/owner-context.js'
import { db, schema } from '../db/index.js'
import { success, created, badRequest } from '../http/response.js'
import { cancelGenerationTask, generateImage, generateVideo, resumeGenerationTask, videoQueuePosition } from '../generation/generation.js'
import { logTaskError, logTaskPayload, logTaskStart, logTaskSuccess } from '../tasks/task-logger.js'
import { quoteGeneration } from '../generation/generation-cost.js'
import { resolveTaskContext, prepareVideoTask, type TaskType } from '../generation/task-prep.js'

const app = new Hono()

// Read-only preview. The same preparation runs again when the approved job is submitted.
app.post('/preflight', async (c) => {
  try {
    const body = await c.req.json()
    if (body.type !== 'video') return badRequest(c, 'type 必须为 video')
    const context = await resolveTaskContext(body, 'video')
    const prepared = await prepareVideoTask(body, context)
    return success(c, {
      prompt: prepared.prompt,
      provider: prepared.config.provider,
      model: prepared.videoBody.model || prepared.config.model,
      duration: prepared.videoBody.duration,
      resolution: context.episodeResolution || prepared.videoBody.resolution,
      aspect_ratio: prepared.videoBody.aspect_ratio,
      reference_image_urls: prepared.videoBody.reference_image_urls,
      cost: quoteGeneration(context.storyboardDramaId || body.drama_id, prepared.config.id, 'video', prepared.videoBody.duration),
    })
  } catch (err: any) {
    return badRequest(c, err.message)
  }
})

// POST /tasks — 发起生成任务（body.type: image | video）
app.post('/', async (c) => {
  const body = await c.req.json()
  const type = body.type as TaskType
  if (type !== 'image' && type !== 'video') return badRequest(c, 'type 必须为 image 或 video')

  if (type === 'image') {
    if (!body.prompt) return badRequest(c, '提示词必填')
  }

  try {
    // 请求显式指定 config_id（工作台模型下拉跨厂商切换）时优先；
    // 未指定才回退到集锁定配置，避免锁定配置与所选模型错配（如锁定 Seedance 却传 MiniMax 模型名）
    const context = await resolveTaskContext(body, type)
    const { configId, episodeResolution } = context
    const prepared = type === 'video' ? await prepareVideoTask(body, context) : null
    const videoBody = prepared?.videoBody

    logTaskStart('TaskAPI', 'generate', {
      type,
      storyboardId: body.storyboard_id,
      sceneId: body.scene_id,
      characterId: body.character_id,
      dramaId: body.drama_id,
    })
    logTaskPayload('TaskAPI', 'request body', body)

    const id = type === 'image'
      ? await generateImage({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        sceneId: body.scene_id,
        characterId: body.character_id,
        prompt: body.prompt,
        model: body.model,
        size: body.size,
        referenceImages: body.reference_images,
        frameType: body.frame_type,
        configId,
      })
      : await generateVideo({
        storyboardId: body.storyboard_id,
        dramaId: body.drama_id,
        prompt: prepared!.prompt,
        model: videoBody!.model,
        referenceMode: 'reference',
        imageUrl: videoBody!.image_url,
        firstFrameUrl: videoBody!.first_frame_url,
        lastFrameUrl: videoBody!.last_frame_url,
        referenceImageUrls: videoBody!.reference_image_urls,
        referenceVideoUrls: videoBody!.reference_video_urls,
        referenceAudioUrls: videoBody!.reference_audio_urls,
        referenceFileUrl: videoBody!.file_url,
        referenceLinkUrl: videoBody!.link_url,
        generateAudio: videoBody!.generate_audio,
        duration: videoBody!.duration,
        aspectRatio: videoBody!.aspect_ratio,
        resolution: episodeResolution || videoBody!.resolution,
        seed: videoBody!.seed,
        promptExtend: videoBody!.prompt_extend,
        watermark: videoBody!.watermark,
        configId,
      })

    const [record] = await db.select().from(schema.sysTask)
      .where(eq(schema.sysTask.id, id))
    logTaskSuccess('TaskAPI', 'generate', { taskId: id, type, provider: record?.provider })
    return created(c, record)
  } catch (err: any) {
    logTaskError('TaskAPI', 'generate', { type, error: err.message })
    return badRequest(c, err.message)
  }
})

// GET /tasks/:id — 轮询任务状态（queued 的 video 任务附带 queuePosition 供 UI 显示「คิวที่ n」）
app.get('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [row] = await db.select().from(schema.sysTask)
    .where(eq(schema.sysTask.id, id))
  if (!row) return success(c, null)
  return success(c, { ...row, queuePosition: await videoQueuePosition(row) })
})

// Resume polling an accepted provider task. This endpoint never submits a new paid task.
app.post('/:id/recover', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return badRequest(c, 'Invalid task ID')
  const result = await resumeGenerationTask(id)
  if (result === 'unavailable') return badRequest(c, 'Provider task ID or original configuration is unavailable')
  return success(c, { status: result })
})

// Cancel a task the provider is not working on: queued (never submitted) or unknown (polling stopped).
// Frees its queue slot; a task this server is submitting or polling cannot be cancelled.
app.post('/:id/cancel', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id < 1) return badRequest(c, 'Invalid task ID')
  const result = await cancelGenerationTask(id)
  if (result === 'active') return badRequest(c, 'The task is being submitted or polled; wait for it to finish')
  if (result === 'not_cancellable') return badRequest(c, 'Only queued or unknown tasks can be cancelled')
  return success(c, { status: 'cancelled' })
})

// GET /tasks — 按 type / storyboard_id / drama_id 过滤
app.get('/', async (c) => {
  const type = c.req.query('type')
  const storyboardId = c.req.query('storyboard_id')
  const dramaId = c.req.query('drama_id')

  let rows = await db.select().from(schema.sysTask).where(ownedBy(schema.sysTask.ownerUserId))

  if (type) rows = rows.filter(r => r.type === type)
  if (storyboardId) rows = rows.filter(r => r.storyboardId === Number(storyboardId))
  if (dramaId) rows = rows.filter(r => r.dramaId === Number(dramaId))

  return success(c, rows)
})

// DELETE /tasks/:id
app.delete('/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const [task] = await db.select().from(schema.sysTask).where(eq(schema.sysTask.id, id))
  if (task && ['queued', 'submitting', 'processing'].includes(task.status || '')) {
    return badRequest(c, 'Cannot delete an active generation task')
  }
  const selections = await db.select().from(schema.storyboardMediaSelections)
    .where(eq(schema.storyboardMediaSelections.taskId, id))
  if (selections.length) return badRequest(c, 'Cannot delete media selected for a shot')
  await db.delete(schema.sysTask).where(eq(schema.sysTask.id, id))
  return success(c)
})

export default app
