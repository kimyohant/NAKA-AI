/**
 * 批量视频提示词任务 — 异步为缺少 video_prompt 的分镜逐个运行 prompt_generator Agent
 * 状态持久化到 pipeline_tasks 表：重启后可恢复显示（遗留 running 行 boot 时标记失败），
 * 每个分镜之间检查 cancel_requested 实现协作式取消
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../../../core/db/index.js'
import { mastra } from '../../../core/mastra/index.js'
import { buildAgentRequestContext } from '../../../core/agents/context.js'
import { buildDramaCreativeContext } from '../../../core/production/drama-context.js'
import { videoPromptsKey, startTask, updateTask, getTask, isCancelRequested } from '../../../core/tasks/pipeline-tasks.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../../../core/tasks/task-logger.js'

export interface VideoPromptBatchStatus {
  status: 'running' | 'done' | 'error' | 'cancelled'
  total: number
  completed: number
  failed: number
  current_storyboard_id?: number
  started_at: string
  finished_at?: string
  error?: string
}

/** 启动批量生成（立即返回）；运行中返回 started:false,total:-1；无待生成分镜返回 started:false,total:0；
 *  传入 storyboardIds 时只处理所选分镜（即使已有提示词也重新生成），否则处理全部缺失提示词的分镜 */
export async function startVideoPromptBatch(
  episodeId: number,
  dramaId: number,
  opts: { model?: string; configId?: number } = {},
  storyboardIds?: number[],
): Promise<{ started: boolean; total: number }> {
  const key = videoPromptsKey(episodeId)
  const existing = await getTask(key)
  if (existing?.status === 'running') return { started: false, total: -1 }

  const sbs = await db.select().from(schema.storyboards)
    .where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber)
  const pending = storyboardIds?.length
    ? sbs.filter(sb => storyboardIds.includes(sb.id))
    : sbs.filter(sb => !(sb.videoPrompt || '').trim())
  if (!pending.length) return { started: false, total: 0 }

  // 视频模型标签：跟随该集锁定的视频配置，供 Agent 按模型特性生成
  const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
  let videoLabel = '默认'
  if (ep?.videoConfigId) {
    const [cfg] = await db.select().from(schema.aiServiceConfigs).where(eq(schema.aiServiceConfigs.id, ep.videoConfigId))
    if (cfg) videoLabel = `${cfg.name} (${cfg.provider})`
  }

  // startTask 返回 null = 该集批量任务正在运行（boot 清理保证不会有死进程残留的 running 行）
  const task = await startTask({ kind: 'video_prompts', key, dramaId, episodeId, total: pending.length })
  if (!task) return { started: false, total: -1 }

  logTaskStart('VideoPrompt', 'batch', { episodeId, dramaId, total: pending.length, model: opts.model || undefined })
  ;(async () => {
    const agent = mastra.getAgent('prompt_generator')
    if (!agent) throw new Error('视频提示词 Agent 不可用')
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
    })
    // 项目创作定位对整批分镜一致，循环外取一次
    const creativeContext = await buildDramaCreativeContext(dramaId, episodeId)
    const contextPrefix = creativeContext ? `${creativeContext}\n\n` : ''
    for (const sb of pending) {
      // 协作式取消：每个分镜之间检查
      if (await isCancelRequested(key)) {
        await updateTask(key, { status: 'cancelled', currentKey: null, finishedAt: new Date().toISOString() })
        logTaskProgress('VideoPrompt', 'batch-cancelled', { episodeId, completed: task.completed })
        return
      }
      await updateTask(key, { currentKey: String(sb.id) })
      logTaskProgress('VideoPrompt', 'batch-shot', { episodeId, storyboardId: sb.id, index: (task.completed || 0) + (task.failed || 0) + 1, total: task.total })
      try {
        await agent.generate([{
          role: 'user',
          content: `${contextPrefix}请为分镜 #${sb.storyboardNumber}(ID:${sb.id})生成视频提示词(video_prompt)。视频模型:${videoLabel},请根据该模型的特性和时长限制生成。
请先调用 read_storyboard_context 获取该分镜的画面描述(含【镜头N】子镜头与台词/旁白)、氛围及时长，据此生成 video_prompt(第一行是信息头：列出该分镜出场的人物与场景，用 @角色名/@场景名 引用；之后按 3 秒分段换行、用 @角色名/@场景名/@道具名 引用参考素材；段落内允许多镜头切镜，段与段可以是不同景别/角度/对象，但不跨场景，切镜点对齐分镜 description 的【镜头N】结构),然后调用 update_storyboard 保存到分镜 ID:${sb.id}。update_storyboard 参数只传 storyboard_id 和 video_prompt 两个键,不要回传该分镜的其他任何字段,不要重新拆分整集。`,
        }], { maxSteps: 8, requestContext })
        // 以实际落库为准判定成败
        const [fresh] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, sb.id))
        if ((fresh?.videoPrompt || '').trim()) {
          task.completed = (task.completed || 0) + 1
          await updateTask(key, { completed: task.completed })
        } else {
          task.failed = (task.failed || 0) + 1
          await updateTask(key, { failed: task.failed })
          logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: 'agent finished but video_prompt is empty' })
        }
      } catch (err: any) {
        task.failed = (task.failed || 0) + 1
        await updateTask(key, { failed: task.failed })
        logTaskError('VideoPrompt', 'batch-shot', { storyboardId: sb.id, error: err?.message })
      }
    }
    await updateTask(key, { status: 'done', currentKey: null, finishedAt: new Date().toISOString() })
  })()
    .then(() => {
      logTaskSuccess('VideoPrompt', 'batch', { episodeId, total: task.total, completed: task.completed, failed: task.failed })
    })
    .catch(async (err: any) => {
      await updateTask(key, { status: 'error', errorMsg: err?.message, currentKey: null, finishedAt: new Date().toISOString() })
      logTaskError('VideoPrompt', 'batch', { episodeId, error: err?.message })
    })
  return { started: true, total: pending.length }
}

/** 查询批量任务状态（从 DB 读取；重启后仍能看到真实状态） */
export async function getVideoPromptBatchStatus(episodeId: number): Promise<VideoPromptBatchStatus | null> {
  const row = await getTask(videoPromptsKey(episodeId))
  if (!row) return null
  return {
    status: row.status,
    total: row.total,
    completed: row.completed,
    failed: row.failed,
    current_storyboard_id: row.currentKey ? Number(row.currentKey) : undefined,
    started_at: row.createdAt,
    finished_at: row.finishedAt || undefined,
    error: row.errorMsg || undefined,
  }
}
