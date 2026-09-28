/**
 * Agent pipeline 任务状态存储 — pipeline_tasks 表为唯一事实来源
 * （替代原先进程内 Map：重启后状态可恢复，boot 时把遗留 running 行标记失败；
 *  cancel_requested 标志由长循环任务在步骤之间自愿检查，实现协作式取消）
 */
import { eq, and, inArray } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../utils/response.js'

export type PipelineTaskKind = 'extract' | 'video_prompts'
export type PipelineTaskStatus = 'running' | 'done' | 'error' | 'cancelled'

export interface PipelineTaskRow {
  id: number
  kind: string
  key: string
  dramaId: number | null
  episodeId: number | null
  status: PipelineTaskStatus
  total: number
  completed: number
  failed: number
  currentKey: string | null
  errorMsg: string | null
  cancelRequested: number
  createdAt: string
  updatedAt: string
  finishedAt: string | null
}

export function extractKey(episodeId: number, target: string) {
  return `extract:${episodeId}:${target}`
}

export function videoPromptsKey(episodeId: number) {
  return `video_prompts:${episodeId}`
}

type Row = typeof schema.pipelineTasks.$inferSelect

function toRow(r: Row): PipelineTaskRow {
  return {
    id: r.id,
    kind: r.kind,
    key: r.key,
    dramaId: r.dramaId,
    episodeId: r.episodeId,
    status: r.status as PipelineTaskStatus,
    total: r.total || 0,
    completed: r.completed || 0,
    failed: r.failed || 0,
    currentKey: r.currentKey,
    errorMsg: r.errorMsg,
    cancelRequested: r.cancelRequested || 0,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    finishedAt: r.finishedAt,
  }
}

/** 启动任务：同 key 已有 running 行返回 null（调用方据此拒绝重复启动），否则建新行 */
export async function startTask(params: {
  kind: PipelineTaskKind
  key: string
  dramaId?: number
  episodeId?: number
  total?: number
}): Promise<PipelineTaskRow | null> {
  const [existing] = await db.select().from(schema.pipelineTasks)
    .where(and(eq(schema.pipelineTasks.key, params.key), eq(schema.pipelineTasks.status, 'running')))
  if (existing) return null
  const ts = now()
  await db.insert(schema.pipelineTasks).values({
    kind: params.kind,
    key: params.key,
    dramaId: params.dramaId ?? null,
    episodeId: params.episodeId ?? null,
    status: 'running',
    total: params.total ?? 0,
    cancelRequested: 0,
    createdAt: ts,
    updatedAt: ts,
  })
  const [row] = await db.select().from(schema.pipelineTasks)
    .where(and(eq(schema.pipelineTasks.key, params.key), eq(schema.pipelineTasks.status, 'running')))
  return toRow(row)
}

export async function updateTask(key: string, patch: Partial<{
  status: PipelineTaskStatus
  total: number
  completed: number
  failed: number
  currentKey: string | null
  errorMsg: string | null
  finishedAt: string
}>) {
  await db.update(schema.pipelineTasks).set({ ...patch, updatedAt: now() })
    .where(eq(schema.pipelineTasks.key, key))
}

export async function getTask(key: string): Promise<PipelineTaskRow | null> {
  const [row] = await db.select().from(schema.pipelineTasks)
    .where(eq(schema.pipelineTasks.key, key))
  return row ? toRow(row) : null
}

/** 协作式取消：置 cancel_requested=1；长循环在步骤间检查后自行停止。已在跑的单步调用无法中断 */
export async function cancelTask(key: string): Promise<boolean> {
  const [row] = await db.select().from(schema.pipelineTasks)
    .where(and(eq(schema.pipelineTasks.key, key), eq(schema.pipelineTasks.status, 'running')))
  if (!row) return false
  await db.update(schema.pipelineTasks).set({ cancelRequested: 1, updatedAt: now() })
    .where(eq(schema.pipelineTasks.id, row.id))
  return true
}

export async function isCancelRequested(key: string): Promise<boolean> {
  const [row] = await db.select().from(schema.pipelineTasks)
    .where(eq(schema.pipelineTasks.key, key))
  return !!row?.cancelRequested
}

/** boot 清理：进程重启后所有 running 行不可能还在跑 → 标记失败，避免 UI 永远显示进行中 */
export async function failStaleRunningTasks(): Promise<number> {
  const res = await db.update(schema.pipelineTasks)
    .set({ status: 'error', errorMsg: '服务重启，任务中断，请重试', finishedAt: now(), updatedAt: now() })
    .where(and(inArray(schema.pipelineTasks.status, ['running']), eq(schema.pipelineTasks.cancelRequested, 0)))
  return res?.changes ?? 0
}
