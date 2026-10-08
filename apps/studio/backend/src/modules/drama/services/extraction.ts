/**
 * 资产提取任务 — 异步执行，按「集 × 类型」粒度跟踪
 * 角色 / 场景 / 道具 可分别单独提取，同一集的不同类型可并行
 * 状态持久化到 pipeline_tasks 表：重启后状态可恢复（boot 时遗留 running 行被标记失败），
 * cancelRequested 支持协作式取消（启动前检查；已在跑的单次 Agent 调用无法中断）
 */
import { mastra } from '../../../core/mastra/index.js'
import { buildAgentRequestContext } from '../../../core/agents/context.js'
import { buildDramaCreativeContext } from '../../../core/production/drama-context.js'
import { extractKey, startTask, updateTask, getTask, isCancelRequested } from '../../../core/tasks/pipeline-tasks.js'
import { logTaskError, logTaskProgress, logTaskStart, logTaskSuccess } from '../../../core/tasks/task-logger.js'

export type ExtractTarget = 'characters' | 'scenes' | 'props'
export const EXTRACT_TARGETS: ExtractTarget[] = ['characters', 'scenes', 'props']

export interface ExtractTask {
  status: 'running' | 'done' | 'error' | 'cancelled'
  started_at: string
  finished_at?: string
  error?: string
}

/** 每类资产的提取指令：限定只提取该类型，并要求与已有数据去重合并 */
const EXTRACT_MESSAGES: Record<ExtractTarget, string> = {
  characters: '请从本集剧本中提取所有角色信息（外貌需融合性格、含妆造），先用 read_existing_characters 读取项目已有角色，同名或近名（带括号定位/别名，如「林小雨（主角）」与「林小雨」）直接复用已有、不要重复创建，再用 save_dedup_characters 保存。本次只提取角色，不要提取场景和道具。',
  scenes: '请从本集剧本中提取所有场景信息（地点、时间、光影等），先用 read_existing_scenes 读取已有场景去重，再用 save_dedup_scenes 保存。本次只提取场景，不要提取角色和道具。',
  props: '请从本集剧本中提取关键道具——必须同时满足：① 直接推动剧情（出现/交接/损坏/发现会引发情节转折，如凶器、信物、关键文件、定情礼物、证据）；② 值得单独生成白底单品图（分镜会给它特写或反复出现）。判定三问任一答"否"即放弃：删掉它剧情依然成立吗？它只是随手使用的日常物品（手机、筷子、水杯）吗？它是场景陈设（桌椅、灯具）吗？宁可少提不要多提，一集通常 0-3 个，超过 3 个只保留最重要的 3 个，没有就一个都不提取（save_dedup_props 传空数组）。description 只记录物品外貌。先用 read_existing_props 读取已有道具去重，再用 save_dedup_props 保存。本次只提取道具，不要提取角色和场景。',
}

/** 启动异步提取任务（立即返回）；同集同类型已在运行时返回 false；可指定文本模型覆盖 */
export async function startExtraction(episodeId: number, dramaId: number, target: ExtractTarget, opts: { model?: string; configId?: number } = {}): Promise<boolean> {
  const key = extractKey(episodeId, target)
  // DB 里已有 running 行则拒绝重复启动
  const task = await startTask({ kind: 'extract', key, dramaId, episodeId })
  if (!task) return false
  logTaskStart('Extract', target, { episodeId, dramaId, model: opts.model || undefined, configId: opts.configId || undefined })
  ;(async () => {
    // 协作式取消：进入 Agent 调用前检查
    if (await isCancelRequested(key)) {
      await updateTask(key, { status: 'cancelled', finishedAt: new Date().toISOString() })
      return null
    }
    const agent = mastra.getAgent('extractor')
    if (!agent) throw new Error('提取 Agent 不可用')
    const requestContext = buildAgentRequestContext({
      episodeId,
      dramaId,
      modelOverride: opts.model || undefined,
      textConfigId: opts.configId || undefined,
    })
    const creativeContext = await buildDramaCreativeContext(dramaId, episodeId)
    const content = creativeContext ? `${creativeContext}\n\n${EXTRACT_MESSAGES[target]}` : EXTRACT_MESSAGES[target]
    return agent.generate([{ role: 'user', content }], {
      maxSteps: 20,
      requestContext,
      // 逐步打印 Agent 进展：调用了哪些工具、输出了什么
      onStepFinish: (step: any) => {
        const tools = (step?.toolCalls || [])
          .map((t: any) => t?.toolName || t?.payload?.toolName)
          .filter(Boolean)
        logTaskProgress('Extract', `${target}-step`, {
          episodeId,
          tools: tools.length ? tools.join(',') : undefined,
          text: (step?.text || '').slice(0, 200) || undefined,
        })
      },
    })
  })()
    .then(async (result: any) => {
      const finished = new Date().toISOString()
      if (result === null) {
        logTaskProgress('Extract', target, { episodeId, note: 'cancelled before start' })
        return
      }
      await updateTask(key, { status: 'done', finishedAt: finished })
      const toolNames = (result?.toolCalls || []).map((t: any) => t?.toolName).filter(Boolean)
      logTaskSuccess('Extract', target, {
        episodeId,
        steps: result?.steps?.length,
        toolCalls: toolNames.join(',') || undefined,
        reply: (result?.text || '').slice(0, 300) || undefined,
      })
    })
    .catch(async (err: any) => {
      await updateTask(key, { status: 'error', errorMsg: err?.message || '提取失败', finishedAt: new Date().toISOString() })
      logTaskError('Extract', target, { episodeId, error: err?.message })
    })
  return true
}

/** 查询某集三类资产的提取任务状态（未启动过的类型为 null） */
export async function getExtractionStatus(episodeId: number): Promise<Record<ExtractTarget, ExtractTask | null>> {
  const result = {} as Record<ExtractTarget, ExtractTask | null>
  for (const target of EXTRACT_TARGETS) {
    const row = await getTask(extractKey(episodeId, target))
    result[target] = row
      ? { status: row.status, started_at: row.createdAt, finished_at: row.finishedAt || undefined, error: row.errorMsg || undefined }
      : null
  }
  return result
}
