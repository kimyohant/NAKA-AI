/**
 * งานเตรียม generate task (ย้ายมาจาก src/routes/tasks.ts — พฤติกรรมเดิมทุกกรณี)
 * ให้ route เดิมและ Product Studio (render videos) เรียกใช้ร่วมกัน ไม่ก๊อป logic แยก
 */
import { eq } from 'drizzle-orm'
import { db, schema } from '../db/index.js'
import { getActiveConfig, getConfigById } from './ai.js'
import { getDramaStylePrompt } from './style-preset.js'
import { storyboardReadiness } from './storyboard-readiness.js'

export type TaskType = 'image' | 'video'

const WAN_MEDIA_TYPES = new Set([
  'first_frame',
  'last_frame',
  'reference_image',
  'reference_video',
  'reference_audio',
  'file',
  'link',
])

/**
 * 兼容项目原有扁平入参，也支持 Wan 3.0 官方 model/input/parameters 结构。
 */
export function normalizeVideoRequest(body: any) {
  const input = body.input && typeof body.input === 'object' && !Array.isArray(body.input) ? body.input : {}
  const parameters = body.parameters && typeof body.parameters === 'object' && !Array.isArray(body.parameters)
    ? body.parameters
    : {}
  const media = Array.isArray(input.media) ? input.media : []

  const mediaUrls = (type: string) => media
    .filter((item: any) => item?.type === type)
    .map((item: any) => item?.url)

  return {
    ...body,
    prompt: body.prompt ?? input.prompt ?? '',
    reference_image_urls: body.reference_image_urls ?? mediaUrls('reference_image'),
    reference_video_urls: body.reference_video_urls ?? mediaUrls('reference_video'),
    reference_audio_urls: body.reference_audio_urls ?? mediaUrls('reference_audio'),
    first_frame_url: body.first_frame_url ?? mediaUrls('first_frame')[0],
    last_frame_url: body.last_frame_url ?? mediaUrls('last_frame')[0],
    file_url: body.file_url ?? mediaUrls('file')[0],
    link_url: body.link_url ?? mediaUrls('link')[0],
    generate_audio: body.generate_audio ?? parameters.audio,
    duration: body.duration ?? parameters.duration,
    aspect_ratio: body.aspect_ratio ?? parameters.ratio,
    resolution: body.resolution ?? parameters.resolution,
    seed: body.seed ?? parameters.seed,
    prompt_extend: body.prompt_extend ?? parameters.prompt_extend,
    watermark: body.watermark ?? parameters.watermark,
    official_media: media,
  }
}

export function validateVideoRequest(body: any, provider?: string): string | null {
  for (const key of ['reference_image_urls', 'reference_video_urls', 'reference_audio_urls']) {
    if (body[key] !== undefined && !Array.isArray(body[key])) return `${key} 必须为数组`
    if (Array.isArray(body[key]) && body[key].some((url: any) => typeof url !== 'string' || !url.trim())) {
      return `${key} 中的每个 URL 都必须为非空字符串`
    }
  }

  if (body.official_media.length) {
    for (const item of body.official_media) {
      if (!item || typeof item !== 'object' || !WAN_MEDIA_TYPES.has(item.type) || typeof item.url !== 'string' || !item.url.trim()) {
        return 'input.media 中的每项都必须包含官方支持的 type 和非空 url'
      }
    }
    for (const type of ['first_frame', 'last_frame', 'file', 'link']) {
      if (body.official_media.filter((item: any) => item.type === type).length > 1) {
        return `Wan 3.0 input.media 中 ${type} 最多 1 项`
      }
    }
  }

  const imgs = body.reference_image_urls.length
  const vids = body.reference_video_urls.length
  const auds = body.reference_audio_urls.length
  const first = Boolean(body.first_frame_url)
  const last = Boolean(body.last_frame_url)
  const file = Boolean(body.file_url)
  const link = Boolean(body.link_url)

  if ((provider || '').toLowerCase() === 'aliyun') {
    if (imgs > 10 || vids > 5 || auds > 5) return 'Wan 3.0 参考素材超限：图片≤10、视频≤5、音频≤5'
    if (last && !first) return 'Wan 3.0 尾帧必须与首帧同时传入'
    if (file && link) return 'Wan 3.0 file 与 link 不能同时传入'
    if ((first || last) && (imgs + vids + auds > 0 || file || link)) {
      return 'Wan 3.0 的 first_frame/last_frame 不能与 reference_image/reference_video/reference_audio/file/link 混用'
    }
    const total = imgs + vids + auds + Number(first) + Number(last) + Number(file) + Number(link)
    if (total > 20) return 'Wan 3.0 input.media 最多 20 项'
  } else {
    if (imgs > 9 || vids > 3 || auds > 3) return '参考素材超限：图片≤9、视频≤3、音频≤3'
    if (auds > 0 && imgs + vids === 0) return '参考音频需要至少 1 个参考图片或视频'
  }

  if (!String(body.prompt || '').trim() && imgs + vids + auds === 0 && !first && !last && !file && !link) {
    return '视频生成需要至少一个参考素材或 prompt'
  }
  for (const match of String(body.prompt || '').matchAll(/@图片(\d+)/g)) {
    const index = Number(match[1])
    if (index < 1 || index > imgs) return `提示词引用了图片${index}，但只提交了 ${imgs} 张参考图`
  }
  return null
}

export async function resolveTaskContext(body: any, type: TaskType) {
  let configId: number | undefined = body.config_id
  let episodeResolution: string | undefined
  let storyboardDramaId: number | undefined
  if (body.storyboard_id) {
    const [sb] = await db.select().from(schema.storyboards).where(eq(schema.storyboards.id, Number(body.storyboard_id)))
    if (sb) {
      const [ep] = await db.select().from(schema.episodes).where(eq(schema.episodes.id, sb.episodeId))
      const locked = type === 'image' ? ep?.imageConfigId : ep?.videoConfigId
      if (locked != null && configId == null) configId = locked
      if (type === 'video' && ep?.resolution) episodeResolution = ep.resolution
      storyboardDramaId = ep?.dramaId ?? undefined
    }
  }
  return { configId, episodeResolution, storyboardDramaId }
}

export async function prepareVideoTask(body: any, context: Awaited<ReturnType<typeof resolveTaskContext>>) {
  if (body.storyboard_id) {
    const readiness = await storyboardReadiness(Number(body.storyboard_id))
    if (!readiness) throw new Error('Storyboard not found')
    const blocker = readiness.blockers[0]
    if (blocker?.code === 'select_image_candidate') throw new Error(`Select the generated ${blocker.slot} image for this shot before video generation`)
    if (blocker?.code === 'missing_prompt') throw new Error('Add a video prompt for this shot before generation')
    if (blocker) throw new Error(`Add an image for ${blocker.name || 'the bound asset'} before video generation`)
  }
  const videoBody = normalizeVideoRequest(body)
  // A storyboard already has approved visual assets. Sending it as text-only video
  // silently drops costume, cast and set continuity (for example from API scripts).
  if (body.storyboard_id && !videoBody.reference_image_urls.length
    && !videoBody.reference_video_urls.length
    && !videoBody.first_frame_url && !videoBody.image_url) {
    throw new Error('Storyboard video needs a reference image or first frame. Generate from the studio workbench so character, costume and scene images are included.')
  }
  const config = context.configId
    ? (await getConfigById(context.configId)) ?? await getActiveConfig('video')
    : await getActiveConfig('video')
  if (!config) throw new Error('未配置视频模型，请先到「设置」页添加并启用 AI 服务')
  const validationError = validateVideoRequest(videoBody, config.provider)
  if (validationError) throw new Error(validationError)
  let prompt = String(videoBody.prompt || '')
  if (prompt.trim()) {
    const stylePrompt = await getDramaStylePrompt(body.drama_id ?? context.storyboardDramaId ?? null)
    if (stylePrompt) prompt = `${stylePrompt}，\n${prompt}`
  }
  return { videoBody, config, prompt }
}
