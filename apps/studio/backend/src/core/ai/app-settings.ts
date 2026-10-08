/**
 * 应用级全局设置（app_settings key-value 表）
 * AI 内容语言：所有 Agent 产出（剧本/提取/分镜/提示词）统一使用的目标语言
 * 层次约束：本模块只依赖 db，严禁反向 import agents/*（agents/context.ts 会引用本模块）
 *
 * getContentLanguage() stays synchronous (agents/context.ts builds request contexts synchronously):
 * the value is read from PostgreSQL once at startup and kept in memory; setContentLanguage() writes
 * the table and the cache together.
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { now } from '../http/response.js'

export const CONTENT_LANGUAGES = ['th', 'en'] as const
export type ContentLanguage = typeof CONTENT_LANGUAGES[number]

const CONTENT_LANGUAGE_KEY = 'content_language'

function isContentLanguage(v: unknown): v is ContentLanguage {
  return typeof v === 'string' && (CONTENT_LANGUAGES as readonly string[]).includes(v)
}

async function readSetting(key: string): Promise<string | undefined> {
  const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key))
  return row?.value
}

async function writeSetting(key: string, value: string): Promise<void> {
  await db.insert(schema.appSettings)
    .values({ key, value, updatedAt: now() })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: now() } })
}

let contentLanguage: ContentLanguage = 'th'

/** Re-read the content language from the database (startup, and before answering the settings API). */
export async function loadContentLanguage(): Promise<ContentLanguage> {
  const value = await readSetting(CONTENT_LANGUAGE_KEY)
  contentLanguage = isContentLanguage(value) ? value : 'th'
  return contentLanguage
}

/** 读取全局内容语言；未设置或值非法（含旧的 zh/ja/ko）时回退 'th' */
export function getContentLanguage(): ContentLanguage {
  return contentLanguage
}

/** 写入全局内容语言（upsert） */
export async function setContentLanguage(lang: ContentLanguage): Promise<ContentLanguage> {
  if (!isContentLanguage(lang)) throw new Error(`Invalid content language: ${lang}`)
  await writeSetting(CONTENT_LANGUAGE_KEY, lang)
  contentLanguage = lang
  return lang
}

const TOURS_SEEN_KEY = 'tours_seen'
const MAX_TOURS_SEEN = 64

function sanitizeTourIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return []
  return [...new Set(ids.filter(v => typeof v === 'string' && v.length > 0 && v.length <= 100))].slice(0, MAX_TOURS_SEEN)
}

/** 已看过的引导漫游 id 列表（JSON 数组存储）；桌面端端口随启动变化，localStorage 不可靠，故落库 */
export async function getToursSeen(): Promise<string[]> {
  try { return sanitizeTourIds(JSON.parse((await readSetting(TOURS_SEEN_KEY)) || '[]')) } catch { return [] }
}

/** 写入已看过的引导漫游 id 列表（upsert） */
export async function setToursSeen(ids: unknown): Promise<string[]> {
  const clean = sanitizeTourIds(ids)
  await writeSetting(TOURS_SEEN_KEY, JSON.stringify(clean))
  return clean
}

await loadContentLanguage()
