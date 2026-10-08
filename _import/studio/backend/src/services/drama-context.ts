/**
 * 创作定位上下文（参考 Topview「Creative Positioning」面板）
 * 把项目级设定（类型/背景/情结钩子/分集时长/尺度）注入 Agent 用户消息，
 * 让改写/提取/分镜/提示词各链路共享同一套创作方向。
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

/** dramas.metadata 的结构化设定（全部可选，缺省走既有行为） */
export interface DramaCreativeSettings {
  /** 单集 / 多集：single | multi */
  episode_mode?: string
  /** 首集时长（秒） */
  first_episode_duration?: number
  /** 后续每集时长（秒） */
  episode_duration?: number
  /** 尺度：all | teen | sixteen | adult */
  suggestiveness?: string
  /** 题材标签（显示语言原文，如「มาเฟียโรแมนซ์」） */
  genres?: string[]
  /** 背景标签 */
  backgrounds?: string[]
  /** 情结/套路标签 */
  tropes?: string[]
  /** 改写完成后自动审校优化（参考 Topview Auto Review & Optimize） */
  auto_review?: boolean
  /** 改写/审校完成后自动继续提取角色/场景/道具（半自动流水线） */
  auto_pipeline?: boolean
}

export function parseDramaSettings(raw: string | null): DramaCreativeSettings {
  if (!raw) return {}
  try {
    const v = JSON.parse(raw)
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as DramaCreativeSettings) : {}
  } catch {
    return {}
  }
}

const list = (v?: string[]) => (Array.isArray(v) && v.length ? v.filter(Boolean).join('、') : '')

/**
 * 拉取项目并渲染为注入文本；episodeId 传入时追加「本集目标时长」硬约束
 * （首集/后续集时长来自项目设置，对剧本改写与分镜拆解形成实际约束）。
 * 项目无任何定位设定时返回空串（调用方跳过拼接）
 */
export async function buildDramaCreativeContext(dramaId: number, episodeId?: number | null): Promise<string> {
  const [drama] = await db.select().from(schema.dramas).where(eq(schema.dramas.id, dramaId))
  if (!drama) return ''

  const s = parseDramaSettings(drama.metadata)
  const genres = [...new Set([...(s.genres || []), ...(drama.genre ? [drama.genre] : [])])]

  const lines: string[] = []
  if (drama.title) lines.push(`- Title: ${drama.title}`)
  if (drama.description) lines.push(`- Logline: ${drama.description}`)
  const genreStr = list(genres)
  if (genreStr) lines.push(`- Genre: ${genreStr}`)
  const bgStr = list(s.backgrounds)
  if (bgStr) lines.push(`- Setting/Background: ${bgStr}`)
  const tropeStr = list(s.tropes)
  if (tropeStr) lines.push(`- Tropes / Emotional hooks: ${tropeStr}`)
  if (s.episode_mode) lines.push(`- Episode mode: ${s.episode_mode === 'single' ? 'single episode' : 'multi-episode series'}`)
  if (s.first_episode_duration) lines.push(`- First episode target duration: ~${s.first_episode_duration}s`)
  if (s.episode_duration) lines.push(`- Later episode target duration: ~${s.episode_duration}s`)
  if (s.suggestiveness) {
    const map: Record<string, string> = { all: 'general audiences', teen: '13+', sixteen: '16+', adult: '18+' }
    lines.push(`- Audience / suggestiveness: ${map[s.suggestiveness] || s.suggestiveness}`)
  }

  // 本集目标时长：首集用 first_episode_duration，其余用 episode_duration（±20% 允差）
  if (episodeId) {
    const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, episodeId))
    if (ep) {
      const target = (ep.episodeNumber || 1) === 1 ? s.first_episode_duration : s.episode_duration
      if (target) {
        lines.push(`- Current episode: #${ep.episodeNumber} — target duration for THIS episode: ~${target}s (keep the episode's total within ±20% of this)`)
      }
      // แผนฮุคท้ายตอน (Hook Chain): ถ้าผู้ใช้/AI ตั้งฮุคไว้ บทและสตอรีบอร์ดต้องจบลงที่ฮุคนี้
      if (ep.hook && ep.hook.trim()) {
        lines.push(`- Planned ending hook for THIS episode (the final beat MUST land exactly on this hook): ${ep.hook.trim()}`)
      }
    }
  }

  if (!lines.length) return ''
  return [
    '【Creative Direction（project settings — follow these consistently）】',
    ...lines,
    '【/Creative Direction】',
  ].join('\n')
}
