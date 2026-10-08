/**
 * 数据目录占用统计 + 磁盘剩余空间
 *
 * - dirUsage：单次异步递归 walk（fs.promises，不阻塞事件循环），按相对路径归桶
 * - db 桶由调用方填（PostgreSQL schema 大小，routes/storage.ts）；本地 PGlite 目录 data/pglite 不重复计入
 */
import type { Dirent } from 'fs'
import fsp from 'fs/promises'
import path from 'path'

export interface UsageBuckets {
  db: number
  images: number
  videos: number
  merged: number
  uploads: number
  temp: number
  other: number
  total: number
}

/** DATABASE_URL unset → PGlite keeps the database here; routes/storage.ts counts it as the db bucket */
const PGLITE_DIR = 'pglite'

/** 递归 walk，对每个普通文件回调（完整路径 + 大小）；目录不可读/文件竞态静默跳过 */
async function walkFiles(dir: string, onFile: (filePath: string, size: number) => void): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkFiles(full, onFile)
    } else if (entry.isFile()) {
      try {
        const st = await fsp.stat(full)
        onFile(full, st.size)
      } catch { /* 文件在 walk 期间消失等竞态，忽略 */ }
    }
  }
}

/** 统计数据目录占用（按用途分桶）；db 桶留 0 给调用方 */
export async function dirUsage(dataRoot: string): Promise<UsageBuckets> {
  const usage: UsageBuckets = { db: 0, images: 0, videos: 0, merged: 0, uploads: 0, temp: 0, other: 0, total: 0 }
  const add = (bucket: keyof UsageBuckets, size: number) => {
    usage[bucket] += size
    usage.total += size
  }

  await walkFiles(dataRoot, (filePath, size) => {
    const rel = path.relative(dataRoot, filePath)
    const parts = rel.split(path.sep)
    if (parts[0] === PGLITE_DIR) return // 数据库：调用方按 schema 大小计入 db 桶
    if (parts[0] === 'static' && parts.length >= 2) {
      const sub = parts[1]
      if (sub === 'images' || sub === 'videos' || sub === 'merged' || sub === 'uploads' || sub === 'temp') {
        add(sub, size)
        return
      }
    }
    add('other', size)
  })
  return usage
}

/** 目标目录所在卷的剩余字节；statfs 不可用时返回 null（调用方跳过空间校验） */
export async function volumeFreeBytes(dir: string): Promise<number | null> {
  try {
    const st = await fsp.statfs(dir)
    return st.bavail * st.bsize
  } catch {
    return null
  }
}
