import fs from 'node:fs'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { ffmpeg } from '../utils/ffmpeg.js'
import { DATA_ROOT, STORAGE_ROOT } from '../utils/paths.js'
import { videoSourceStatus } from './source-freshness.js'

export function localVideoPath(relativePath: string): string {
  if (path.isAbsolute(relativePath)) return relativePath
  if (relativePath.startsWith('static/')) return path.join(DATA_ROOT, relativePath)
  return path.join(STORAGE_ROOT, relativePath)
}

export interface ClipHealth {
  storyboard_id: number
  shot_number: number
  url: string | null
  duration_seconds: number | null
  width: number | null
  height: number | null
  frame_rate: number | null
  has_audio: boolean
  source_state: 'missing' | 'untracked' | 'stale' | 'current'
  changed_sources: string[]
  errors: string[]
  warnings: string[]
}

function frameRate(raw: string | undefined): number | null {
  if (!raw) return null
  const [a, b] = raw.split('/').map(Number)
  const fps = b ? a / b : a
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 100) / 100 : null
}

async function inspectClip(shot: typeof schema.storyboards.$inferSelect): Promise<ClipHealth> {
  const url = shot.videoUrl || shot.composedVideoUrl
  const source = videoSourceStatus(shot.id, url)
  const health: ClipHealth = {
    storyboard_id: shot.id, shot_number: shot.storyboardNumber, url,
    duration_seconds: null, width: null, height: null, frame_rate: null, has_audio: false,
    source_state: source.state, changed_sources: source.changed, errors: [], warnings: [],
  }
  if (source.state === 'stale') health.warnings.push(`Source changed: ${source.changed.join(', ')}`)
  if (source.state === 'untracked') health.warnings.push('Legacy clip: source freshness is unknown')
  if (!url) { health.errors.push('No video selected'); return health }
  const filePath = localVideoPath(url)
  if (!fs.existsSync(filePath)) { health.errors.push('Video file is missing'); return health }
  if (fs.statSync(filePath).size < 1024) { health.errors.push('Video file is empty or incomplete'); return health }
  try {
    const metadata = await new Promise<any>((resolve, reject) => ffmpeg.ffprobe(filePath, (error, data) => error ? reject(error) : resolve(data)))
    const video = metadata.streams?.find((stream: any) => stream.codec_type === 'video')
    health.has_audio = Boolean(metadata.streams?.some((stream: any) => stream.codec_type === 'audio'))
    health.duration_seconds = Number(metadata.format?.duration) || Number(video?.duration) || null
    health.width = video?.width || null
    health.height = video?.height || null
    health.frame_rate = frameRate(video?.avg_frame_rate || video?.r_frame_rate)
    if (!video) health.errors.push('No decodable video stream')
    if (!health.duration_seconds || health.duration_seconds <= 0) health.errors.push('Invalid duration')
    if (!health.width || !health.height) health.errors.push('Invalid dimensions')
    if (!health.has_audio) health.warnings.push('No audio stream')
    if (shot.duration && health.duration_seconds && Math.abs(health.duration_seconds - shot.duration) > Math.max(2, shot.duration * 0.25)) {
      health.warnings.push(`Clip duration differs from planned ${shot.duration}s`)
    }
  } catch { health.errors.push('ffprobe could not read this video') }
  return health
}

export async function episodeExportHealth(episodeId: number, selectedIds?: number[]) {
  const shots = db.select().from(schema.storyboards).where(eq(schema.storyboards.episodeId, episodeId))
    .orderBy(schema.storyboards.storyboardNumber).all().filter(shot => !shot.deletedAt)
  const selected = selectedIds?.length ? shots.filter(shot => selectedIds.includes(shot.id)) : shots
  const clips: ClipHealth[] = []
  for (let index = 0; index < selected.length; index += 4) {
    clips.push(...await Promise.all(selected.slice(index, index + 4).map(inspectClip)))
  }
  const ratioSet = new Set(clips.filter(clip => !clip.errors.length && clip.width && clip.height)
    .map(clip => `${Math.round((clip.width! / clip.height!) * 100) / 100}`))
  if (ratioSet.size > 1) {
    for (const clip of clips) if (!clip.errors.length) clip.warnings.push('Mixed aspect ratios in episode')
  }
  return {
    episode_id: episodeId,
    clips,
    ready: clips.length > 0 && clips.every(clip => clip.errors.length === 0),
    error_count: clips.reduce((count, clip) => count + clip.errors.length, 0),
    warning_count: clips.reduce((count, clip) => count + clip.warnings.length, 0),
    total_duration_seconds: Math.round(clips.reduce((sum, clip) => sum + (clip.duration_seconds || 0), 0) * 100) / 100,
  }
}
