/**
 * Social adapter registry — lookup by Platform name (lowercased).
 * Same shape as the image adapter lookup. Tests register extra adapters.
 */
import type { SocialPlatformAdapter } from './types.js'

const adapters = new Map<string, SocialPlatformAdapter>()

export function registerSocialAdapter(adapter: SocialPlatformAdapter): void {
  adapters.set(adapter.platform.toLowerCase(), adapter)
}

/** Test helper: drop every registered adapter. */
export function resetSocialAdapters(): void {
  adapters.clear()
}

export function getSocialAdapter(platform: string): SocialPlatformAdapter {
  const adapter = adapters.get(platform.toLowerCase())
  if (!adapter) throw new Error(`Unsupported social platform: ${platform}`)
  return adapter
}
