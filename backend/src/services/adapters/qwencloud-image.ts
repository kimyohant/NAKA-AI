/**
 * QwenCloud (MaaS) 图片生成 Adapter — DashScope text2image 兼容结构
 * endpoint: {baseUrl}/api/v1/services/aigc/text2image/image-synthesis (X-DashScope-Async: enable)
 * 轮询:     {baseUrl}/api/v1/tasks/{task_id}
 * 模型:     wan2.7-image / qwen-image / wanx2.1-t2i-turbo 等（qwencloud 平台按其模型列表为准）
 */
import { joinProviderUrl } from './url'
import type { AIConfig, ImageGenerationRecord, ImageProviderAdapter } from './types'
import type { ProviderRequest } from './types'

/** DashScope 支持的常用尺寸（* 分隔）— 把项目内 1920x1080 风格尺寸吸附到最近的合法档位 */
const SUPPORTED_SIZES = ['512*512', '768*512', '768*1024', '1024*1024', '1024*768', '720*1280', '1280*720', '1024*1440', '1440*1024']

function normalizeSize(size?: string | null): string {
  if (!size) return '1024*1024'
  const m = /^(\d+)\s*[xX*]\s*(\d+)$/.exec(size.trim())
  if (!m) return '1024*1024'
  const w = Number(m[1])
  const h = Number(m[2])
  const target = `${w}*${h}`
  if (SUPPORTED_SIZES.includes(target)) return target
  // 按宽高比吸附：竖向 → 720*1280，横向 → 1280*720，接近方形 → 1024*1024
  const ratio = w / h
  if (ratio < 0.8) return '720*1280'
  if (ratio > 1.25) return '1280*720'
  return '1024*1024'
}

export class QwenCloudImageAdapter implements ImageProviderAdapter {
  provider = 'qwencloud'

  buildGenerateRequest(config: AIConfig, record: ImageGenerationRecord): ProviderRequest {
    const model = record.model || config.model || 'wan2.7-image'
    const prompt = (record.prompt || '').slice(0, 2000)
    if (!prompt.trim()) throw new Error('QwenCloud 图片生成需要 prompt')

    return {
      url: joinProviderUrl(config.baseUrl, '/api/v1', '/services/aigc/text2image/image-synthesis'),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
        'X-DashScope-Async': 'enable',
      },
      body: {
        model,
        input: { prompt },
        parameters: {
          size: normalizeSize(record.size),
          n: 1,
          prompt_extend: true,
        },
      },
    }
  }

  parseGenerateResponse(result: any): { isAsync: boolean; taskId?: string; imageUrl?: string } {
    const taskId = result?.output?.task_id
    if (taskId) return { isAsync: true, taskId: String(taskId) }
    // 极少数同步结果：output.results[0].url
    const url = result?.output?.results?.[0]?.url
    if (url) return { isAsync: false, imageUrl: String(url) }
    throw new Error(errorMessage(result, 'QwenCloud 响应中缺少 output.task_id'))
  }

  buildPollRequest(config: AIConfig, taskId: string): ProviderRequest {
    return {
      url: joinProviderUrl(config.baseUrl, '/api/v1', `/tasks/${encodeURIComponent(taskId)}`),
      method: 'GET',
      headers: { 'Authorization': `Bearer ${config.apiKey}` },
      body: undefined,
    }
  }

  parsePollResponse(result: any): { status: 'pending' | 'processing' | 'completed' | 'failed'; imageUrl?: string; error?: string } {
    const status = String(result?.output?.task_status || '').toUpperCase()
    if (status === 'SUCCEEDED') {
      const url = result?.output?.results?.[0]?.url
      if (!url) return { status: 'failed', error: '任务成功但缺少 results[0].url' }
      return { status: 'completed', imageUrl: String(url) }
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      return { status: 'failed', error: result?.output?.message || `任务状态: ${status}` }
    }
    if (status === 'RUNNING') return { status: 'processing' }
    return { status: 'pending' }
  }

  extractImageUrl(result: any): string | null {
    const url = result?.output?.results?.[0]?.url
    return url ? String(url) : null
  }

  extractImageBase64(_result: any): { data: string; mimeType: string } | null {
    return null
  }
}

function errorMessage(result: any, fallback: string): string {
  return result?.message || result?.error?.message || fallback
}
