/**
 * Active video provider capabilities (min clip length, concurrency, native audio) — shared by
 * Product Studio and Viral Clone to plan shots and render batches.
 */
import { getActiveConfig } from '../ai/ai.js'
import { videoAdapters } from '../ai/adapters/registry.js'

export async function getActiveVideoProviderInfo() {
  const config = await getActiveConfig('video')
  if (!config) return null
  const caps = videoAdapters[config.provider.toLowerCase()]?.capabilities
  if (!caps) return null
  const fromSettings = Number(config.settings?.max_concurrent)
  const maxConcurrent = Number.isFinite(fromSettings) && fromSettings >= 1 ? Math.floor(fromSettings) : (caps.maxConcurrent ?? null)
  return {
    provider: config.provider,
    configId: config.id ?? null,
    minDurationSec: caps.minDurationSec ?? null,
    maxConcurrent,
    nativeAudio: !!caps.nativeAudio,
    estimatedSecondsPerClip: caps.estimatedSecondsPerClip ?? null,
  }
}
