/**
 * Studio auto-render pipeline — กดครั้งเดียว server ทำ keyframes → videos → merge จนจบเอง
 * (docs/product-studio/PHASE2.md ข้อ 2)
 * - pipeline ระดับโปรเจกต์ผ่าน pipeline_tasks (kind studio_render) — busy guard เดียวกับ script
 * - ส่งงานใช้ submitRenderStage ของ services/studio.ts (ไม่ก๊อป logic)
 * - รอผล: วนเช็ก sys_task ของ stage ปัจจุบันทุก 5s (ห้ามถี่กว่านี้) จนไม่มี queued/processing
 * - ช็อตล้มเหลวไม่หยุด pipeline (นับ failed); cancel ⇒ หยุดก่อนส่งงาน stage ถัดไป
 * - boot: resume ต่อจาก stage ค้าง (recoverGenerationTasks เดิม resume sys_task อยู่แล้ว) —
 *   resume ไม่ได้ ⇒ failed + E_TASK_INTERRUPTED
 */
import { and, eq, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { AppError, now } from '../utils/response.js'
import { getActiveConfig } from './ai.js'
import {
  getProjectRow, getProjectShots, renderTargets, requireAvatarIfTemplateNeeds,
  submitRenderStage, mergeProject, waitForMergeCompletion, toProjectJson,
  isAutoRenderRunning, parseAutoRender, type AutoRenderState,
} from './studio.js'
import { startTask, updateTask, isCancelRequested } from './pipeline-tasks.js'
import { logTaskError, logTaskStart, logTaskSuccess } from '../utils/task-logger.js'

const POLL_MS = 5_000
const MERGE_POLL_MS = 2_000

function isRunning(state: AutoRenderState): boolean {
  return ['keyframes', 'videos', 'merging'].includes(state.stage)
}

/** อัปเดต auto_render JSON บนโปรเจกต์ (partial patch) */
async function patchAutoRender(projectId: number, patch: Partial<AutoRenderState>): Promise<AutoRenderState> {
  const [row] = await db.select().from(schema.studioProjects).where(eq(schema.studioProjects.id, projectId))
  const state: AutoRenderState = { ...parseAutoRender(row?.autoRender ?? null), ...patch }
  await db.update(schema.studioProjects)
    .set({ autoRender: JSON.stringify(state), updatedAt: now() })
    .where(eq(schema.studioProjects.id, projectId))
  return state
}

/** สถานะ sys_task ของ stage: นับ done/failed/in-flight */
async function stageTaskStats(taskIds: number[]): Promise<{ done: number; failed: number; inFlight: number }> {
  if (!taskIds.length) return { done: 0, failed: 0, inFlight: 0 }
  const rows = await db.select().from(schema.sysTask).where(inArray(schema.sysTask.id, taskIds))
  let done = 0
  let failed = 0
  let inFlight = 0
  for (const row of rows) {
    if (row.status === 'completed') done += 1
    else if (row.status === 'failed' || row.status === 'unknown') failed += 1
    else inFlight += 1 // queued/submitting/processing
  }
  return { done, failed, inFlight }
}

/**
 * pipeline หลัก — startAutoRender เรียกแบบ fire-and-forget; test เรียก await ตรง ๆ ได้
 * resumeStage ใช้ตอน boot: ข้ามการส่งงานของ stage นั้น (งานเดิมถูก recover แล้ว) แค่ monitor ต่อ
 */
export async function runAutoRenderPipeline(
  projectId: number,
  key: string,
  opts: { force?: boolean; pollMs?: number; resumeStage?: string; resumeTaskIds?: number[] } = {},
): Promise<void> {
  const pollMs = Math.max(opts.pollMs ?? POLL_MS, 5000) // ห้าม poll ถี่กว่า 5s ฝั่ง server
  const STAGES = ['keyframes', 'videos'] as const
  // resume ที่ videos: ห้ามย้อนไปส่ง keyframe ใหม่ (ช็อตที่ keyframe ล้มจะถูกส่งซ้ำ = เสียเงินซ้ำ)
  const firstStage = opts.resumeStage ? STAGES.indexOf(opts.resumeStage as typeof STAGES[number]) : 0
  try {
    for (const stage of STAGES.slice(Math.max(0, firstStage))) {
      if (await isCancelRequested(key)) {
        await patchAutoRender(projectId, { stage: 'cancelled', finishedAt: now() })
        await updateTask(key, { status: 'cancelled', finishedAt: now() })
        logTaskSuccess('Studio', `auto-render cancelled at ${stage}`, { projectId })
        return
      }
      const project = await getProjectRow(projectId)
      if (!project) throw new Error('E_STUDIO_CAMPAIGN_NOT_FOUND: project deleted')
      const { all, shots } = await renderTargets(project, stage, undefined)

      const resumeHere = opts.resumeStage === stage
      let taskIds: number[] = []
      if (resumeHere) {
        // resume: ไม่ส่งงานใหม่ — monitor งานเดิมจาก JSON
        taskIds = (opts.resumeTaskIds ?? []).filter(Boolean)
        const stats = await stageTaskStats(taskIds)
        // งานหายจริง = ไม่มี id หรือหา sys_task ไม่เจอบางงาน · งานจบครบแล้ว (server ดับระหว่างรอ poll) ⇒ ไป stage ถัดไปตามปกติ
        if (!taskIds.length || stats.done + stats.failed + stats.inFlight < taskIds.length) {
          throw new Error('E_TASK_INTERRUPTED: 服务重启，任务中断，请重试')
        }
        await patchAutoRender(projectId, { stage, total: taskIds.length, done: stats.done, failed: stats.failed, stageTaskIds: taskIds })
      } else {
        const targets = opts.force ? shots : shots.filter(s => (stage === 'keyframes' ? s.keyframeStatus : s.videoStatus) !== 'completed')
        await patchAutoRender(projectId, { stage, total: targets.length, done: 0, failed: 0, errorMsg: null, stageTaskIds: [] })
        const { taskIds: submitted } = await submitRenderStage(project, stage, shots, all, { force: opts.force })
        taskIds = submitted
        await patchAutoRender(projectId, { stageTaskIds: taskIds, total: submitted.length })
      }

      // รอจน sys_task ทุกงานจบ (completed/failed/unknown) — ช็อตล้มเหลวไม่หยุด pipeline
      // (cancel ระหว่าง stage: งานที่ส่งแล้วปล่อยจบเอง — เช็ค cancel หลัง stage settle)
      for (;;) {
        const stats = await stageTaskStats(taskIds)
        await patchAutoRender(projectId, { done: stats.done, failed: stats.failed, total: taskIds.length })
        if (!stats.inFlight) break
        await new Promise(r => setTimeout(r, pollMs))
      }
      if (await isCancelRequested(key)) {
        await patchAutoRender(projectId, { stage: 'cancelled', finishedAt: now() })
        await updateTask(key, { status: 'cancelled', finishedAt: now() })
        logTaskSuccess('Studio', `auto-render cancelled after ${stage}`, { projectId })
        return
      }
      // mark stage progress: หลังจบ stage ทำงานต่อ (stage เปลี่ยนในรอบถัดไป)
    }

    // merge (ถ้ามีวิดีโอ ≥ 1 — mergeProject เอง throw E_STUDIO_NO_VIDEOS ถ้าไม่มี)
    await patchAutoRender(projectId, { stage: 'merging', total: 1, done: 0, failed: 0 })
    const merge = await mergeProject(projectId, { fromAutoRender: true })
    if (!merge) throw new Error('E_TASK_INTERRUPTED: project deleted')
    // รอ concat + captions เสร็จก่อนประกาศ done
    await waitForMergeCompletion(merge.id)
    if (await isCancelRequested(key)) {
      await patchAutoRender(projectId, { stage: 'cancelled', finishedAt: now() })
      await updateTask(key, { status: 'cancelled', finishedAt: now() })
      logTaskSuccess('Studio', 'auto-render cancelled at merging', { projectId })
      return
    }
    await patchAutoRender(projectId, { stage: 'done', finishedAt: now() })
    await updateTask(key, { status: 'done', finishedAt: now() })
    logTaskSuccess('Studio', 'auto-render', { projectId })
  } catch (err: any) {
    const raw = err?.message || 'auto-render failed'
    const msg = err instanceof AppError && err.errorCode && !raw.startsWith(err.errorCode)
      ? `${err.errorCode}: ${raw}`
      : raw
    await patchAutoRender(projectId, { stage: 'failed', errorMsg: msg, finishedAt: now() })
    await updateTask(key, { status: 'error', errorMsg: msg, finishedAt: now() })
    logTaskError('Studio', 'auto-render', { projectId, error: msg })
  }
}

/**
 * เริ่ม auto-render: guard ก่อนส่งงานแรก (ช็อต/avatar/model) → 202 แล้ว pipeline วิ่งเอง
 * ระหว่างวิ่ง: script / render / merge / auto-render ซ้ำ ⇒ E_STUDIO_BUSY
 */
export async function startAutoRender(projectId: number, opts: { force?: boolean } = {}): Promise<ReturnType<typeof import('./studio.js').toProjectJson> | null> {
  const project = await getProjectRow(projectId)
  if (!project) return null
  if (['scripting'].includes(project.status) || isAutoRenderRunning(project)) {
    throw new AppError('โปรเจกต์กำลังทำงานอยู่ (script/render/merge)', 'E_STUDIO_BUSY')
  }
  // guard ก่อนส่งงานแรก
  const shots = await getProjectShots(project)
  if (!shots.length) throw new AppError('ยังไม่มีบท/ช็อต — สั่งเขียนบทก่อน', 'E_STUDIO_NEEDS_SCRIPT')
  await requireAvatarIfTemplateNeeds(project)
  const [imageConfig, videoConfig] = await Promise.all([getActiveConfig('image'), getActiveConfig('video')])
  if (!imageConfig) throw new AppError('未配置图片模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_IMAGE_MODEL')
  if (!videoConfig) throw new AppError('未配置视频模型，请先到「设置」页添加并启用 AI 服务', 'E_NO_VIDEO_MODEL')

  const key = `studio_render:${projectId}`
  const task = await startTask({ kind: 'studio_render', key })
  if (!task) throw new AppError('โปรเจกต์กำลัง auto-render อยู่', 'E_STUDIO_BUSY')

  await patchAutoRender(projectId, {
    stage: 'keyframes', total: 0, done: 0, failed: 0,
    errorMsg: null, startedAt: now(), finishedAt: null, stageTaskIds: [],
  })
  logTaskStart('Studio', 'auto-render', { projectId, force: !!opts.force })
  // fire-and-forget — ปิดหน้าได้; frontend poll GET /:id
  void runAutoRenderPipeline(projectId, key, { force: opts.force, pollMs: POLL_MS })
  const updated = await getProjectRow(projectId)
  return updated ? toProjectJson(updated) : null
}

/** ยกเลิก: งานที่ส่งให้ provider ไปแล้วปล่อยให้จบเอง ไม่ส่งงานใหม่เพิ่ม (stage: 'cancelled') */
export async function cancelAutoRender(projectId: number) {
  const project = await getProjectRow(projectId)
  if (!project) return null
  const key = `studio_render:${projectId}`
  const state = parseAutoRender(project.autoRender)
  if (isRunning(state)) {
    // pipeline_tasks ใช้ cancel_requested (cooperative) — loop จะเช็คเอง
    await db.update(schema.pipelineTasks)
      .set({ cancelRequested: 1, updatedAt: now() })
      .where(and(eq(schema.pipelineTasks.key, key), eq(schema.pipelineTasks.status, 'running')))
  }
  const updated = await getProjectRow(projectId)
  return updated ? toProjectJson(updated) : null
}

/** boot: ต่อ pipeline ค้างจาก stage เดิม (recoverGenerationTasks resume sys_task แล้ว); resume ไม่ได้ ⇒ failed + E_TASK_INTERRUPTED */
export async function resumeStaleAutoRenders(): Promise<number> {
  const rows = await db.select().from(schema.pipelineTasks)
    .where(and(eq(schema.pipelineTasks.kind, 'studio_render'), eq(schema.pipelineTasks.status, 'running')))
  let resumed = 0
  for (const row of rows) {
    const projectId = Number(row.key.split(':')[1])
    if (!Number.isInteger(projectId)) continue
    const project = await getProjectRow(projectId)
    if (!project) {
      await updateTask(row.key, { status: 'error', errorMsg: 'E_TASK_INTERRUPTED: project missing', finishedAt: now() })
      continue
    }
    const state = parseAutoRender(project.autoRender)
    if (!isRunning(state)) {
      await updateTask(row.key, { status: 'error', errorMsg: 'E_TASK_INTERRUPTED: 服务重启，任务中断，请重试', finishedAt: now() })
      continue
    }
    if (state.stage === 'merging') {
      // รอ merge เดิมจบ แล้วปิด done (captions burn ทำงานเองแล้วจาก mergeProject)
      ;(async () => {
        try {
          if (project.episodeId) await waitForMergeCompletionByEpisode(project.episodeId)
          await patchAutoRender(projectId, { stage: 'done', finishedAt: now() })
          await updateTask(row.key, { status: 'done', finishedAt: now() })
        } catch (err: any) {
          const msg = `E_TASK_INTERRUPTED: ${err?.message || 'merge interrupted'}`
          await patchAutoRender(projectId, { stage: 'failed', errorMsg: msg, finishedAt: now() })
          await updateTask(row.key, { status: 'error', errorMsg: msg, finishedAt: now() })
        }
      })()
      resumed += 1
      continue
    }
    // keyframes/videos: monitor ต่อ (ห้ามส่งงานใหม่ — resume)
    void runAutoRenderPipeline(projectId, row.key, {
      pollMs: POLL_MS,
      resumeStage: state.stage,
      resumeTaskIds: state.stageTaskIds ?? [],
    })
    resumed += 1
  }
  return resumed
}

async function waitForMergeCompletionByEpisode(episodeId: number): Promise<void> {
  const rows = await db.select().from(schema.videoMerges)
    .where(eq(schema.videoMerges.episodeId, episodeId))
    .orderBy(schema.videoMerges.id)
  const latest = rows[rows.length - 1]
  if (!latest) return
  await waitForMergeCompletion(latest.id)
}
